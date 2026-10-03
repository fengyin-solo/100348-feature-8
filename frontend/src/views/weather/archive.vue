<template>
  <section class="page" data-module="weather-archive">
    <header class="page-head">
      <div>
        <h2>气象校准归档台</h2>
        <p class="page-desc">
          按站点、时间窗、校准标签检索归档记录；复测值与原始读数冲突时以复测值为生效读数，原始读数保留备查。两人同时校准时只接受先落库的一条。
        </p>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="search">
      <label class="filter-item">
        <span>观测站点</span>
        <input v-model="filters.station" list="archive-stations" placeholder="按站点检索" />
        <datalist id="archive-stations">
          <option v-for="station in stations" :key="station" :value="station" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>时间窗起</span>
        <input v-model="filters.from" type="date" />
      </label>
      <label class="filter-item">
        <span>时间窗止</span>
        <input v-model="filters.to" type="date" />
      </label>
      <label class="filter-item">
        <span>校准标签</span>
        <select v-model="filters.tag">
          <option value="">全部标签</option>
          <option v-for="tag in tags" :key="tag" :value="tag">{{ tag }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>观测站点</th>
          <th>观测时间</th>
          <th>原始气温</th>
          <th>复测气温</th>
          <th>生效气温</th>
          <th>原始湿度</th>
          <th>复测湿度</th>
          <th>生效湿度</th>
          <th>降水量</th>
          <th>校准标签</th>
          <th>校准版本</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-active': selectedId === Number(row.id) }">
          <td>{{ row['记录编号'] }}</td>
          <td>
            <span v-if="stationOf(row)">{{ stationOf(row) }}</span>
            <span v-else class="error-text">站点缺失</span>
          </td>
          <td>{{ row['观测时间'] }}</td>
          <td>{{ row['气温'] ?? '—' }}</td>
          <td>{{ row['复测气温'] || '—' }}</td>
          <td><strong>{{ effectiveReading(row, '复测气温', '气温') || '—' }}</strong></td>
          <td>{{ row['相对湿度'] ?? '—' }}</td>
          <td>{{ row['复测湿度'] || '—' }}</td>
          <td><strong>{{ effectiveReading(row, '复测湿度', '相对湿度') || '—' }}</strong></td>
          <td>{{ row['降水量'] ?? '—' }}</td>
          <td><span class="legend-item">{{ row.status }}</span></td>
          <td>{{ calibrationRevision(row) }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="selectRecord(Number(row.id))">校准</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="13" class="empty-state">当前条件下没有归档记录，调整站点、时间窗或校准标签再查</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条归档记录</span>
      <span class="pager">
        <label>
          每页
          <select v-model.number="size" @change="search">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
          </select>
          条
        </label>
        <button class="btn" type="button" :disabled="page <= 1" @click="gotoPage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ pages }} 页</span>
        <button class="btn" type="button" :disabled="page >= pages" @click="gotoPage(page + 1)">下一页</button>
      </span>
    </footer>

    <section v-if="selected" class="panel">
      <header class="panel-head">
        <strong>
          校准 {{ selected['记录编号'] }} · {{ stationOf(selected) || '站点缺失' }} · {{ selected['观测时间'] }}
        </strong>
        <span class="pager">
          <button class="btn" type="button" :disabled="!hasPrev" @click="gotoAdjacent(-1)">上一条</button>
          <button class="btn" type="button" :disabled="!hasNext" @click="gotoAdjacent(1)">下一条</button>
        </span>
      </header>

      <p class="panel-meta">
        原始读数：气温 {{ selected['气温'] ?? '—' }}℃、湿度 {{ selected['相对湿度'] ?? '—' }}%；
        当前生效：气温 {{ effectiveReading(selected, '复测气温', '气温') || '—' }}℃、湿度
        {{ effectiveReading(selected, '复测湿度', '相对湿度') || '—' }}%；
        校准标签「{{ selected.status }}」· 校准版本 {{ expectedRevision }}
        <template v-if="selected['校准人']">
          · 最近校准：{{ selected['校准人'] }} {{ selected['校准时间'] }}
        </template>
      </p>

      <p v-if="!stationOf(selected)" class="error-text">站点编号缺失，不能形成有效校准。</p>

      <form class="filter-bar" @submit.prevent="submit">
        <label class="filter-item">
          <span>复测气温（℃）</span>
          <input v-model="form.remeasureTemp" placeholder="以复测值为生效读数" />
        </label>
        <label class="filter-item">
          <span>复测湿度（%）</span>
          <input v-model="form.remeasureHumidity" placeholder="以复测值为生效读数" />
        </label>
        <label class="filter-item panel-note">
          <span>校准说明</span>
          <input v-model="form.note" placeholder="复测方式、仪器、偏差原因" />
        </label>
        <button class="btn primary" type="submit" :disabled="!stationOf(selected)">提交校准</button>
      </form>
      <p class="panel-meta">校准人：{{ store.operator }}；提交后以先落库的一条为准，版本不符会被拒绝。</p>
    </section>

    <footer class="page-foot">
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  calibrationRevision,
  effectiveReading,
  getWeatherRecord,
  listWeatherArchive,
  listWeatherStations,
  submitCalibration,
  weatherArchiveStats,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

// 校准标签沿用气象观测既有的四个状态，老数据不用迁移。
const tags = ['已录入', '已审核', '已修正', '异常值']

const store = useSessionStore()

const filters = ref({ station: '', from: '', to: '', tag: '' })
const page = ref(1)
const size = ref(5)
const rows = ref<EntryRow[]>([])
const total = ref(0)
const sequence = ref<number[]>([])
const stats = ref<{ label: string; value: number }[]>([])
const stations = ref<string[]>([])
const errorMessage = ref('')
const notice = ref('')

const selected = ref<EntryRow | null>(null)
const selectedId = ref(0)
const expectedRevision = ref(0)
const form = ref({ remeasureTemp: '', remeasureHumidity: '', note: '' })

const pages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const selectedIndex = computed(() => sequence.value.indexOf(selectedId.value))
const hasPrev = computed(() => selectedIndex.value > 0)
const hasNext = computed(() => selectedIndex.value >= 0 && selectedIndex.value < sequence.value.length - 1)

function stationOf(row: EntryRow): string {
  return String(row['观测站点'] ?? '').trim()
}

function reload() {
  const result = listWeatherArchive({ ...filters.value, page: page.value, size: size.value })
  rows.value = result.items
  total.value = result.total
  page.value = result.page
  sequence.value = result.sequence
  stats.value = weatherArchiveStats()
  stations.value = listWeatherStations()
}

function search() {
  page.value = 1
  reload()
}

function resetFilters() {
  filters.value = { station: '', from: '', to: '', tag: '' }
  search()
}

function gotoPage(target: number) {
  page.value = target
  reload()
}

function selectRecord(id: number) {
  const record = getWeatherRecord(id)
  if (!record) {
    selected.value = null
    selectedId.value = 0
    return
  }
  selected.value = record
  selectedId.value = id
  // 快照当前校准版本，提交时带上；落库前版本被抢先就拒绝本次提交。
  expectedRevision.value = calibrationRevision(record)
  form.value = {
    remeasureTemp: String(record['复测气温'] ?? ''),
    remeasureHumidity: String(record['复测湿度'] ?? ''),
    note: String(record['校准说明'] ?? ''),
  }
}

// 相邻定位基于本次检索的完整命中序列，跨页时自动翻页。
function gotoAdjacent(offset: number) {
  const targetIndex = selectedIndex.value + offset
  const target = sequence.value[targetIndex]
  if (target === undefined) {
    return
  }
  const targetPage = Math.floor(targetIndex / size.value) + 1
  if (targetPage !== page.value) {
    page.value = targetPage
    reload()
  }
  selectRecord(target)
}

function submit() {
  if (!selected.value) {
    return
  }
  errorMessage.value = ''
  notice.value = ''
  const result = submitCalibration({
    id: selectedId.value,
    expectedRevision: expectedRevision.value,
    remeasureTemp: form.value.remeasureTemp,
    remeasureHumidity: form.value.remeasureHumidity,
    note: form.value.note,
    operator: store.operator,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  } else {
    notice.value = result.message
  }
  // 无论成败都回到落库最新状态：被抢先时校准员基于最新版本复核。
  selectRecord(selectedId.value)
  reload()
}

onMounted(reload)
</script>
