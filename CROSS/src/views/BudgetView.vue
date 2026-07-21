<template>
  <div class="budget-view">
    <el-row :gutter="0" class="budget-layout">
      <el-col :span="14" class="ledger-column">
        <el-card class="budget-ledger" shadow="never">
          <template #header>
            <div class="card-header">
              <span>预算明细</span>
              <el-button type="primary" @click="showAddDialog = true">
                <el-icon><Plus /></el-icon>
                添加预算项
              </el-button>
            </div>
          </template>

          <el-table :data="budgetItems" style="width: 100%">
            <el-table-column prop="day" label="天数" width="80" />
            <el-table-column prop="type" label="类型" width="120">
              <template #default="{ row }">
                <el-tag effect="plain" class="budget-type-tag" :style="budgetTypeStyle(row.type)">{{ row.type }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" />
            <el-table-column prop="amount" label="金额" width="120" align="right">
              <template #default="{ row }">
                ¥{{ row.amount.toFixed(2) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row }">
                <el-button
                  type="danger"
                  :icon="Delete"
                  circle
                  size="small"
                  @click="removeBudgetItem(row.id)"
                />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="10" class="statistics-column">
        <el-card class="statistics-card" shadow="never">
          <template #header>
            <span>预算统计</span>
          </template>

          <div class="budget-summary">
            <div class="summary-item">
              <div class="summary-label">总预算</div>
              <div class="summary-value total">¥{{ totalBudget.toFixed(2) }}</div>
            </div>

            <el-divider />

            <div class="summary-section">
              <h4>按类型统计</h4>
              <div
                v-for="(amount, type) in budgetByType"
                :key="type"
                class="summary-item"
              >
                <div class="summary-label"><span class="summary-dot" :style="budgetTypeStyle(String(type))"></span>{{ type }}</div>
                <div class="summary-value">¥{{ amount.toFixed(2) }}</div>
              </div>
            </div>

            <el-divider />

            <div class="summary-section">
              <h4>按天数统计</h4>
              <div
                v-for="(amount, day) in budgetByDay"
                :key="day"
                class="summary-item"
              >
                <div class="summary-label">第 {{ day }} 天</div>
                <div class="summary-value">¥{{ amount.toFixed(2) }}</div>
              </div>
            </div>
          </div>

          <el-divider />

          <div class="chart-container">
            <v-chart :option="chartOption" class="budget-chart" autoresize />
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 添加预算项对话框 -->
    <el-dialog v-model="showAddDialog" title="添加预算项" width="500px">
      <el-form :model="newBudgetItem" label-width="80px">
        <el-form-item label="天数">
          <el-input-number v-model="newBudgetItem.day" :min="1" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="newBudgetItem.type" placeholder="选择类型">
            <el-option label="交通" value="交通" />
            <el-option label="住宿" value="住宿" />
            <el-option label="餐饮" value="餐饮" />
            <el-option label="景点" value="景点" />
            <el-option label="购物" value="购物" />
            <el-option label="其他" value="其他" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newBudgetItem.description" />
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="newBudgetItem.amount" :min="0" :precision="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="addBudgetItem">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { PieChart, BarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
} from 'echarts/components'
import VChart from 'vue-echarts'
import { useTripStore } from '@/store/trip'
import type { BudgetItem } from '@/types'
import { Plus, Delete } from '@element-plus/icons-vue'

use([
  CanvasRenderer,
  PieChart,
  BarChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
])

const tripStore = useTripStore()

const budgetItems = computed(() => tripStore.budgetItems)
const totalBudget = computed(() => tripStore.totalBudget)
const budgetByType = computed(() => tripStore.budgetByType)
const budgetByDay = computed(() => tripStore.budgetByDay)

const showAddDialog = ref(false)
const newBudgetItem = ref<Partial<BudgetItem>>({
  day: 1,
  type: '交通',
  description: '',
  amount: 0,
  currency: 'CNY'
})

const BUDGET_TYPE_COLORS: Record<BudgetItem['type'], string> = {
  交通: '#5B6B73',
  住宿: '#5F7267',
  餐饮: '#A14B3C',
  景点: '#8A8798',
  门票: '#8A8798',
  购物: '#B6A18A',
  其他: '#697177'
}

function budgetTypeColor(type: string) {
  return BUDGET_TYPE_COLORS[type as BudgetItem['type']] || BUDGET_TYPE_COLORS.其他
}

function budgetTypeStyle(type: string) {
  return { '--budget-type-color': budgetTypeColor(type) }
}

const chartOption = computed(() => {
  const typeData = Object.entries(budgetByType.value).map(([name, value]) => ({
    name,
    value,
    itemStyle: { color: budgetTypeColor(name) }
  }))

  return {
    color: Object.values(BUDGET_TYPE_COLORS),
    title: {
      text: '预算分布',
      left: 'center',
      top: 6,
      textStyle: {
        color: '#1D2226',
        fontFamily: 'MiSans, HarmonyOS Sans SC, PingFang SC, sans-serif',
        fontSize: 12,
        fontWeight: 560
      }
    },
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b}: ¥{c} ({d}%)',
      backgroundColor: 'rgba(220, 223, 222, 0.96)',
      borderColor: 'rgba(29, 34, 38, 0.18)',
      textStyle: { color: '#1D2226' }
    },
    series: [
      {
        name: '预算类型',
        type: 'pie',
        radius: ['34%', '54%'],
        center: ['50%', '58%'],
        itemStyle: {
          borderColor: '#D8DCDD',
          borderWidth: 2
        },
        label: {
          show: false
        },
        labelLine: { show: false },
        data: typeData,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(29, 34, 38, 0.24)'
          }
        }
      }
    ]
  }
})

