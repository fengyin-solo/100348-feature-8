import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, commitEntries, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  ArchiveQuery,
  CalibrationInput,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 校准归档沿既有取数链路落库：气象观测写读数，校准归档存口径，火险监测存关注顺序。
const WEATHER_KEY = 'weather'
const ARCHIVE_KEY = 'weathercal'
const FIREWATCH_KEY = 'firewatch'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

function paginate(matched: EntryRow[], page: number, size: number): PageResult {
  if (size <= 0) {
    return { items: matched, total: matched.length, page: 1, size: matched.length }
  }
  const current = Math.max(1, page)
  const start = (current - 1) * size
  return { items: matched.slice(start, start + size), total: matched.length, page: current, size }
}

export function listEntries(
  key: string,
  filters: Record<string, string> = {},
  page = 1,
  size = 0,
): PageResult {
  return paginate(filterRows(listRows(key), filters), page, size)
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 校准标签沿用气象观测既有状态词表，存量标签兼容保留，不另起一套。
export function calibrationTags(): string[] {
  return moduleMeta(WEATHER_KEY).statuses
}

// 校准表单可选的站点编号来自火险监测点：归档与火险监测就靠这个编号联动。
export function stationOptions(): string[] {
  return listRows(FIREWATCH_KEY)
    .map((row) => String(row['监测点编号'] ?? ''))
    .filter((value) => value !== '')
}

// 归档检索台：站点编号、校准标签走既有的包含匹配，时间窗按观测时间落在 [起, 止] 内过滤。
// 固定按观测时间、校准编号升序返回，「上一条 / 下一条」的相邻关系才稳定。
export function listArchive(query: ArchiveQuery = {}, page = 1, size = 0): PageResult {
  const matched = filterRows(listRows(ARCHIVE_KEY), {
    站点编号: query.站点编号 ?? '',
    校准标签: query.校准标签 ?? '',
  })
  const from = (query.时间窗起 ?? '').trim()
  const to = (query.时间窗止 ?? '').trim()
  const windowed = matched.filter((row) => {
    const at = String(row['观测时间'] ?? '')
    if (from !== '' && at < from) {
      return false
    }
    if (to !== '' && at > to) {
      return false
    }
    return true
  })
  const sorted = [...windowed].sort((a, b) => {
    const byTime = String(a['观测时间'] ?? '').localeCompare(String(b['观测时间'] ?? ''))
    return byTime !== 0 ? byTime : Number(a.id) - Number(b.id)
  })
  return paginate(sorted, page, size)
}

// 关注顺序：命中校准站点的监测点排前面，按该站点最近一次已生效校准的复测气温降序；
// 没有校准记录的监测点保持原相对顺序跟在后面。顺序号写回记录，火险监测页直接按它排。
function rankFirewatch(watchRows: EntryRow[], archiveRows: EntryRow[]): EntryRow[] {
  const latestByStation = new Map<string, EntryRow>()
  for (const row of archiveRows) {
    if (String(row['归档状态'] ?? row.status) !== '已生效') {
      continue
    }
    const station = String(row['站点编号'] ?? '')
    if (station === '') {
      continue
    }
    const prev = latestByStation.get(station)
    if (!prev || String(row['校准时间'] ?? '') >= String(prev['校准时间'] ?? '')) {
      latestByStation.set(station, row)
    }
  }
  const tempOf = (row: EntryRow | undefined): number => {
    const value = Number.parseFloat(String(row?.['复测值'] ?? ''))
    return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
  }
  return watchRows
    .map((row, index) => ({ row, index, hit: latestByStation.get(String(row['监测点编号'] ?? '')) }))
    .sort((a, b) => {
      if (!a.hit !== !b.hit) {
        return a.hit ? -1 : 1
      }
      if (a.hit && b.hit) {
        const byTemp = tempOf(b.hit) - tempOf(a.hit)
        if (byTemp !== 0) {
          return byTemp
        }
      }
      return a.index - b.index
    })
    .map((item, order) => ({ ...item.row, 关注顺序: order + 1 }))
}

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 提交校准：站点编号缺失不能形成有效校准；同一观测记录只接受先落库的一条。
// 口径约定：复测值与原始读数冲突时以复测值为生效口径，原始读数留在归档里追溯。
export function submitCalibration(input: CalibrationInput): ActionResult {
  const station = input.站点编号.trim()
  if (station === '') {
    return { ok: false, message: '站点编号缺失，不能形成有效校准' }
  }
  const remeasure = input.复测值.trim()
  if (remeasure === '') {
    return { ok: false, message: '请填写复测值，校准要有生效口径' }
  }
  const tags = calibrationTags()
  const tag = tags.includes(input.校准标签) ? input.校准标签 : '已修正'
  let result: ActionResult = { ok: false, message: '校准提交失败' }
  commitEntries((rows) => {
    const weatherRows = rows[WEATHER_KEY] ?? []
    const target = weatherRows.find((row) => Number(row.id) === input.recordId)
    if (!target) {
      result = { ok: false, message: `没有找到编号为 ${input.recordId} 的气象观测记录` }
      return false
    }
    const recordNo = String(target['记录编号'] ?? '')
    const archive = rows[ARCHIVE_KEY] ?? []
    // 先落库先赢：以刚读出的落库内容查重，已有校准归档时后到的提交直接拒掉
    const existing = archive.find((row) => String(row['记录编号'] ?? '') === recordNo)
    if (existing) {
      result = {
        ok: false,
        message: `${recordNo} 已有先落库的校准（${String(existing['校准编号'] ?? '')}），本次提交未接受`,
      }
      return false
    }
    const nextId = archive.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    const entry: EntryRow = {
      id: nextId,
      status: '已生效',
      pending: false,
      abnormal: tag === '异常值',
      校准编号: `CAL-${String(nextId).padStart(4, '0')}`,
      记录编号: recordNo,
      站点编号: station,
      观测时间: String(target['观测时间'] ?? ''),
      校准标签: tag,
      原始读数: String(target['气温'] ?? ''),
      复测值: remeasure,
      生效口径: '复测值',
      校准人: input.校准人.trim() || '值班校准员',
      校准时间: nowText(),
      归档状态: '已生效',
    }
    rows[ARCHIVE_KEY] = [...archive, entry]
    // 生效口径采用复测值：观测记录读数更新为复测值，原始读数留在归档里追溯
    rows[WEATHER_KEY] = weatherRows.map((row) =>
      Number(row.id) === input.recordId
        ? {
            ...row,
            气温: remeasure,
            记录状态: tag,
            status: tag,
            pending: false,
            abnormal: tag === '异常值',
          }
        : row,
    )
    // 校准落库后，火险监测的关注顺序跟着更新
    rows[FIREWATCH_KEY] = rankFirewatch(rows[FIREWATCH_KEY] ?? [], rows[ARCHIVE_KEY])
    result = {
      ok: true,
      message: `校准已落库（${String(entry['校准编号'])}），生效口径为复测值，火险监测关注顺序已更新`,
    }
    return true
  })
  return result
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
