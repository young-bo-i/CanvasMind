<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import {
  listVendorScopes,
  listVendorSettings,
  updateVendorSetting,
  type VendorModelBillingRule,
  type VendorSettingItem,
} from '@/api/admin-vendor-settings'

const auth = useAuthStore()
const isSuperAdmin = auth.isSuperAdmin
// 超管可切换作用域(全局 + 各普通管理员)；普管固定自己。scope 值：'global' 或 管理员 id。
const scopeOptions = ref<Array<{ value: string; label: string }>>([])
const selectedScope = ref('global')

interface EditModel {
  modelKey: string
  name: string
  category: 'IMAGE' | 'VIDEO'
  mode: string
  enabled: boolean
  resolutionPrices: Array<{ key: string; value: number }>
  isToken: boolean
  tokenInput: number
  tokenOutput: number
  power: number
}

interface EditVendor {
  vendorCode: string
  name: string
  baseUrl: string
  supportedTypes: string[]
  hasApiKey: boolean
  apiKeyHint: string
  isEnabled: boolean
  apiKeyInput: string
  saving: boolean
  models: EditModel[]
}

const vendors = ref<EditVendor[]>([])
const originals = ref<VendorSettingItem[]>([])
const loading = ref(false)

const readNum = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const toEditModel = (m: VendorSettingItem['models'][number]): EditModel => {
  const rule: VendorModelBillingRule = { ...(m.override?.billingRule || m.defaultBillingRule || {}) }
  const mode = String(rule.imageBillingMode || rule.videoBillingMode || 'per_image')
  const isToken = mode === 'per_token'
  const resMap = (rule.imageResolutionPrices || rule.videoResolutionPrices || {}) as Record<string, number>
  return {
    modelKey: m.modelKey,
    name: m.name,
    category: m.category,
    mode,
    enabled: m.override?.enabled !== false,
    resolutionPrices: Object.entries(resMap).map(([key, value]) => ({ key, value: readNum(value) })),
    isToken,
    tokenInput: readNum(rule.imageInputPricePer1M),
    tokenOutput: readNum(rule.imageOutputPricePer1M),
    power: readNum(rule.power),
  }
}

const toEditVendor = (v: VendorSettingItem): EditVendor => ({
  vendorCode: v.vendorCode,
  name: v.name,
  baseUrl: v.baseUrl,
  supportedTypes: v.supportedTypes,
  hasApiKey: v.hasApiKey,
  apiKeyHint: v.apiKeyHint,
  isEnabled: v.isEnabled,
  apiKeyInput: '',
  saving: false,
  models: [...v.models].sort((a, b) => a.sortOrder - b.sortOrder).map(toEditModel),
})

// 由编辑态回建 billingRule：以内置默认为底(保模式等)，覆盖分辨率单价 / token 单价 / power。
const buildBillingRule = (base: VendorModelBillingRule | null, m: EditModel): VendorModelBillingRule => {
  const rule: VendorModelBillingRule = { ...(base || {}) }
  if (m.resolutionPrices.length) {
    const map: Record<string, number> = {}
    for (const p of m.resolutionPrices) map[p.key] = readNum(p.value)
    if (m.category === 'IMAGE') rule.imageResolutionPrices = map
    else rule.videoResolutionPrices = map
  }
  if (m.isToken) {
    rule.imageInputPricePer1M = readNum(m.tokenInput)
    rule.imageOutputPricePer1M = readNum(m.tokenOutput)
  }
  rule.power = readNum(m.power)
  return rule
}