function addBudgetItem() {
  if (!newBudgetItem.value.description || !newBudgetItem.value.amount) {
    return
  }

  const item: BudgetItem = {
    id: Date.now().toString(),
    day: newBudgetItem.value.day || 1,
    type: newBudgetItem.value.type as BudgetItem['type'],
    description: newBudgetItem.value.description,
    amount: newBudgetItem.value.amount || 0,
    currency: 'CNY'
  }

  tripStore.addBudgetItem(item)
  showAddDialog.value = false

  // 重置表单
  newBudgetItem.value = {
    day: 1,
    type: '交通',
    description: '',
    amount: 0,
    currency: 'CNY'
  }
}

function removeBudgetItem(id: string) {
  tripStore.removeBudgetItem(id)
}
</script>

<style scoped>
.budget-view {
  padding: 0;
  background: var(--cross-canvas);
  min-height: calc(100vh - 60px);
  overflow-y: auto;
}

.budget-layout {
  min-height: calc(100vh - 60px);
  margin-right: 0 !important;
}

.ledger-column,
.statistics-column {
  padding: 34px 40px !important;
}

.statistics-column {
  border-left: 1px solid var(--cross-ink-faint);
}

.budget-ledger,
.statistics-card {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.budget-ledger :deep(.el-card__header),
.statistics-card :deep(.el-card__header) {
  padding: 12px 0 18px;
}

.budget-ledger :deep(.el-card__body) {
  padding: 0;
}

.statistics-column {
  min-width: 0;
}

.statistics-card :deep(.el-card__header) {
  padding: 12px 0 16px;
  color: var(--cross-ink);
  font-size: 14px;
  font-weight: 560;
}

.statistics-card {
  min-height: 0;
}

.statistics-card :deep(.el-card__body) {
  padding: 0;
}

.statistics-card :deep(.el-divider--horizontal) {
  margin: 8px 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.budget-summary {
  padding: 0;
}

.summary-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 7px 0;
}

.summary-section .summary-item {
  border-bottom: 1px solid rgba(32, 37, 41, .16);
}

.summary-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #5b6b73;
  font-size: 12px;
}

.summary-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--budget-type-color);
}

.summary-value {
  font-size: 13px;
  font-weight: 520;
  color: #1d2226;
}

.summary-value.total {
  font-size: 24px;
  font-weight: 600;
  color: var(--cross-ink);
}

.summary-section {
  margin: 8px 0;
}

.summary-section h4 {
  margin: 0 0 3px;
  color: #1d2226;
  font-size: 13px;
  font-weight: 560;
}

.chart-container {
  height: 250px;
  margin-top: 10px;
  overflow: hidden;
}

.budget-chart {
  width: 100%;
  height: 100%;
}

.budget-type-tag {
  --el-tag-bg-color: transparent;
  --el-tag-border-color: transparent;
  --el-tag-text-color: var(--budget-type-color);
  display: inline-flex;
  gap: 6px;
  border-radius: 0;
  padding: 0;
  color: var(--budget-type-color);
  letter-spacing: .02em;
}

.budget-type-tag::before {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: 50% 44% 53% 46%;
  background: currentColor;
  content: '';
  opacity: .72;
}

@media (max-width: 900px) {
  .budget-view {
    padding: 0;
  }

  .ledger-column,
  .statistics-column {
    max-width: 100%;
    flex: 0 0 100%;
    padding: 24px 18px !important;
  }

  .statistics-column {
    border-top: 1px solid var(--cross-ink-faint);
    border-left: 0;
  }

  .statistics-card {
    min-height: 0;
  }

  .chart-container { height: 230px; }
}
</style>

