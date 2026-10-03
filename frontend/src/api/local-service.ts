import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, persistAll, readPersisted, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  CalibrationPayload,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  WeatherArchiveQuery,
  WeatherArchiveResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
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
  if (key === 'firewatch') {
    // 监测点状态变了，关注顺序跟着重排，和校准触发的重排走同一条逻辑。
    refreshFirewatchAttention()
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

/* ------------------------------------------------------------------ */
/* 气象校准归档台：沿既有 视图 → local-service → local-store 链路扩展， */
/* 不另起数据通道。                                                     */

// 口径约定：复测值与原始读数冲突时，以复测值为生效读数（归档展示与火险联动都用它），
// 原始读数只读保留在归档里备查，不改不删。
export function effectiveReading(row: EntryRow, remeasureField: string, rawField: string): string {
  const remeasured = String(row[remeasureField] ?? '').trim()
  return remeasured !== '' ? remeasured : String(row[rawField] ?? '')
}

function effectiveNumber(row: EntryRow, remeasureField: string, rawField: string): number | null {
  const parsed = Number.parseFloat(effectiveReading(row, remeasureField, rawField))
  return Number.isFinite(parsed) ? parsed : null
}

// 老数据没有校准版本字段，按 0 算，兼容保留。
export function calibrationRevision(row: EntryRow): number {
  const revision = Number(row['校准版本'] ?? 0)
  return Number.isFinite(revision) ? revision : 0
}

// 归档检索：按站点、时间窗、校准标签过滤，按观测时间倒序归档后分页；
// sequence 记下全部命中 id，校准面板靠它定位上一条/下一条。
export function listWeatherArchive(query: WeatherArchiveQuery): WeatherArchiveResult {
  const station = query.station.trim()
  const from = query.from.trim()
  const to = query.to.trim()
  const tag = query.tag.trim()
  const matched = listRows('weather')
    .filter((row) => station === '' || String(row['观测站点'] ?? '').includes(station))
    .filter((row) => {
      const observedAt = String(row['观测时间'] ?? '')
      if (from !== '' && observedAt < from) {
        return false
      }
      // 截止只给日期时放宽到当天最后一分钟，时间窗才闭得上。
      if (to !== '' && observedAt > (to.length === 10 ? `${to} 23:59` : to)) {
        return false
      }
      return true
    })
    .filter((row) => tag === '' || String(row.status) === tag)
    .sort((a, b) => {
      const byTime = String(b['观测时间'] ?? '').localeCompare(String(a['观测时间'] ?? ''))
      return byTime !== 0 ? byTime : Number(b.id) - Number(a.id)
    })
  const size = Math.max(1, query.size)
  const pages = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.min(Math.max(1, query.page), pages)
  const items = matched.slice((page - 1) * size, page * size)
  return { items, total: matched.length, page, size, sequence: matched.map((row) => Number(row.id)) }
}

export function getWeatherRecord(id: number): EntryRow | undefined {
  return listRows('weather').find((row) => Number(row.id) === id)
}

// 归档台筛选用的站点清单：从既有观测记录里取，不另建站点台账。
export function listWeatherStations(): string[] {
  const names = listRows('weather')
    .map((row) => String(row['观测站点'] ?? '').trim())
    .filter((name) => name !== '')
  return [...new Set(names)].sort()
}

export function weatherArchiveStats(): { label: string; value: number }[] {
  const rows = listRows('weather')
  return [
    { label: '归档记录', value: rows.length },
    { label: '已修正', value: rows.filter((row) => row.status === '已修正').length },
    { label: '异常值', value: rows.filter((row) => row.status === '异常值').length },
    { label: '观测站点', value: listWeatherStations().length },
  ]
}

function nowLabel(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 提交校准：两个人同时提交时只接受先落库的一条。
// 做法：提交瞬间绕过缓存直读落库状态、比对校准版本，读-比-写在同一个同步函数里完成；
// 另一个标签页只要先写入，这里看到的版本就对不上，本次提交被拒绝。
export function submitCalibration(payload: CalibrationPayload): ActionResult {
  const persisted = readPersisted()
  const rows = persisted['weather'] ?? []
  const index = rows.findIndex((row) => Number(row.id) === payload.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${payload.id} 的气象观测记录` }
  }
  const record = rows[index]
  const station = String(record['观测站点'] ?? '').trim()
  if (station === '') {
    return { ok: false, message: '站点编号缺失，不能形成有效校准' }
  }
  if (calibrationRevision(record) !== payload.expectedRevision) {
    return { ok: false, message: '该记录已被其他校准员先行校准落库，本次提交未生效，请刷新后复核' }
  }
  if (payload.remeasureTemp.trim() === '' || payload.remeasureHumidity.trim() === '') {
    return { ok: false, message: '复测气温、复测湿度都要填，校准才完整' }
  }
  const updated: EntryRow = {
    ...record,
    status: '已修正',
    pending: false,
    abnormal: false,
    复测气温: payload.remeasureTemp.trim(),
    复测湿度: payload.remeasureHumidity.trim(),
    校准说明: payload.note.trim(),
    校准人: payload.operator,
    校准时间: nowLabel(),
    校准版本: calibrationRevision(record) + 1,
  }
  const nextWeather = [...rows]
  nextWeather[index] = updated
  persisted['weather'] = nextWeather
  // 校准落库后，火险监测的关注顺序跟着重排，与校准在同一次写入里完成。
  persisted['firewatch'] = rankFirewatchAttention(nextWeather, persisted['firewatch'] ?? [])
  persistAll(persisted)
  return { ok: true, message: `校准已落库（版本 ${String(updated['校准版本'])}），记录转为「已修正」，火险关注顺序已重排` }
}

/* 火险监测关注顺序：校准落库后跟着更新。 */

// 只有审核过的读数才进入火险联动口径：已审核/已修正可信；已录入未核、异常值剔除。
const TRUSTED_WEATHER_TAGS = ['已审核', '已修正']

// 关注分 = 预警状态基础分 + 站点气象修正分；分高者排前，同分按监测点编号升序，结果稳定。
const FIREWATCH_STATUS_WEIGHT: Record<string, number> = {
  红色预警: 40,
  橙色预警: 30,
  黄色预警: 20,
  蓝色预警: 10,
  正常: 0,
}

function latestTrustedByStation(weatherRows: EntryRow[]): Map<string, EntryRow> {
  const latest = new Map<string, EntryRow>()
  for (const row of weatherRows) {
    if (!TRUSTED_WEATHER_TAGS.includes(String(row.status))) {
      continue
    }
    const station = String(row['观测站点'] ?? '').trim()
    if (station === '') {
      continue
    }
    const current = latest.get(station)
    const observedAt = String(row['观测时间'] ?? '')
    const currentAt = String(current?.['观测时间'] ?? '')
    if (!current || observedAt > currentAt || (observedAt === currentAt && Number(row.id) > Number(current.id))) {
      latest.set(station, row)
    }
  }
  return latest
}

function weatherAdjustment(stationLatest: Map<string, EntryRow>, region: string): number {
  const row = stationLatest.get(region.trim())
  if (!row) {
    return 0
  }
  const temp = effectiveNumber(row, '复测气温', '气温')
  const humidity = effectiveNumber(row, '复测湿度', '相对湿度')
  const rain = Number.parseFloat(String(row['降水量'] ?? ''))
  let score = 0
  if (temp !== null) {
    score += temp >= 35 ? 10 : temp >= 30 ? 5 : 0
  }
  if (humidity !== null) {
    score += humidity <= 30 ? 10 : humidity <= 40 ? 5 : 0
  }
  if (Number.isFinite(rain) && rain === 0) {
    score += 3
  }
  return score
}

function rankFirewatchAttention(weatherRows: EntryRow[], firewatchRows: EntryRow[]): EntryRow[] {
  const stationLatest = latestTrustedByStation(weatherRows)
  return firewatchRows
    .map((row) => ({
      row,
      score:
        (FIREWATCH_STATUS_WEIGHT[String(row.status)] ?? 0) +
        weatherAdjustment(stationLatest, String(row['监测区域'] ?? '')),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      const byCode = String(a.row['监测点编号'] ?? '').localeCompare(String(b.row['监测点编号'] ?? ''))
      return byCode !== 0 ? byCode : Number(a.row.id) - Number(b.row.id)
    })
    .map((entry, index) => ({ ...entry.row, 关注顺序: String(index + 1) }))
}

// 校准完成或监测点状态流转后调用：重算关注顺序并落库，火险监测列表按新顺序展示。
export function refreshFirewatchAttention(): void {
  const persisted = readPersisted()
  persisted['firewatch'] = rankFirewatchAttention(persisted['weather'] ?? [], persisted['firewatch'] ?? [])
  persistAll(persisted)
}

// 兼容旧数据：老 localStorage 里的监测点没有关注顺序字段，进页面时补排一次。
export function ensureFirewatchAttention(): void {
  const rows = listRows('firewatch')
  if (rows.some((row) => String(row['关注顺序'] ?? '').trim() === '')) {
    refreshFirewatchAttention()
  }
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