const save = async (vendor: EditVendor, original: VendorSettingItem | undefined) => {
  vendor.saving = true
  try {
    const pricing: Record<string, { enabled: boolean; billingRule: VendorModelBillingRule }> = {}
    for (const m of vendor.models) {
      const base = original?.models.find(x => x.modelKey === m.modelKey)?.defaultBillingRule || null
      pricing[m.modelKey] = { enabled: m.enabled, billingRule: buildBillingRule(base, m) }
    }
    const payload: Parameters<typeof updateVendorSetting>[1] = {
      isEnabled: vendor.isEnabled,
      pricing,
    }
    // 只有填了新 key 才提交(空=不改动已存的 key)。
    if (vendor.apiKeyInput.trim()) payload.apiKey = vendor.apiKeyInput.trim()

    const data = await updateVendorSetting(vendor.vendorCode, payload, selectedScope.value)
    vendors.value = (data || []).map(toEditVendor)
    originals.value = data || []
    ElMessage.success(`${vendor.name} 已保存`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    vendor.saving = false
  }
}

const load = async () => {
  loading.value = true
  try {
    const data = await listVendorSettings(isSuperAdmin.value ? selectedScope.value : undefined)
    originals.value = data || []
    vendors.value = (data || []).map(toEditVendor)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

// 超管切换作用域 → 重新加载该管理员的配置。
const onScopeChange = () => { void load() }

onMounted(async () => {
  if (isSuperAdmin.value) {
    try {
      const scopes = await listVendorScopes()
      scopeOptions.value = (scopes || []).map((s) => ({ value: s.scopeId ?? 'global', label: s.label }))
    } catch { /* 忽略：拿不到作用域清单时退回仅全局 */ }
  }
  await load()
})
</script>

<template>
  <div class="admin-vendor-settings" v-loading="loading">
    <div class="page-head">
      <h2>厂商密钥 / 定价</h2>
      <p class="hint">图片走 CometAPI、视频走 chengmeng（厂商与模型已内置）。这里只需填各自的 API Key，并按需调价。价格默认按成本 60% 加价（1 积分 = 1 元）。</p>
    </div>

    <!-- 超管：选择要配置哪个管理员的作用域（全局 = 超管/平台直属；其余为各普通管理员，其名下用户走该管理员的 key）。 -->
    <div v-if="isSuperAdmin && scopeOptions.length" class="scope-row">
      <span class="scope-label">配置作用域</span>
      <el-select v-model="selectedScope" class="scope-select" @change="onScopeChange">
        <el-option v-for="opt in scopeOptions" :key="opt.value" :value="opt.value" :label="opt.label" />
      </el-select>
      <span class="scope-tip">超管可分别为每个管理员配置其密钥与定价；该管理员名下所有用户（含其本人）都走这套。</span>
    </div>

    <el-card v-for="vendor in vendors" :key="vendor.vendorCode" class="vendor-card" shadow="never">
      <div class="vendor-head">
        <div class="vendor-title">
          <span class="vendor-name">{{ vendor.name }}</span>
          <span class="vendor-base">{{ vendor.baseUrl }}</span>
          <el-tag v-for="t in vendor.supportedTypes" :key="t" size="small" class="type-tag">{{ t === 'IMAGE' ? '图片' : t === 'VIDEO' ? '视频' : t }}</el-tag>
        </div>
        <el-switch v-model="vendor.isEnabled" active-text="启用" inline-prompt />
      </div>

      <div class="key-row">
        <span class="key-label">API Key</span>
        <el-input
          v-model="vendor.apiKeyInput"
          type="password"
          show-password
          clearable
          :placeholder="vendor.hasApiKey ? `已配置（${vendor.apiKeyHint}）· 留空则不修改` : '未配置，请填写'"
          class="key-input"
        />
      </div>

      <el-table :data="vendor.models" size="small" class="model-table">
        <el-table-column prop="name" label="模型" min-width="150" />
        <el-table-column label="类目" width="70">
          <template #default="{ row }">{{ row.category === 'IMAGE' ? '图片' : '视频' }}</template>
        </el-table-column>
        <el-table-column label="计费" width="110">
          <template #default="{ row }">{{ row.mode }}</template>
        </el-table-column>
        <el-table-column label="单价（积分）" min-width="260">
          <template #default="{ row }">
            <div class="price-cell">
              <template v-if="row.isToken">
                <label>输入/1M</label><el-input-number v-model="row.tokenInput" :min="0" :step="1" :controls="false" size="small" class="pn" />
                <label>输出/1M</label><el-input-number v-model="row.tokenOutput" :min="0" :step="1" :controls="false" size="small" class="pn" />
              </template>
              <template v-else-if="row.resolutionPrices.length">
                <span v-for="p in row.resolutionPrices" :key="p.key" class="res-price">
                  <label>{{ p.key }}</label><el-input-number v-model="p.value" :min="0" :step="0.01" :precision="2" :controls="false" size="small" class="pn" />
                </span>
              </template>
              <template v-else>
                <label>每次</label><el-input-number v-model="row.power" :min="0" :step="0.01" :precision="2" :controls="false" size="small" class="pn" />
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="70">
          <template #default="{ row }"><el-switch v-model="row.enabled" size="small" /></template>
        </el-table-column>
      </el-table>

      <div class="vendor-foot">
        <el-button type="primary" :loading="vendor.saving" @click="save(vendor, originals.find(o => o.vendorCode === vendor.vendorCode))">保存 {{ vendor.name }}</el-button>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.admin-vendor-settings { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.page-head h2 { margin: 0 0 4px; font-size: 18px; }
.page-head .hint { margin: 0; color: var(--text-secondary, #909399); font-size: 13px; }
.scope-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 14px; background: var(--background-secondary, #f5f7fa); border-radius: 8px; }
.scope-label { font-weight: 600; font-size: 14px; }
.scope-select { min-width: 260px; }
.scope-tip { color: var(--text-secondary, #909399); font-size: 12px; }
.vendor-card { border-radius: 10px; }
.vendor-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.vendor-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.vendor-name { font-weight: 600; font-size: 15px; }
.vendor-base { color: var(--text-secondary, #909399); font-size: 12px; }
.key-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.key-label { width: 64px; color: var(--text-secondary, #606266); font-size: 13px; }
.key-input { max-width: 520px; }
.price-cell { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.price-cell label, .res-price label { font-size: 12px; color: var(--text-secondary, #909399); margin-right: 4px; }
.res-price { display: inline-flex; align-items: center; }
.pn { width: 84px; }
.vendor-foot { margin-top: 12px; display: flex; justify-content: flex-end; }
.type-tag { margin-left: 2px; }
</style>
