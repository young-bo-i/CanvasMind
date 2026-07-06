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
  <div class="avs" :aria-busy="loading">
    <div class="avs-head">
      <h2 class="avs-title">厂商密钥 / 定价</h2>
      <p class="avs-desc">图片走 CometAPI、视频走 chengmeng（厂商与模型已内置）。这里只需填各自的 API Key，并按需调价。价格默认按成本 60% 加价（1 积分 = 1 元）。</p>
    </div>

    <!-- 超管：选择配置哪个管理员的作用域（全局 = 超管/平台直属；其余为各普通管理员，其名下用户走该管理员的 key）。 -->
    <div v-if="isSuperAdmin && scopeOptions.length" class="admin-card avs-scope">
      <div class="admin-card__content avs-scope-inner">
        <span class="avs-scope-label">配置作用域</span>
        <select class="admin-input avs-scope-select" v-model="selectedScope" @change="onScopeChange">
          <option v-for="opt in scopeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <span class="avs-scope-tip">超管可分别为每个管理员配置其密钥与定价；该管理员名下所有用户（含其本人）都走这套。</span>
      </div>
    </div>

    <section v-for="vendor in vendors" :key="vendor.vendorCode" class="admin-card avs-vendor">
      <div class="admin-card__header avs-vendor-head">
        <div class="avs-vendor-title">
          <span class="admin-card__title">{{ vendor.name }}</span>
          <span class="avs-vendor-base">{{ vendor.baseUrl }}</span>
          <span v-for="t in vendor.supportedTypes" :key="t" class="avs-type-tag">{{ t === 'IMAGE' ? '图片' : t === 'VIDEO' ? '视频' : t }}</span>
        </div>
        <label class="admin-switch">
          <input type="checkbox" v-model="vendor.isEnabled">
          <span class="admin-switch__slider"></span>
        </label>
      </div>

      <div class="admin-card__content">
        <div class="avs-key-row">
          <span class="avs-key-label">API Key</span>
          <input
            class="admin-input avs-key-input"
            type="password"
            autocomplete="new-password"
            v-model="vendor.apiKeyInput"
            :placeholder="vendor.hasApiKey ? `已配置（${vendor.apiKeyHint}）· 留空则不修改` : '未配置，请填写'"
          >
        </div>

        <div class="avs-table-wrap">
          <div class="avs-table">
            <div class="avs-row avs-row--head">
              <div class="avs-c-name">模型</div>
              <div class="avs-c-cat">类目</div>
              <div class="avs-c-mode">计费</div>
              <div class="avs-c-price">单价（积分）</div>
              <div class="avs-c-on">启用</div>
            </div>
            <div v-for="m in vendor.models" :key="m.modelKey" class="avs-row">
              <div class="avs-c-name">{{ m.name }}</div>
              <div class="avs-c-cat">{{ m.category === 'IMAGE' ? '图片' : '视频' }}</div>
              <div class="avs-c-mode"><code class="avs-mode">{{ m.mode }}</code></div>
              <div class="avs-c-price">
                <template v-if="m.isToken">
                  <span class="avs-price-item"><span class="avs-res">输入/1M</span><input class="admin-input avs-num" type="number" min="0" step="0.01" v-model.number="m.tokenInput"></span>
                  <span class="avs-price-item"><span class="avs-res">输出/1M</span><input class="admin-input avs-num" type="number" min="0" step="0.01" v-model.number="m.tokenOutput"></span>
                </template>
                <template v-else-if="m.resolutionPrices.length">
                  <span v-for="p in m.resolutionPrices" :key="p.key" class="avs-price-item"><span class="avs-res">{{ p.key }}</span><input class="admin-input avs-num" type="number" min="0" step="0.01" v-model.number="p.value"></span>
                </template>
                <template v-else>
                  <span class="avs-price-item"><span class="avs-res">每次</span><input class="admin-input avs-num" type="number" min="0" step="0.01" v-model.number="m.power"></span>
                </template>
              </div>
              <div class="avs-c-on">
                <label class="admin-switch">
                  <input type="checkbox" v-model="m.enabled">
                  <span class="admin-switch__slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="avs-foot">
          <button class="admin-button admin-button--primary" :disabled="vendor.saving" @click="save(vendor, originals.find(o => o.vendorCode === vendor.vendorCode))">
            {{ vendor.saving ? '保存中…' : `保存 ${vendor.name}` }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.avs { display: flex; flex-direction: column; gap: 16px; }
.avs-head .avs-title { margin: 0 0 6px; font-size: 18px; font-weight: 700; color: var(--text-primary); }
.avs-head .avs-desc { margin: 0; color: var(--text-tertiary); font-size: 13px; line-height: 1.6; }

.avs-scope .avs-scope-inner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.avs-scope-label { font-weight: 600; font-size: 14px; color: var(--text-primary); white-space: nowrap; }
.avs-scope-select { width: auto; min-width: 260px; min-height: 40px; }
.avs-scope-tip { color: var(--text-tertiary); font-size: 12px; }

.avs-vendor-head { padding-bottom: 16px; }
.avs-vendor-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.avs-vendor-base { color: var(--text-tertiary); font-size: 12px; }
.avs-type-tag {
  font-size: 12px; color: var(--brand-main-default);
  border: 1px solid color-mix(in srgb, var(--brand-main-default) 40%, transparent);
  border-radius: 6px; padding: 1px 8px;
}

.avs-key-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.avs-key-label { width: 64px; color: var(--text-secondary, var(--text-tertiary)); font-size: 13px; font-weight: 600; }
.avs-key-input { max-width: 560px; }

.avs-table-wrap { overflow-x: auto; }
.avs-table { display: flex; flex-direction: column; min-width: 640px; }
.avs-row {
  display: grid;
  grid-template-columns: minmax(140px, 1.4fr) 60px 108px minmax(240px, 2fr) 56px;
  align-items: center; gap: 12px; padding: 12px 4px;
  border-top: 1px solid var(--line-divider, rgba(255, 255, 255, 0.08));
}
.avs-row--head { border-top: none; color: var(--text-tertiary); font-size: 12px; font-weight: 600; }
.avs-c-name { color: var(--text-primary); font-weight: 500; }
.avs-c-cat { color: var(--text-secondary, var(--text-tertiary)); font-size: 13px; }
.avs-mode {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
  background: var(--bg-block-secondary-default); padding: 2px 7px; border-radius: 6px;
  color: var(--text-secondary, var(--text-tertiary));
}
.avs-c-price { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.avs-price-item { display: inline-flex; align-items: center; gap: 6px; }
.avs-res {
  font-size: 12px; font-weight: 600; color: var(--text-primary);
  background: var(--bg-block-secondary-default); border-radius: 6px;
  padding: 3px 8px; min-width: 42px; text-align: center; line-height: 1.4;
}
.avs-num { width: 94px; min-height: 36px; padding: 0 10px; border-radius: 10px; text-align: right; }
.avs-foot { margin-top: 18px; display: flex; justify-content: flex-end; }
</style>
