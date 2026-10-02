/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 校准提交入参：站点编号缺失时不能形成有效校准。 */
export type CalibrationInput = {
  recordId: number
  站点编号: string
  复测值: string
  校准标签: string
  校准人: string
}

/** 归档检索台的查询条件：站点、时间窗、校准标签。 */
export type ArchiveQuery = {
  站点编号?: string
  校准标签?: string
  时间窗起?: string
  时间窗止?: string
}
