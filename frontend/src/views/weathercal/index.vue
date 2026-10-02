<template>
  <section class="page" data-module="weathercal">
    <header class="page-head">
      <div>
        <h2>气象校准归档检索台</h2>
        <p class="page-desc">{{ meta.desc }}</p>
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
        <span>站点编号</span>
        <input v-model="query.站点编号" placeholder="按站点编号检索" />
      </label>
      <label class="filter-item">
        <span>校准标签</span>
        <select v-model="query.校准标签">
          <option value="">全部标签</option>
          <option v-for="tag in tagOptions" :key="tag" :value="tag">{{ tag }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>时间窗起</span>
        <input v-model="query.时间窗起" type="date" />
      </label>
      <label class="filter-item">
        <span>时间窗止</span>
        <input v-model="query.时间窗止" type="date" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetQuery">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'selected-row': Number(row.id) === selectedId }"
          @click="selectRow(row)"
        >
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length" class="empty-state">当前条件下没有校准归档记录</td>
        </tr>
      </tbody>
    </table>

    <div class="pager">
      <button class="btn" type="button" :disabled="page <= 1" @click="gotoPage(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ total }} 条校准记录</span>
      <button class="btn" type="button" :disabled="page >= pageCount" @click="gotoPage(page + 1)">下一页</button>
      <label class="pager-size">
        每页
        <select v-model.number="size" @change="gotoPage(1)">
          <option v-for="option in sizeOptions" :key="option" :value="option">{{ option }}</option>
        </select>
        条
      </label>
    </div>

    <section v-if="selected" class="record-strip">
      <div>
        <strong>{{ selected['校准编号'] }}</strong>
        · 站点 {{ selected['站点编号'] }} · {{ selected['观测时间'] }} · 标签「{{ selected['校准标签'] }}」
        <br />
        原始读数 {{ selected['原始读数'] }} → 复测值 {{ selected['复测值'] }}（生效口径：{{ selected['生效口径'] }}）
        · 校准人 {{ selected['校准人'] }} · {{ selected['校准时间'] }}
      </div>
      <div class="strip-actions">
        <span>第 {{ selectedIndex + 1 }} / {{ matchedTotal }} 条</span>
        <button class="btn" type="button" :disabled="selectedIndex <= 0" @click="locate(-1)">上一条</button>
        <button class="btn" type="button" :disabled="selectedIndex >= matchedTotal - 1" @click="locate(1)">下一条</button>
      </div>
    </section>

    <footer class="page-foot">
      <span>点击表格行可定位记录，「上一条 / 下一条」在当前筛选结果内翻页移动</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { calibrationTags, listArchive, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('weathercal')
const columns = meta.fields
const tagOptions = calibrationTags()
const sizeOptions = [3, 5, 10]

const query = ref({ 站点编号: '', 校准标签: '', 时间窗起: '', 时间窗止: '' })
const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(5)
const errorMessage = ref('')
const stats = ref([{ label: '归档条数', value: 0 }, { label: '涉及站点数', value: 0 }, { label: '异常值校准数', value: 0 }])

// 当前筛选下的完整有序列表：相邻记录定位以它为准，跨页时自动翻页
const matched = ref<EntryRow[]>([])
const selectedId = ref<number | null>(null)

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size.value)))
const matchedTotal = computed(() => matched.value.length)
const selectedIndex = computed(() =>
  matched.value.findIndex((row) => Number(row.id) === selectedId.value),
)
const selected = computed(() => (selectedIndex.value >= 0 ? matched.value[selectedIndex.value] : null))

function reload() {
  errorMessage.value = ''
  try {
    const all = listArchive(query.value)
    matched.value = all.items
    total.value = all.total
    const payload = listArchive(query.value, page.value, size.value)
    rows.value = payload.items
    if (selectedId.value !== null && selectedIndex.value < 0) {
      selectedId.value = null
    }
    const whole = listArchive()
    stats.value = [
      { label: '归档条数', value: whole.total },
      {
        label: '涉及站点数',
        value: new Set(whole.items.map((row) => String(row['站点编号'] ?? ''))).size,
      },
      {
        label: '异常值校准数',
        value: whole.items.filter((row) => String(row['校准标签']) === '异常值').length,
      },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '校准归档读取失败'
  }
}

function search() {
  page.value = 1
  reload()
}

function resetQuery() {
  query.value = { 站点编号: '', 校准标签: '', 时间窗起: '', 时间窗止: '' }
  page.value = 1
  reload()
}

function gotoPage(next: number) {
  page.value = Math.min(Math.max(next, 1), pageCount.value)
  reload()
}

function selectRow(row: EntryRow) {
  selectedId.value = Number(row.id)
}

// 定位相邻观测记录：在当前筛选结果的有序列表里前后移动，跨页时带着页码一起走
function locate(step: number) {
  const index = selectedIndex.value + step
  if (index < 0 || index >= matched.value.length) {
    return
  }
  selectedId.value = Number(matched.value[index].id)
  const targetPage = Math.floor(index / size.value) + 1
  if (targetPage !== page.value) {
    page.value = targetPage
    reload()
  }
}

onMounted(reload)
</script>
