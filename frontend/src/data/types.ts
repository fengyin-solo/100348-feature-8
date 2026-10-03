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

// 气象校准归档台的检索条件：站点、时间窗、校准标签，加分页。
export type WeatherArchiveQuery = {
  station: string
  from: string
  to: string
  tag: string
  page: number
  size: number
}

// sequence 是本次检索命中的全部记录 id（按归档排序），校准面板靠它定位相邻记录。
export type WeatherArchiveResult = PageResult & {
  sequence: number[]
}

// 校准提交：expectedRevision 是打开校准面板时看到的校准版本，落库前比对它实现「先落库为准」。
export type CalibrationPayload = {
  id: number
  expectedRevision: number
  remeasureTemp: string
  remeasureHumidity: string
  note: string
  operator: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
