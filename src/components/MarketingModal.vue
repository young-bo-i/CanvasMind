<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="lv-modal-wrapper lv-modal-wrapper-align-center domesticModalWrapper"
      @click.self="closeModal"
    >
      <div class="lv-modal-mask" @click="closeModal"></div>
      <div role="dialog" aria-modal="true" class="lv-modal lv-modal-simple domesticModal">
        <div class="lv-modal-content">
          <div class="outerWrapper">
            <div class="wrapper-dTloRs">
              <div class="defaultContentContainer">
                <div class="defaultContent">
                  <div class="title-AZ0SpV">
                    <span class="titleHighlight">{{ heroPrimaryText }}</span>
                    <span class="titleWhite">{{ heroSecondaryText }}</span>
                  </div>
                  <div class="desc-KaZqms">
                    <span>{{ heroDescription }}</span>
                  </div>
                </div>
                <div class="rightButtonContainer">
                  <button class="creditBtn" type="button" @click="openPointsDetailModal">积分详情</button>
                </div>
              </div>

              <div class="container-F98one">
                <div v-if="isLoadingPanel" class="creditsDesc">正在加载营销权益...</div>

                <template v-else>
                  <div class="priceListContainer redeemLayout-canana" :style="getGridStyle(Math.max(redeemDisplayRecords.length + 1, 2))">
                    <div class="priceListItem redeemEntryCard-canana">
                      <div class="price-list-item-wrapper">
                        <div class="priceListItemContent redeemEntryContent-canana">
                          <div class="priceTopWrapper">
                            <div class="priceTop redeemEntryHead-canana">
                              <div class="priceTitle">
                                <div class="levelName">卡密兑换</div>
                                <div class="bestPlan">立即生效</div>
                              </div>
                              <div class="priceDesc redeemEntryDesc-canana">输入卡密后可兑换会员天数或积分奖励，权益会实时发放到账户。</div>
                            </div>
                          </div>

                          <div class="creditsContainer redeemHero-canana">
                            <div class="redeemHeroStat-canana">
                              <div class="priceTips priceTipsWithFixedCurrencySymbolSize">
                                <span>{{ Number(pointsBalance || 0) }}</span>
                              </div>
                              <div class="cycleTips">当前积分</div>
                            </div>
                            <div class="creditsDesc">支持兑换会员时长、积分奖励等后台配置权益。</div>
                          </div>

                          <div class="creditsContainer redeemForm-canana">
                            <div class="redeemInputRow-canana">
                              <input v-model="redeemCodeValue" type="text" placeholder="请输入卡密" />
                              <button
                                class="priceButton priceButtonWithResourcePositionMaterial recommendButton mweb-button-default redeemActionButton-canana"
                                type="button"
                                :disabled="submitting"
                                @click="handleRedeemCode"
                              >
                                立即兑换
                              </button>
                            </div>
                            <div class="creditsDesc">卡密区分大小写，兑换成功后将自动刷新当前权益。</div>
                          </div>

                          <div class="benefitsDesc redeemBenefits-canana">
                            <div v-for="benefit in redeemBenefits" :key="benefit">
                              <svg viewBox="0 0 12 20" aria-hidden="true"><path fill="currentColor" d="M4.704 15.122L1.27 11.69l-1.06 1.06 4.494 4.493L11.79 10.157l-1.06-1.06z" /></svg>
                              <span>{{ benefit }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-for="record in redeemDisplayRecords"
                      :key="String(record.id)"
                      class="priceListItem redeemRecordCard-canana"
                    >
                      <div class="price-list-item-wrapper">
                        <div class="priceListItemContent">
                          <div class="priceTopWrapper">
                            <div class="priceTop redeemRecordHead-canana">
                              <div class="priceTitle">
                                <div class="levelName">{{ getRedeemRecordTitle(record) }}</div>
                              </div>
                              <div class="priceDesc">兑换时间 {{ formatDate(record.redeemedAt || record.createdAt) }}</div>
                            </div>
                          </div>

                          <div class="creditsContainer redeemRecordMeta-canana">
                            <div class="creditsContent">
                              <div class="creditsInnerContent-ybfrhd">
                                <span>状态</span>
                                <span class="creditsNumber">{{ String(record.status || '已生效') }}</span>
                              </div>
                            </div>
                            <div class="creditsDesc">{{ String(record.code || '后台卡密记录') }}</div>
                          </div>

                          <div class="benefitsDesc redeemRecordBenefits-canana">
                            <div v-for="benefit in getRedeemRecordBenefits(record)" :key="benefit">
                              <svg viewBox="0 0 12 20" aria-hidden="true"><path fill="currentColor" d="M4.704 15.122L1.27 11.69l-1.06 1.06 4.494 4.493L11.79 10.157l-1.06-1.06z" /></svg>
                              <span>{{ benefit }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>

            </div>

            <div class="closeBtnContainer">
              <button class="closeBtn-avuQWW" type="button" @click="closeModal" aria-label="关闭营销弹窗">
                <span class="closeBtnIcon">×</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
  <PointsDetailModal
    v-model:visible="pointsDetailVisible"
    :balance="Number(pointsBalance || 0)"
    :available="Number(pointsBalance || 0)"
    :logs="pointLogs"
  />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PointsDetailModal from './PointsDetailModal.vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useLoginModalStore } from '@/stores/login-modal'
import { useMarketingCenterStore } from '@/stores/marketing-center'
import './MarketingModal.css'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
}>()

const authStore = useAuthStore()
const { openLoginModal } = useLoginModalStore()
const marketingCenterStore = useMarketingCenterStore()

const redeemCodeValue = ref('')
const pointsBalance = computed(() => marketingCenterStore.pointsBalance.value)
const cardRedeemRecords = computed(() => marketingCenterStore.cardRedeemRecords.value as Array<Record<string, any>>)
const isLoadingPanel = computed(() => marketingCenterStore.loading.value && !marketingCenterStore.overview.value)
const submitting = computed(() => marketingCenterStore.submitting.value)

const pointLogs = computed(() => (marketingCenterStore.overview.value?.points.logs || []) as Array<Record<string, any>>)
const pointsDetailVisible = ref(false)

const redeemDisplayRecords = computed(() => cardRedeemRecords.value.slice(0, 3))

const redeemBenefits = [
  '支持兑换会员时长',
  '支持兑换积分奖励',
  '兑换成功后权益立即生效',
]

const heroPrimaryText = computed(() => '卡密兑换中心')
const heroSecondaryText = computed(() => '兑换专属权益')
const heroDescription = computed(() => {
  if (!authStore.isLoggedIn.value) {
    return '登录后即可使用卡密兑换会员时长与积分奖励。'
  }
  return '输入卡密即可兑换会员时长或积分奖励，权益实时到账。'
})

const closeModal = () => {
  pointsDetailVisible.value = false
  emit('update:visible', false)
}

const openPointsDetailModal = () => {
  if (!ensureLoggedInForAction()) return
  pointsDetailVisible.value = true
}

const ensureLoggedInForAction = () => {
  if (authStore.isLoggedIn.value) {
    return true
  }
  openLoginModal('marketing-modal')
  ElMessage.info('请先登录后再使用卡密兑换权益')
  return false
}

const formatDate = (value: unknown) => {
  if (!value) return '未设置'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return '未设置'
  return date.toLocaleDateString('zh-CN')
}

const getRedeemRecordTitle = (record: Record<string, any>) => {
  if (record.rewardType === 'MEMBERSHIP') {
    return `${String(record.rewardLevel?.name || '会员')} ${Number(record.rewardDays || 0)} 天`
  }
  return `积分 +${Number(record.rewardPoints || 0)}`
}

const getRedeemRecordBenefits = (record: Record<string, any>) => {
  if (record.rewardType === 'MEMBERSHIP') {
    return ['会员权益已发放', `有效天数 ${Number(record.rewardDays || 0)} 天`, `兑换时间 ${formatDate(record.redeemedAt || record.createdAt)}`]
  }
  return ['积分奖励已到账', `奖励积分 ${Number(record.rewardPoints || 0)}`, `兑换时间 ${formatDate(record.redeemedAt || record.createdAt)}`]
}

// 营销卡片默认按四列栅格展示，卡片数量不足时收紧容器宽度，避免内容过散。
const getGridStyle = (count: number) => {
  const safeCount = Math.max(1, Math.min(4, Number(count || 0)))
  return {
    gridTemplateColumns: `repeat(${safeCount}, minmax(0, 1fr))`,
    maxWidth: `${safeCount * 320 + (safeCount - 1) * 12}px`,
  }
}

const handleRedeemCode = async () => {
  if (!ensureLoggedInForAction()) return
  const code = redeemCodeValue.value.trim()
  if (!code) {
    ElMessage.warning('请输入卡密')
    return
  }
  await marketingCenterStore.redeemCode(code)
  redeemCodeValue.value = ''
}

// 直接操作 body overflow，避免为了滚动锁再额外新增自定义样式。
const previousHtmlOverflow = ref('')
const previousBodyOverflow = ref('')

const setScrollLock = (locked: boolean) => {
  if (typeof document === 'undefined') {
    return
  }
  if (locked) {
    previousHtmlOverflow.value = document.documentElement.style.overflow
    previousBodyOverflow.value = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return
  }
  document.documentElement.style.overflow = previousHtmlOverflow.value
  document.body.style.overflow = previousBodyOverflow.value
}

watch(() => props.visible, (visible) => {
  setScrollLock(visible)
  if (!visible) {
    pointsDetailVisible.value = false
  }
  // 营销总览接口支持未登录访问，弹窗打开时始终拉一次，确保前台数据能正常展示。
  if (visible) {
    void marketingCenterStore.loadOverview(true)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  setScrollLock(false)
})
</script>
