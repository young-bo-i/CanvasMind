<template>
  <AdminPageContainer title="营销中心" description="集中管理会员等级、用户积分、卡密兑换与积分流水。">
    <template #actions>
      <button class="admin-button admin-button--secondary" type="button" :disabled="loading" @click="loadAllData">
        {{ loading ? '刷新中...' : '刷新数据' }}
      </button>
    </template>

    <section class="admin-marketing-hero">
      <div class="admin-marketing-hero__main">
        <div class="admin-marketing-hero__eyebrow">营销工作台</div>
        <h3 class="admin-marketing-hero__title">统一管理会员、积分、激励与补偿等核心运营能力</h3>
        <p class="admin-marketing-hero__desc">
          当前模块为 <strong>{{ currentToolInfo.title }}</strong>，主要用于 {{ currentToolInfo.description }}。
          可结合左侧模块导航快速切换到具体业务域，集中处理日常运营动作。
        </p>
        <div class="admin-marketing-hero__chips">
          <span class="admin-chip">当前模块：{{ currentToolInfo.title }}</span>
          <span class="admin-chip">{{ currentToolInfo.meta }}</span>
        </div>
      </div>
      <div class="admin-marketing-hero__stats">
        <div class="admin-stat-card">
          <div class="admin-stat-card__label">会员等级</div>
          <div class="admin-stat-card__value">{{ overview?.membership.levelCount ?? levels.length }}</div>
          <div class="admin-stat-card__hint">当前已配置会员等级与成长体系</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-card__label">卡密批次</div>
          <div class="admin-stat-card__value">{{ overview?.cdk.batchCount ?? cardBatches.length }}</div>
          <div class="admin-stat-card__hint">已生成 {{ overview?.cdk.codeCount ?? 0 }} 张 · 已用 {{ overview?.cdk.usedCount ?? 0 }} 张</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-card__label">总充值金额</div>
          <div class="admin-stat-card__value">¥{{ (overview?.business.totalRechargeAmount ?? 0).toFixed(2) }}</div>
          <div class="admin-stat-card__hint">已支付充值订单实付金额合计</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-card__label">总消费积分</div>
          <div class="admin-stat-card__value">{{ overview?.business.totalConsumePoints ?? 0 }}</div>
          <div class="admin-stat-card__hint">全部生成消费扣除的积分合计</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-card__label">用户总余额</div>
          <div class="admin-stat-card__value">{{ overview?.business.totalPointBalance ?? 0 }}</div>
          <div class="admin-stat-card__hint">全站用户当前持有积分合计</div>
        </div>
        <div class="admin-stat-card">
          <div class="admin-stat-card__label">活跃会员</div>
          <div class="admin-stat-card__value">{{ overview?.business.activeMemberCount ?? 0 }}</div>
          <div class="admin-stat-card__hint">当前有效期内的会员订阅数</div>
        </div>
      </div>
    </section>

    <section class="admin-marketing-workspace">
      <aside class="admin-marketing-sidebar">
        <div class="admin-card admin-marketing-sidebar-card">
          <div class="admin-card__header">
            <div>
              <h4 class="admin-card__title">运营模块</h4>
              <div class="admin-card__desc">按业务域拆分，减少运营跳转成本。</div>
            </div>
          </div>
          <div class="admin-card__content">
            <div class="admin-marketing-tools">
              <button
                v-for="tool in marketingTools"
                :key="tool.key"
                class="admin-marketing-tool"
                :class="{ 'is-active': activeTool === tool.key }"
                type="button"
                @click="activeTool = tool.key"
              >
                <div class="admin-marketing-tool__icon">{{ tool.icon }}</div>
                <div class="admin-marketing-tool__body">
                  <div class="admin-marketing-tool__title">{{ tool.title }}</div>
                  <div class="admin-marketing-tool__desc">{{ tool.description }}</div>
                  <div class="admin-marketing-tool__meta">{{ tool.meta() }}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div class="admin-marketing-main">
        <div class="admin-marketing-main__header">
          <div>
            <h3 class="admin-marketing-main__title">{{ currentToolInfo.title }}</h3>
            <div class="admin-marketing-main__desc">{{ currentToolInfo.focus }}</div>
          </div>
          <div class="admin-marketing-main__meta">{{ currentToolInfo.meta }}</div>
        </div>

        <div v-if="activeTool === 'membership'" class="admin-marketing-section-shell">
          <div class="admin-card admin-marketing-module-card">
            <div class="admin-card__header">
              <div>
                <h4 class="admin-card__title">会员等级</h4>
                <div class="admin-card__desc">定义会员层级、专属权益、开通赠送积分和排序权重。</div>
              </div>
              <button class="admin-button admin-button--primary" type="button" @click="openLevelDialog()">新增等级</button>
            </div>
            <div class="admin-card__content">
              <div v-if="!levels.length" class="admin-empty">暂无会员等级，请先创建。</div>
              <div v-else class="admin-list">
                <div v-for="item in levels" :key="item.id" class="admin-list-item admin-marketing-list-item">
                  <div>
                    <div class="admin-list-item__title">{{ item.name }}</div>
                    <div class="admin-list-item__meta">
                      Lv.{{ item.level }} · 开通赠送 {{ item.monthlyBonusPoints }} 积分 · 折扣 {{ item.pointDiscountPercent || 0 }}% · 容量 {{ item.storageCapacity || 0 }}
                    </div>
                  </div>
                  <div class="admin-marketing-list-item__badges">
                    <span class="admin-chip">排序 {{ item.sortOrder }}</span>
                    <span class="admin-status" :class="item.isEnabled ? 'admin-status--success' : 'admin-status--muted'">
                      {{ item.isEnabled ? '已启用' : '已停用' }}
                    </span>
                  </div>
                  <div class="admin-row-actions">
                    <button class="admin-inline-button" type="button" @click="openLevelDialog(item)">编辑</button>
                    <button class="admin-inline-button admin-inline-button--danger" type="button" @click="handleDeleteLevel(item)">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="activeTool === 'userPoints'" class="admin-marketing-section-shell">
          <div class="admin-card admin-marketing-module-card">
            <div class="admin-card__header">
              <div>
                <h4 class="admin-card__title">用户积分 / 会员</h4>
                <div class="admin-card__desc">查看每个用户的当前积分余额、生效中的会员等级与到期时间，支持关键词搜索。</div>
              </div>
              <button class="admin-button admin-button--secondary" type="button" :disabled="userPointsLoading" @click="loadUserPoints">
                {{ userPointsLoading ? '刷新中...' : '刷新数据' }}
              </button>
            </div>
            <div class="admin-card__content">
              <AdminFilterToolbar>
                <template #search>
                  <div class="admin-marketing-log-filter-field admin-marketing-log-filter-field--search">
                    <span class="admin-marketing-log-filter-field__label">关键词搜索</span>
                    <input
                      v-model.trim="userPointsKeyword"
                      class="admin-input admin-marketing-log-filter-field__control"
                      type="text"
                      placeholder="搜索用户名、邮箱、手机号"
                      @keydown.enter.prevent="handleApplyUserPointsKeyword"
                    >
                  </div>
                </template>
                <template #actions>
                  <button class="admin-button admin-button--secondary" type="button" :disabled="userPointsLoading" @click="handleResetUserPointsKeyword">
                    重置
                  </button>
                  <button class="admin-button admin-button--primary" type="button" :disabled="userPointsLoading" @click="handleApplyUserPointsKeyword">
                    {{ userPointsLoading ? '搜索中...' : '搜索' }}
                  </button>
                </template>
                <template #meta>
                  <span class="admin-skill-toolbar__summary">共 {{ userPointsTotal }} 个用户</span>
                </template>
              </AdminFilterToolbar>

              <div v-if="!userPoints.length" class="admin-empty">当前条件下暂无用户数据。</div>
              <div v-else class="admin-list admin-user-point-list">
                <div v-for="item in userPoints" :key="item.id" class="admin-list-item admin-user-point-item">
                  <div class="admin-user-point-item__profile">
                    <img
                      v-if="item.avatarUrl"
                      :src="item.avatarUrl"
                      :alt="item.name || '用户头像'"
                      class="admin-user-point-item__avatar"
                    >
                    <div v-else class="admin-user-point-item__avatar admin-user-point-item__avatar--fallback">
                      {{ (item.name || item.maskedEmail || item.maskedPhone || '?').slice(0, 1).toUpperCase() }}
                    </div>
                    <div>
                      <div class="admin-list-item__title">{{ item.name || '未命名用户' }}</div>
                      <div class="admin-list-item__meta">{{ item.maskedEmail || item.maskedPhone || 'ID ' + item.id }}</div>
                    </div>
                  </div>
                  <div class="admin-user-point-item__metric">
                    <span class="admin-user-point-item__metric-label">积分余额</span>
                    <strong class="admin-user-point-item__metric-value">{{ item.currentPointBalance }}</strong>
                  </div>
                  <div class="admin-user-point-item__metric">
                    <span class="admin-user-point-item__metric-label">当前会员</span>
                    <span class="admin-chip">{{ item.activeSubscription?.level?.name || '无' }}</span>
                  </div>
                  <div class="admin-user-point-item__metric">
                    <span class="admin-user-point-item__metric-label">会员到期</span>
                    <span class="admin-user-point-item__metric-text">
                      {{ item.activeSubscription?.endTime ? formatDateText(item.activeSubscription.endTime) : '-' }}
                    </span>
                  </div>
                </div>
                <AdminPagination
                  v-model:page="userPointsPagination.page"
                  v-model:page-size="userPointsPagination.pageSize"
                  :total="userPointsTotal"
                  :disabled="userPointsLoading"
                  @change="handleUserPointsPaginationChange"
                />
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="activeTool === 'cdk'" class="admin-marketing-section-shell">
          <div class="admin-card admin-marketing-module-card">
            <div class="admin-card__header">
              <div>
                <h4 class="admin-card__title">卡密兑换</h4>
                <div class="admin-card__desc">用于批量生成兑换码，可绑定积分奖励或会员权益，适合运营活动投放。</div>
              </div>
              <button class="admin-button admin-button--primary" type="button" @click="openBatchDialog()">新增批次</button>
            </div>
            <div class="admin-card__content">
              <div v-if="!cardBatches.length" class="admin-empty">暂无卡密批次。</div>
              <div v-else class="admin-list">
                <div v-for="item in cardBatches" :key="item.id" class="admin-list-item admin-marketing-list-item admin-marketing-list-item--batch">
                  <div>
                    <div class="admin-list-item__title">{{ item.name }}</div>
                    <div class="admin-list-item__meta">
                      批次号 {{ item.batchNo }} · 总数 {{ item.totalCount }} · 已用 {{ item.usedCount }} · {{ getCardRewardSummary(item) }}
                    </div>
                  </div>
                  <div class="admin-marketing-list-item__badges">
                    <span class="admin-chip">剩余 {{ Math.max(item.totalCount - item.usedCount, 0) }}</span>
                    <span class="admin-status" :class="item.isEnabled ? 'admin-status--success' : 'admin-status--muted'">
                      {{ item.isEnabled ? '可兑换' : '已停用' }}
                    </span>
                  </div>
                  <div class="admin-row-actions">
                    <button class="admin-inline-button" type="button" @click="openCodesDialog(item)">查看卡密</button>
                    <button class="admin-inline-button" type="button" @click="openBatchDialog(item)">编辑</button>
                    <button class="admin-inline-button admin-inline-button--danger" type="button" @click="handleDeleteBatch(item)">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="admin-marketing-section-shell">
          <div class="admin-card admin-marketing-module-card">
            <div class="admin-card__header">
              <div>
                <h4 class="admin-card__title">积分流水明细</h4>
                <div class="admin-card__desc">支持按动作、来源、终端类型、退款状态和关键词筛选，并可对失败未退款流水直接补偿。</div>
              </div>
              <div class="admin-row-actions">
                <button class="admin-button admin-button--secondary" type="button" :disabled="compensationLoading" @click="loadPointLogs">
                  {{ compensationLoading ? '刷新中...' : '刷新流水' }}
                </button>
                <button class="admin-button admin-button--secondary" type="button" @click="openManualCompensationDialog">
                  手动补偿
                </button>
                <button
                  class="admin-button admin-button--primary"
                  type="button"
                  :disabled="compensationSubmitting || !selectedCompensationAssociationNos.length"
                  @click="handleExecuteSelectedPointLogCompensation"
                >
                  {{ compensationSubmitting ? '补偿中...' : `补偿已选 ${selectedCompensationAssociationNos.length} 条` }}
                </button>
              </div>
            </div>
            <div class="admin-card__content">
              <AdminFilterToolbar>
                <template #search>
                  <div class="admin-marketing-log-filter-field admin-marketing-log-filter-field--search">
                    <span class="admin-marketing-log-filter-field__label">关键词搜索</span>
                    <input
                      v-model.trim="pointLogFilters.keyword"
                      class="admin-input admin-marketing-log-filter-field__control"
                      type="text"
                      placeholder="搜索用户、流水号、备注、模型、任务提示词"
                      @keydown.enter.prevent="handleApplyPointLogFilters"
                    >
                  </div>
                </template>
                <template #actions>
                  <button class="admin-button admin-button--secondary" type="button" :disabled="compensationLoading" @click="handleResetPointLogFilters">
                    重置
                  </button>
                  <button class="admin-button admin-button--primary" type="button" :disabled="compensationLoading" @click="handleApplyPointLogFilters">
                    {{ compensationLoading ? '筛选中...' : '应用筛选' }}
                  </button>
                </template>
                <template #filters>
                  <div class="admin-marketing-log-filters">
                  <label class="admin-marketing-log-filter-field">
                    <span class="admin-marketing-log-filter-field__label">动作类型</span>
                    <select v-model="pointLogFilters.action" class="admin-select admin-marketing-log-filter-field__control">
                      <option value="">全部动作</option>
                      <option value="INCREASE">收入</option>
                      <option value="DECREASE">支出</option>
                    </select>
                  </label>
                  <label class="admin-marketing-log-filter-field">
                    <span class="admin-marketing-log-filter-field__label">来源渠道</span>
                    <select v-model="pointLogFilters.sourceType" class="admin-select admin-marketing-log-filter-field__control">
                      <option value="">全部来源</option>
                      <option value="GENERATION_CONSUME">生成消费</option>
                      <option value="RECHARGE_ORDER">充值</option>
                      <option value="MEMBERSHIP_ORDER">订阅</option>
                      <option value="REWARD_RULE">奖励规则</option>
                      <option value="CHECKIN">签到</option>
                      <option value="CARD_REDEEM">卡密兑换</option>
                    </select>
                  </label>
                  <label class="admin-marketing-log-filter-field">
                    <span class="admin-marketing-log-filter-field__label">终端类型</span>
                    <select v-model="pointLogFilters.endpointType" class="admin-select admin-marketing-log-filter-field__control">
                      <option value="">全部终端</option>
                      <option value="chat">CHAT</option>
                      <option value="image">IMAGE</option>
                      <option value="video">VIDEO</option>
                    </select>
                  </label>
                  <label class="admin-marketing-log-filter-field">
                    <span class="admin-marketing-log-filter-field__label">退款状态</span>
                    <select v-model="pointLogFilters.refundStatus" class="admin-select admin-marketing-log-filter-field__control">
                      <option value="">全部退款状态</option>
                      <option value="compensable">待补偿</option>
                      <option value="refunded">已退款</option>
                      <option value="unrefunded">未退款</option>
                    </select>
                  </label>
                  <label class="admin-marketing-log-filter-field">
                    <span class="admin-marketing-log-filter-field__label">时间窗口</span>
                    <select v-model.number="pointLogFilters.days" class="admin-select admin-marketing-log-filter-field__control">
                      <option :value="7">近 7 天</option>
                      <option :value="30">近 30 天</option>
                      <option :value="90">近 90 天</option>
                    </select>
                  </label>
                  </div>
                </template>
                <template #meta>
                  <span class="admin-skill-toolbar__summary">
                    共 {{ pointLogSummary.totalCount }} 条流水
                    <em v-if="pointLogActiveFilterCount">，已启用 {{ pointLogActiveFilterCount }} 个筛选</em>
                  </span>
                </template>
              </AdminFilterToolbar>

              <div class="admin-marketing-log-summary">
                <div class="admin-marketing-log-summary__item">
                  <span class="admin-marketing-log-summary__label">命中明细</span>
                  <strong class="admin-marketing-log-summary__value">{{ pointLogSummary.totalCount }}</strong>
                </div>
                <div class="admin-marketing-log-summary__item">
                  <span class="admin-marketing-log-summary__label">待补偿</span>
                  <strong class="admin-marketing-log-summary__value">{{ pointLogSummary.compensableCount }}</strong>
                </div>
                <div class="admin-marketing-log-summary__item">
                  <span class="admin-marketing-log-summary__label">已退款</span>
                  <strong class="admin-marketing-log-summary__value">{{ pointLogSummary.refundCount }}</strong>
                </div>
                <div class="admin-marketing-log-summary__item">
                  <span class="admin-marketing-log-summary__label">统计窗口</span>
                  <strong class="admin-marketing-log-summary__value">{{ pointLogSummary.windowDays }} 天</strong>
                </div>
              </div>

              <div v-if="!pointLogs.length" class="admin-empty">当前筛选条件下暂无积分流水。</div>
              <div v-else class="admin-list admin-point-log-list">
                <label v-for="item in pointLogs" :key="item.id" class="admin-list-item admin-point-log-item">
                  <div class="admin-point-log-item__check">
                    <input
                      :checked="selectedCompensationAssociationNos.includes(item.associationNo)"
                      :disabled="!item.canCompensate"
                      type="checkbox"
                      @change="toggleCompensationSelection(item.associationNo)"
                    >
                  </div>
                  <div class="admin-point-log-item__main">
                    <div class="admin-point-log-item__headline">
                      <div class="admin-list-item__title">{{ getPointLogTitle(item) }}</div>
                      <span class="admin-chip admin-point-log-item__amount" :class="item.action === 'DECREASE' ? 'is-decrease' : 'is-increase'">
                        {{ item.action === 'DECREASE' ? '-' : '+' }}{{ item.changeAmount }} 积分
                      </span>
                    </div>
                    <div class="admin-point-log-item__meta-grid">
                      <div class="admin-list-item__meta">
                        用户 {{ resolvePointLogUserText(item) }} · ID {{ item.userId || '-' }}
                        <button
                          v-if="item.userId"
                          class="admin-inline-button admin-point-log-item__copy-button"
                          type="button"
                          @click.prevent="handleCopyPointLogText('user', item.id, item.userId)"
                        >
                          {{ resolveCopyButtonText('user', item.id, '复制用户ID') }}
                        </button>
                      </div>
                      <div class="admin-list-item__meta">余额 {{ item.balanceAfter }} · 可用 {{ item.availableAmount }}</div>
                    </div>
                    <div class="admin-point-log-item__meta-grid">
                      <div class="admin-list-item__meta">来源 {{ item.sourceType }} · 终端 {{ item.endpointType || '-' }}</div>
                      <div class="admin-list-item__meta">
                        流水号 {{ item.associationNo || item.accountNo }}
                        <button
                          v-if="item.associationNo || item.accountNo"
                          class="admin-inline-button admin-point-log-item__copy-button"
                          type="button"
                          @click.prevent="handleCopyPointLogText('association', item.id, item.associationNo || item.accountNo)"
                        >
                          {{ resolveCopyButtonText('association', item.id, '复制流水号') }}
                        </button>
                      </div>
                    </div>
                    <div class="admin-list-item__meta">发生时间 {{ formatDateText(item.createdAt) }}</div>
                    <div v-if="item.generationPrompt || item.generationErrorMessage" class="admin-list-item__meta">
                      {{ item.generationPrompt || '未记录任务提示词' }}<span v-if="item.generationErrorMessage"> · 错误：{{ item.generationErrorMessage }}</span>
                    </div>
                    <div
                      v-if="item.usageInputTokens || item.usageOutputTokens || item.usageCachedTokens"
                      class="admin-list-item__meta"
                    >
                      用量 · 输入 {{ item.usageInputTokens }} · 输出 {{ item.usageOutputTokens }} · 缓存命中 {{ item.usageCachedTokens }} token
                    </div>
                  </div>
                  <div class="admin-point-log-item__aside">
                    <div class="admin-point-log-item__status">
                    <span class="admin-status" :class="resolvePointLogStatusClass(item)">
                      {{ resolvePointLogStatusText(item) }}
                    </span>
                    </div>
                    <div class="admin-point-log-item__compensation-reason">
                      {{ item.compensationReason }}
                    </div>
                  </div>
                  <div class="admin-row-actions">
                    <button
                      v-if="item.canCompensate"
                      class="admin-inline-button"
                      type="button"
                      :disabled="compensationSubmitting"
                      @click.prevent="handleExecuteSinglePointLogCompensation(item.associationNo)"
                    >
                      失败补偿
                    </button>
                  </div>
                </label>
                <AdminPagination
                  v-model:page="pointLogPagination.page"
                  v-model:page-size="pointLogPagination.pageSize"
                  :total="pointLogSummary.totalCount"
                  :disabled="compensationLoading || compensationSubmitting"
                  @change="handlePointLogPaginationChange"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div v-if="manualCompensationDialogVisible" class="admin-dialog-mask" @click="closeManualCompensationDialog">
      <div class="admin-dialog admin-dialog--provider-form" @click.stop>
        <div class="admin-dialog__header">
          <div>
            <h3 class="admin-dialog__title">手动补偿</h3>
            <div class="admin-dialog__desc">用于处理历史遗留漏账或缺少生成记录关联的流水，请按关联号逐条核实后执行。</div>
          </div>
          <button class="admin-dialog__close" type="button" @click="closeManualCompensationDialog">×</button>
        </div>
        <div class="admin-dialog__body admin-form">
          <div class="admin-form__field">
            <label class="admin-form__label">手动输入关联号</label>
            <textarea
              v-model.trim="compensationForm.manualAssociationNos"
              class="admin-textarea"
              rows="8"
              placeholder="每行一个关联号，或使用逗号分隔，例如：&#10;GTK1777512523146OM0MFW&#10;GTK1777512456545MH6GTH"
            />
          </div>
          <div class="admin-form__field">
            <label class="admin-form__label">补偿备注</label>
            <textarea
              v-model.trim="compensationForm.note"
              class="admin-textarea"
              rows="4"
              placeholder="例如：修复对话失败退款漏账后，补偿 2026-04-30 历史遗留记录"
            />
          </div>
          <label class="admin-checkbox">
            <input v-model="compensationForm.forceManual" type="checkbox">
            <span>允许补偿缺少生成记录关联的历史流水（请先人工确认任务确实失败）</span>
          </label>
          <div class="admin-form__footer">
            <button class="admin-button admin-button--secondary" type="button" @click="fillLegacyCompensationExample">填入当前遗留样例</button>
            <button class="admin-button admin-button--secondary" type="button" @click="closeManualCompensationDialog">取消</button>
            <button class="admin-button admin-button--primary" type="button" :disabled="compensationSubmitting" @click="handleExecuteManualCompensation">
              {{ compensationSubmitting ? '执行中...' : '执行手动补偿' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="levelDialogVisible" class="admin-dialog-mask" @click="closeLevelDialog">
      <div class="admin-dialog admin-dialog--provider-form" @click.stop>
        <div class="admin-dialog__header">
          <div>
            <h3 class="admin-dialog__title">{{ levelEditingId ? '编辑会员等级' : '新增会员等级' }}</h3>
            <div class="admin-dialog__desc">配置会员层级、每月积分和权益说明。</div>
          </div>
          <button class="admin-dialog__close" type="button" @click="closeLevelDialog">×</button>
        </div>
        <form class="admin-dialog__body admin-form" @submit.prevent="handleSubmitLevel">
          <div class="admin-form__grid">
            <div class="admin-form__field">
              <label class="admin-form__label">等级名称</label>
              <input v-model.trim="levelForm.name" class="admin-input" type="text" placeholder="例如：黄金会员">
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">等级值</label>
              <input v-model.number="levelForm.level" class="admin-input" type="number" min="1">
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">开通赠送积分</label>
              <input v-model.number="levelForm.monthlyBonusPoints" class="admin-input" type="number" min="0">
              <div class="admin-form__hint">用户开通/续费该等级时一次性赠送的积分（当前非按月发放）。</div>
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">存储容量</label>
              <input v-model.number="levelForm.storageCapacity" class="admin-input" type="number" min="0" placeholder="单位自定义">
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">积分折扣(%)</label>
              <input v-model.number="levelForm.pointDiscountPercent" class="admin-input" type="number" min="0" max="100" placeholder="0">
              <div class="admin-form__hint">会员生成时的积分减免百分比。例如 20 = 按 8 折扣费(少扣 20%)。0 表示无折扣。</div>
            </div>
            <div class="admin-form__field admin-form__field--full">
              <label class="admin-form__label">图标地址</label>
              <input v-model.trim="levelForm.iconUrl" class="admin-input" type="text" placeholder="https://...">
            </div>
            <div class="admin-form__field admin-form__field--full">
              <label class="admin-form__label">等级说明</label>
              <textarea v-model.trim="levelForm.description" class="admin-textarea" placeholder="简述此等级的定位和权益"></textarea>
            </div>
            <div class="admin-form__field admin-form__field--full">
              <label class="admin-form__label">权益 JSON</label>
              <textarea v-model.trim="levelForm.benefitsJsonText" class="admin-textarea admin-system-json" placeholder='例如：[{"label":"高速生成"}]'></textarea>
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">排序权重</label>
              <input v-model.number="levelForm.sortOrder" class="admin-input" type="number" min="0">
            </div>
            <div class="admin-form__field admin-form__field--checkbox">
              <label class="admin-form__label admin-form__label--inline">
                <input v-model="levelForm.isEnabled" type="checkbox">
                <span>启用此等级</span>
              </label>
            </div>
          </div>
          <div class="admin-form__footer">
            <button class="admin-button admin-button--secondary" type="button" @click="closeLevelDialog">取消</button>
            <button class="admin-button admin-button--primary" type="submit" :disabled="submitting">
              {{ submitting ? '保存中...' : '保存等级' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="batchDialogVisible" class="admin-dialog-mask" @click="closeBatchDialog">
      <div class="admin-dialog admin-dialog--provider-form" @click.stop>
        <div class="admin-dialog__header">
          <div>
            <h3 class="admin-dialog__title">{{ batchEditingId ? '编辑卡密批次' : '新增卡密批次' }}</h3>
            <div class="admin-dialog__desc">设置兑换奖励、批次数量和过期时间，创建时会自动生成卡密。</div>
          </div>
          <button class="admin-dialog__close" type="button" @click="closeBatchDialog">×</button>
        </div>
        <form class="admin-dialog__body admin-form" @submit.prevent="handleSubmitBatch">
          <div class="admin-form__grid">
            <div class="admin-form__field">
              <label class="admin-form__label">批次名称</label>
              <input v-model.trim="batchForm.name" class="admin-input" type="text" placeholder="例如：五一活动卡密批次">
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">批次号</label>
              <input v-model.trim="batchForm.batchNo" class="admin-input" type="text" placeholder="例如：MKT-20260428-A">
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">奖励类型</label>
              <select v-model="batchForm.rewardType" class="admin-input">
                <option value="POINTS">积分</option>
                <option value="MEMBERSHIP">会员时长</option>
              </select>
            </div>
            <div class="admin-form__field" v-if="batchForm.rewardType === 'POINTS'">
              <label class="admin-form__label">奖励积分</label>
              <input v-model.number="batchForm.rewardPoints" class="admin-input" type="number" min="0">
            </div>
            <div class="admin-form__field" v-else>
              <label class="admin-form__label">会员等级</label>
              <select v-model="batchForm.rewardLevelId" class="admin-input">
                <option value="">请选择会员等级</option>
                <option v-for="item in levels" :key="item.id" :value="item.id">{{ item.name }}</option>
              </select>
            </div>
            <div class="admin-form__field" v-if="batchForm.rewardType === 'MEMBERSHIP'">
              <label class="admin-form__label">奖励天数</label>
              <input v-model.number="batchForm.rewardDays" class="admin-input" type="number" min="1">
            </div>
            <div class="admin-form__field" v-else>
              <label class="admin-form__label">总数量</label>
              <input v-model.number="batchForm.totalCount" class="admin-input" type="number" min="1" :disabled="Boolean(batchEditingId)">
            </div>
            <div class="admin-form__field">
              <label class="admin-form__label">过期时间</label>
              <input v-model="batchForm.expiresAt" class="admin-input" type="datetime-local">
            </div>
            <div class="admin-form__field admin-form__field--full">
              <label class="admin-form__label">批次说明</label>
              <textarea v-model.trim="batchForm.description" class="admin-textarea" placeholder="说明该批次的用途和发放渠道"></textarea>
            </div>
            <div class="admin-form__field admin-form__field--full">
              <label class="admin-form__label">扩展 JSON</label>
              <textarea v-model.trim="batchForm.metaJsonText" class="admin-textarea admin-system-json" placeholder='例如：{"channel":"douyin"}'></textarea>
            </div>
            <div class="admin-form__field admin-form__field--checkbox">
              <label class="admin-form__label admin-form__label--inline">
                <input v-model="batchForm.isEnabled" type="checkbox">
                <span>允许兑换</span>
              </label>
            </div>
          </div>
          <div class="admin-form__footer">
            <button class="admin-button admin-button--secondary" type="button" @click="closeBatchDialog">取消</button>
            <button class="admin-button admin-button--primary" type="submit" :disabled="submitting">
              {{ submitting ? '保存中...' : '保存批次' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="codesDialogVisible" class="admin-dialog-mask" @click="closeCodesDialog">
      <div class="admin-dialog admin-dialog--manager" @click.stop>
        <div class="admin-dialog__header">
          <div>
            <h3 class="admin-dialog__title">卡密列表</h3>
            <div class="admin-dialog__desc">{{ currentBatch?.name || '当前批次' }} · {{ currentBatch?.batchNo || '-' }}</div>
          </div>
          <button class="admin-dialog__close" type="button" @click="closeCodesDialog">×</button>
        </div>
        <div class="admin-dialog__body">
          <div v-if="codesLoading" class="admin-empty">正在加载卡密...</div>
          <div v-else-if="!cardCodes.length" class="admin-empty">当前批次暂无卡密数据。</div>
          <div v-else class="admin-marketing-code-grid">
            <div v-for="item in cardCodes" :key="item.id" class="admin-marketing-code-card">
              <div class="admin-marketing-code-card__top">
                <strong>{{ item.code }}</strong>
                <span class="admin-status" :class="item.status === 'USED' ? 'admin-status--warning' : 'admin-status--success'">
                  {{ item.status === 'USED' ? '已使用' : '未使用' }}
                </span>
              </div>
              <div class="admin-marketing-code-card__meta">到期：{{ formatDateText(item.expiresAt) }}</div>
              <div class="admin-marketing-code-card__meta">使用者：{{ item.usedByUser?.name || item.usedByUser?.email || item.usedByUser?.phone || '暂无' }}</div>
              <div class="admin-marketing-code-card__meta">使用时间：{{ formatDateText(item.usedAt) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AdminPageContainer>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AdminFilterToolbar from '@/components/admin/common/AdminFilterToolbar.vue'
import AdminPagination from '@/components/admin/common/AdminPagination.vue'
import AdminPageContainer from '@/components/admin/layout/AdminPageContainer.vue'
import { useAdminListFilters } from '@/composables/useAdminListFilters'
import {
  createCardBatch,
  createMembershipLevel,
  deleteCardBatch,
  deleteMembershipLevel,
  getAdminMarketingOverview,
  listAdminMarketingUserPoints,
  listAdminPointLogs,
  listCardBatches,
  listCardCodesByBatch,
  listMembershipLevels,
  executePointCompensation,
  updateCardBatch,
  updateMembershipLevel,
  type AdminMarketingOverview,
  type CardBatchItem,
  type CardCodeItem,
  type AdminPointLogItem,
  type AdminPointLogListResult,
  type MarketingUserPointItem,
  type MembershipLevelItem,
} from '@/api/admin-marketing'

// 营销中心核心工具。
type MarketingToolKey = 'membership' | 'userPoints' | 'cdk' | 'compensation'

const overview = ref<AdminMarketingOverview | null>(null)
const levels = ref<MembershipLevelItem[]>([])
const cardBatches = ref<CardBatchItem[]>([])
const cardCodes = ref<CardCodeItem[]>([])
const pointLogs = ref<AdminPointLogItem[]>([])
const userPoints = ref<MarketingUserPointItem[]>([])

const loading = ref(false)
const submitting = ref(false)
const codesLoading = ref(false)
const compensationLoading = ref(false)
const compensationSubmitting = ref(false)
const pointLogCopiedKey = ref('')
const activeTool = ref<MarketingToolKey>('membership')
const selectedCompensationAssociationNos = ref<string[]>([])
const userPointsLoading = ref(false)
const userPointsKeyword = ref('')
const userPointsTotal = ref(0)
const userPointsPagination = reactive({
  page: 1,
  pageSize: 10,
})
const userPointsLoaded = ref(false)
const pointLogFilters = reactive({
  days: 30,
  action: '',
  sourceType: '',
  endpointType: '',
  refundStatus: '',
  keyword: '',
})
const pointLogFilterDefaults = {
  days: 30,
  action: '',
  sourceType: '',
  endpointType: '',
  refundStatus: '',
  keyword: '',
}
const pointLogPagination = reactive({
  page: 1,
  pageSize: 10,
})
const compensationForm = reactive({
  manualAssociationNos: '',
  note: '',
  forceManual: false,
})
const pointLogSummary = reactive<AdminPointLogListResult['summary']>({
  totalCount: 0,
  compensableCount: 0,
  refundCount: 0,
  windowDays: 30,
  page: 1,
  pageSize: 10,
  totalPages: 1,
})
const { activeFilterCount: pointLogActiveFilterCount, resetFilters: resetPointLogFilters } = useAdminListFilters({
  filters: pointLogFilters,
  defaults: pointLogFilterDefaults,
})

const marketingTools = computed(() => [
  {
    key: 'membership' as MarketingToolKey,
    icon: '👑',
    title: '会员等级',
    description: '自行设置会员等级与成长体系',
    meta: () => `${levels.value.length} 个等级`,
  },
  {
    key: 'userPoints' as MarketingToolKey,
    icon: '👥',
    title: '用户积分',
    description: '查看用户积分余额与会员订阅',
    meta: () => `${userPointsTotal.value} 个用户`,
  },
  {
    key: 'cdk' as MarketingToolKey,
    icon: '🪪',
    title: '卡密兑换',
    description: '批量生成卡密并投放运营活动',
    meta: () => `${cardBatches.value.length} 个批次`,
  },
  {
    key: 'compensation' as MarketingToolKey,
    icon: '🧾',
    title: '积分流水',
    description: '查看积分明细、筛选状态并处理失败补偿',
    meta: () => `${pointLogSummary.totalCount} 条流水 / 可补偿 ${pointLogSummary.compensableCount} 条`,
  },
])

const currentToolInfo = computed(() => {
  if (activeTool.value === 'membership') {
    return {
      title: '会员等级',
      description: '管理会员等级、专属权益与长期成长体系',
      focus: '适合处理等级成长、月赠积分和会员差异化权益。',
      meta: `${levels.value.length} 个等级`,
    }
  }
  if (activeTool.value === 'userPoints') {
    return {
      title: '用户积分 / 会员',
      description: '查看用户积分余额与生效中的会员订阅',
      focus: '适合核对用户当前积分、会员等级与到期时间。',
      meta: `${userPointsTotal.value} 个用户`,
    }
  }
  if (activeTool.value === 'cdk') {
    return {
      title: '卡密兑换',
      description: '管理批次投放、卡密发放与兑换追踪',
      focus: '适合活动发码、渠道合作、定向补贴等场景。',
      meta: `${cardBatches.value.length} 个批次 / ${cardCodes.value.length} 条卡密缓存`,
    }
  }
  return {
    title: '积分流水',
    description: '查看积分明细、筛选状态并处理失败补偿',
    focus: '适合运营核对每一笔积分变动，并在失败未退款的生成流水上直接执行补偿。',
    meta: `${pointLogSummary.totalCount} 条流水 / 可补偿 ${pointLogSummary.compensableCount} 条`,
  }
})

const createLevelForm = () => ({
  name: '',
  level: Math.max(levels.value.length + 1, 1),
  description: '',
  iconUrl: '',
  monthlyBonusPoints: 0,
  storageCapacity: 0,
  // 会员积分消耗减免百分比(0-100)。
  pointDiscountPercent: 0,
  benefitsJsonText: '[]',
  isEnabled: true,
  sortOrder: levels.value.length,
})

const createBatchForm = () => ({
  name: '',
  batchNo: '',
  description: '',
  rewardType: 'POINTS',
  rewardPoints: 0,
  rewardLevelId: '',
  rewardDays: 30,
  totalCount: 10,
  expiresAt: '',
  isEnabled: true,
  metaJsonText: '{}',
})

const levelDialogVisible = ref(false)
const levelEditingId = ref('')
const levelForm = reactive(createLevelForm())

const batchDialogVisible = ref(false)
const batchEditingId = ref('')
const batchForm = reactive(createBatchForm())

const codesDialogVisible = ref(false)
const currentBatch = ref<CardBatchItem | null>(null)
const manualCompensationDialogVisible = ref(false)

// 用于把表单重置为最新初始值，避免多次弹窗编辑残留脏数据。
const assignForm = <T extends Record<string, any>>(target: T, source: T) => {
  Object.assign(target, source)
}

const parseJsonText = (value: string, fallback: unknown) => {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return fallback
  }
  return JSON.parse(normalized)
}

const formatJsonText = (value: unknown, fallback = '{}') => {
  if (value === null || value === undefined || value === '') {
    return fallback
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

const toDatetimeLocalValue = (value: string | null | undefined) => {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const formatDateText = (value: string | null | undefined) => {
  if (!value) {
    return '未设置'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '未设置'
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}

const getCardRewardSummary = (item: CardBatchItem) => {
  if (item.rewardType === 'MEMBERSHIP') {
    return `${item.rewardLevel?.name || '会员权益'} ${item.rewardDays || 0} 天`
  }
  return `${item.rewardPoints} 积分`
}

const parseAssociationNoList = (value: string) => {
  return Array.from(new Set(
    String(value || '')
      .split(/[\n,，\s]+/g)
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

const toggleCompensationSelection = (associationNo: string) => {
  const current = new Set(selectedCompensationAssociationNos.value)
  if (current.has(associationNo)) {
    current.delete(associationNo)
  } else {
    current.add(associationNo)
  }
  selectedCompensationAssociationNos.value = Array.from(current)
}

// 统一处理后台复制动作，优先使用 Clipboard API，失败时自动回退到选区复制。
const copyText = async (value: string) => {
  const text = String(value || '').trim()
  if (!text) {
    throw new Error('empty_text')
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed'
  textArea.style.opacity = '0'
  textArea.style.pointerEvents = 'none'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textArea)
  if (!copied) {
    throw new Error('copy_failed')
  }
}

const buildPointLogCopyKey = (field: 'user' | 'association', recordId: string) => {
  return `${field}:${recordId}`
}

const resolveCopyButtonText = (field: 'user' | 'association', recordId: string, fallback: string) => {
  return pointLogCopiedKey.value === buildPointLogCopyKey(field, recordId) ? '已复制' : fallback
}

const handleCopyPointLogText = async (field: 'user' | 'association', recordId: string, value: string) => {
  try {
    await copyText(value)
    const currentKey = buildPointLogCopyKey(field, recordId)
    pointLogCopiedKey.value = currentKey
    window.setTimeout(() => {
      if (pointLogCopiedKey.value === currentKey) {
        pointLogCopiedKey.value = ''
      }
    }, 1600)
  } catch {
    window.alert('复制失败，请稍后重试。')
  }
}

const openManualCompensationDialog = () => {
  manualCompensationDialogVisible.value = true
}

const closeManualCompensationDialog = () => {
  manualCompensationDialogVisible.value = false
}

const loadPointLogs = async () => {
  compensationLoading.value = true
  try {
    const result = await listAdminPointLogs({
      ...pointLogFilters,
      page: pointLogPagination.page,
      pageSize: pointLogPagination.pageSize,
    })
    pointLogs.value = Array.isArray(result.items) ? result.items : []
    pointLogSummary.totalCount = Number(result.summary?.totalCount || 0)
    pointLogSummary.compensableCount = Number(result.summary?.compensableCount || 0)
    pointLogSummary.refundCount = Number(result.summary?.refundCount || 0)
    pointLogSummary.windowDays = Number(result.summary?.windowDays || pointLogFilters.days)
    pointLogSummary.page = Number(result.summary?.page || pointLogPagination.page)
    pointLogSummary.pageSize = Number(result.summary?.pageSize || pointLogPagination.pageSize)
    pointLogSummary.totalPages = Number(result.summary?.totalPages || 1)
    selectedCompensationAssociationNos.value = selectedCompensationAssociationNos.value
      .filter((item) => pointLogs.value.some((log) => log.associationNo === item && log.canCompensate))
    pointLogPagination.page = pointLogSummary.page
    pointLogPagination.pageSize = pointLogSummary.pageSize
  } finally {
    compensationLoading.value = false
  }
}

const handleApplyPointLogFilters = async () => {
  pointLogPagination.page = 1
  await loadPointLogs()
}

const handleResetPointLogFilters = async () => {
  resetPointLogFilters()
  pointLogPagination.page = 1
  await loadPointLogs()
}

const handlePointLogPaginationChange = async (payload: { page: number; pageSize: number }) => {
  pointLogPagination.page = payload.page
  pointLogPagination.pageSize = payload.pageSize
  await loadPointLogs()
}

const loadUserPoints = async () => {
  userPointsLoading.value = true
  try {
    const result = await listAdminMarketingUserPoints({
      keyword: userPointsKeyword.value || undefined,
      page: userPointsPagination.page,
      pageSize: userPointsPagination.pageSize,
    })
    userPoints.value = Array.isArray(result.items) ? result.items : []
    userPointsTotal.value = Number(result.summary?.totalCount || 0)
    userPointsPagination.page = Number(result.summary?.page || userPointsPagination.page)
    userPointsPagination.pageSize = Number(result.summary?.pageSize || userPointsPagination.pageSize)
    userPointsLoaded.value = true
  } finally {
    userPointsLoading.value = false
  }
}

const handleApplyUserPointsKeyword = async () => {
  userPointsPagination.page = 1
  await loadUserPoints()
}

const handleResetUserPointsKeyword = async () => {
  userPointsKeyword.value = ''
  userPointsPagination.page = 1
  await loadUserPoints()
}

const handleUserPointsPaginationChange = async (payload: { page: number; pageSize: number }) => {
  userPointsPagination.page = payload.page
  userPointsPagination.pageSize = payload.pageSize
  await loadUserPoints()
}

const fillLegacyCompensationExample = () => {
  compensationForm.manualAssociationNos = [
    'GTK1777512523146OM0MFW',
    'GTK1777512456545MH6GTH',
  ].join('\n')
  if (!compensationForm.note) {
    compensationForm.note = '补偿修复前产生的对话失败未退款历史流水'
  }
  compensationForm.forceManual = true
}

const handleExecuteSelectedPointLogCompensation = async () => {
  if (!selectedCompensationAssociationNos.value.length) {
    window.alert('请先选择需要补偿的流水记录。')
    return
  }
  if (!window.confirm(`确认补偿已选中的 ${selectedCompensationAssociationNos.value.length} 条积分流水吗？`)) {
    return
  }

  compensationSubmitting.value = true
  try {
    const result = await executePointCompensation({
      associationNos: selectedCompensationAssociationNos.value,
      note: compensationForm.note || '后台手动补偿失败未退款任务',
      forceManual: false,
    })
    selectedCompensationAssociationNos.value = []
    await loadPointLogs()
    window.alert(`补偿完成：成功 ${result.refundedCount} 条，跳过 ${result.skippedCount} 条。`)
  } finally {
    compensationSubmitting.value = false
  }
}

const handleExecuteSinglePointLogCompensation = async (associationNo: string) => {
  if (!associationNo) {
    return
  }
  if (!window.confirm(`确认补偿流水 ${associationNo} 吗？`)) {
    return
  }
  compensationSubmitting.value = true
  try {
    const result = await executePointCompensation({
      associationNos: [associationNo],
      note: compensationForm.note || '后台单条失败补偿',
      forceManual: false,
    })
    await loadPointLogs()
    window.alert(`补偿完成：成功 ${result.refundedCount} 条，跳过 ${result.skippedCount} 条。`)
  } finally {
    compensationSubmitting.value = false
  }
}

const handleExecuteManualCompensation = async () => {
  const associationNos = parseAssociationNoList(compensationForm.manualAssociationNos)
  if (!associationNos.length) {
    window.alert('请先输入至少一个关联号。')
    return
  }
  if (!window.confirm(`确认手动补偿 ${associationNos.length} 条流水吗？该操作会直接补回积分。`)) {
    return
  }

  compensationSubmitting.value = true
  try {
    const result = await executePointCompensation({
      associationNos,
      note: compensationForm.note || '后台手动补偿历史漏账',
      forceManual: compensationForm.forceManual,
    })
    compensationForm.manualAssociationNos = ''
    compensationForm.note = ''
    compensationForm.forceManual = false
    closeManualCompensationDialog()
    await loadPointLogs()
    window.alert(`手动补偿完成：成功 ${result.refundedCount} 条，跳过 ${result.skippedCount} 条。`)
  } finally {
    compensationSubmitting.value = false
  }
}

const getPointLogTitle = (item: AdminPointLogItem) => {
  if (item.remark) {
    return item.remark
  }
  if (item.sourceType === 'RECHARGE_ORDER') return '充值到账'
  if (item.sourceType === 'MEMBERSHIP_ORDER') return '订阅积分到账'
  if (item.sourceType === 'CHECKIN') return '签到奖励'
  if (item.sourceType === 'CARD_REDEEM') return '卡密兑换'
  if (item.sourceType === 'REWARD_RULE') return '奖励规则发放'
  return '积分流水'
}

const resolvePointLogUserText = (item: AdminPointLogItem) => {
  if (item.userName) {
    if (item.userPhone) {
      return `${item.userName}（${item.userPhone}）`
    }
    if (item.userEmail) {
      return `${item.userName}（${item.userEmail}）`
    }
    return item.userName
  }
  return item.userPhone || item.userEmail || '未知用户'
}

const resolvePointLogStatusText = (item: AdminPointLogItem) => {
  if (item.canCompensate) return '待补偿'
  if (item.refunded) return '已退款'
  if (item.generationStatus === 'FAILED') return '失败未退'
  if (item.generationStatus === 'STOPPED') return '停止未退'
  return item.action === 'DECREASE' ? '已支出' : '已入账'
}

const resolvePointLogStatusClass = (item: AdminPointLogItem) => {
  if (item.canCompensate) return 'admin-status--warning'
  if (item.refunded) return 'admin-status--success'
  return item.action === 'DECREASE' ? 'admin-status--muted' : 'admin-status--success'
}

const loadAllData = async () => {
  loading.value = true
  try {
    const [overviewData, levelData, batchData, pointLogData] = await Promise.all([
      getAdminMarketingOverview(),
      listMembershipLevels(),
      listCardBatches(),
      listAdminPointLogs({
        ...pointLogFilters,
        page: pointLogPagination.page,
        pageSize: pointLogPagination.pageSize,
      }),
    ])
    overview.value = overviewData
    levels.value = levelData
    cardBatches.value = batchData
    pointLogs.value = Array.isArray(pointLogData.items) ? pointLogData.items : []
    pointLogSummary.totalCount = Number(pointLogData.summary?.totalCount || 0)
    pointLogSummary.compensableCount = Number(pointLogData.summary?.compensableCount || 0)
    pointLogSummary.refundCount = Number(pointLogData.summary?.refundCount || 0)
    pointLogSummary.windowDays = Number(pointLogData.summary?.windowDays || pointLogFilters.days)
    pointLogSummary.page = Number(pointLogData.summary?.page || pointLogPagination.page)
    pointLogSummary.pageSize = Number(pointLogData.summary?.pageSize || pointLogPagination.pageSize)
    pointLogSummary.totalPages = Number(pointLogData.summary?.totalPages || 1)
    selectedCompensationAssociationNos.value = selectedCompensationAssociationNos.value
      .filter((item) => pointLogs.value.some((log) => log.associationNo === item && log.canCompensate))
    pointLogPagination.page = pointLogSummary.page
    pointLogPagination.pageSize = pointLogSummary.pageSize
  } finally {
    loading.value = false
  }
}

const openLevelDialog = (item?: MembershipLevelItem) => {
  levelEditingId.value = item?.id || ''
  assignForm(levelForm, item ? {
    name: item.name,
    level: item.level,
    description: item.description || '',
    iconUrl: item.iconUrl || '',
    monthlyBonusPoints: item.monthlyBonusPoints,
    storageCapacity: Number(item.storageCapacity || 0),
    pointDiscountPercent: Number(item.pointDiscountPercent || 0),
    benefitsJsonText: formatJsonText(item.benefitsJson, '[]'),
    isEnabled: item.isEnabled,
    sortOrder: item.sortOrder,
  } : createLevelForm())
  levelDialogVisible.value = true
}

const closeLevelDialog = () => {
  levelDialogVisible.value = false
  levelEditingId.value = ''
  assignForm(levelForm, createLevelForm())
}

const handleSubmitLevel = async () => {
  submitting.value = true
  try {
    const payload = {
      name: levelForm.name,
      level: Number(levelForm.level || 1),
      description: levelForm.description || '',
      iconUrl: levelForm.iconUrl || '',
      monthlyBonusPoints: Number(levelForm.monthlyBonusPoints || 0),
      storageCapacity: Number(levelForm.storageCapacity || 0),
      pointDiscountPercent: Math.min(100, Math.max(0, Number(levelForm.pointDiscountPercent || 0))),
      benefitsJson: parseJsonText(levelForm.benefitsJsonText, []),
      isEnabled: Boolean(levelForm.isEnabled),
      sortOrder: Number(levelForm.sortOrder || 0),
    }
    if (levelEditingId.value) {
      await updateMembershipLevel(levelEditingId.value, payload)
    } else {
      await createMembershipLevel(payload)
    }
    closeLevelDialog()
    await loadAllData()
  } finally {
    submitting.value = false
  }
}

const handleDeleteLevel = async (item: MembershipLevelItem) => {
  if (!window.confirm(`确认删除会员等级“${item.name}”吗？`)) {
    return
  }
  await deleteMembershipLevel(item.id)
  await loadAllData()
}

const openBatchDialog = (item?: CardBatchItem) => {
  batchEditingId.value = item?.id || ''
  assignForm(batchForm, item ? {
    name: item.name,
    batchNo: item.batchNo,
    description: item.description || '',
    rewardType: item.rewardType,
    rewardPoints: item.rewardPoints,
    rewardLevelId: item.rewardLevelId || '',
    rewardDays: item.rewardDays || 30,
    totalCount: item.totalCount,
    expiresAt: toDatetimeLocalValue(item.expiresAt),
    isEnabled: item.isEnabled,
    metaJsonText: formatJsonText(item.metaJson, '{}'),
  } : createBatchForm())
  batchDialogVisible.value = true
}

const closeBatchDialog = () => {
  batchDialogVisible.value = false
  batchEditingId.value = ''
  assignForm(batchForm, createBatchForm())
}

const handleSubmitBatch = async () => {
  submitting.value = true
  try {
    const payload = {
      name: batchForm.name,
      batchNo: batchForm.batchNo,
      description: batchForm.description || '',
      rewardType: batchForm.rewardType,
      rewardPoints: batchForm.rewardType === 'POINTS' ? Number(batchForm.rewardPoints || 0) : 0,
      rewardLevelId: batchForm.rewardType === 'MEMBERSHIP' ? batchForm.rewardLevelId : '',
      rewardDays: batchForm.rewardType === 'MEMBERSHIP' ? Number(batchForm.rewardDays || 30) : null,
      totalCount: Number(batchForm.totalCount || 1),
      expiresAt: batchForm.expiresAt ? new Date(batchForm.expiresAt).toISOString() : '',
      isEnabled: Boolean(batchForm.isEnabled),
      metaJson: parseJsonText(batchForm.metaJsonText, {}),
    }
    if (batchEditingId.value) {
      await updateCardBatch(batchEditingId.value, payload)
    } else {
      await createCardBatch(payload)
    }
    closeBatchDialog()
    await loadAllData()
  } finally {
    submitting.value = false
  }
}

const handleDeleteBatch = async (item: CardBatchItem) => {
  if (!window.confirm(`确认删除卡密批次“${item.name}”吗？此操作会删除批次下所有卡密。`)) {
    return
  }
  await deleteCardBatch(item.id)
  await loadAllData()
}

const openCodesDialog = async (item: CardBatchItem) => {
  currentBatch.value = item
  codesDialogVisible.value = true
  codesLoading.value = true
  try {
    cardCodes.value = await listCardCodesByBatch(item.id)
  } finally {
    codesLoading.value = false
  }
}

const closeCodesDialog = () => {
  codesDialogVisible.value = false
  currentBatch.value = null
  cardCodes.value = []
}

// 用户积分列表数据量可能较大，仅在首次切换到该工具时按需加载。
watch(activeTool, (tool) => {
  if (tool === 'userPoints' && !userPointsLoaded.value) {
    void loadUserPoints()
  }
})

onMounted(() => {
  void loadAllData()
})
</script>


<style scoped>
.admin-marketing-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.9fr);
  gap: 18px;
  margin-bottom: 20px;
}

.admin-marketing-hero__main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid var(--line-divider, #00000014);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--brand-main-default) 12%, transparent), transparent 32%),
    linear-gradient(180deg, color-mix(in srgb, var(--brand-main-block-default) 28%, var(--bg-surface)), var(--bg-surface));
}

.admin-marketing-hero__eyebrow {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--brand-main-default);
}

.admin-marketing-hero__title {
  margin: 0;
  font-size: 28px;
  line-height: 1.3;
  color: var(--text-primary);
}

.admin-marketing-hero__desc {
  margin: 0;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-secondary);
}

.admin-marketing-hero__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.admin-marketing-hero__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.admin-marketing-workspace {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.admin-marketing-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-marketing-sidebar-card {
  position: sticky;
  top: 20px;
}

.admin-marketing-main {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.admin-marketing-main__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 20px;
  border: 1px solid var(--line-divider, #00000014);
  background: var(--bg-surface);
}

.admin-marketing-main__title {
  margin: 0 0 6px;
  font-size: 22px;
  line-height: 1.35;
  color: var(--text-primary);
}

.admin-marketing-main__desc,
.admin-marketing-main__meta {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.admin-marketing-main__meta {
  white-space: nowrap;
}

.admin-marketing-section-shell {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.admin-marketing-module-card {
  border-radius: 22px;
}

.admin-marketing-log-toolbar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid var(--line-divider, #00000014);
  border-radius: 16px;
  background: var(--bg-block-primary-default);
}

.admin-marketing-log-toolbar__search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.admin-marketing-log-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.admin-marketing-log-filters {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.admin-marketing-log-filter-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.admin-marketing-log-filter-field--search {
  min-width: 0;
}

.admin-marketing-log-filter-field__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.admin-marketing-log-filter-field__control {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--line-divider, #00000014);
  border-radius: 12px;
  background: var(--bg-surface);
  color: var(--text-primary);
  box-sizing: border-box;
  transition: border-color .2s ease, box-shadow .2s ease, background-color .2s ease;
}

.admin-marketing-log-filter-field__control:focus {
  border-color: color-mix(in srgb, var(--brand-main-default) 48%, var(--line-divider, #00000014));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-main-default) 14%, transparent);
  outline: none;
}

.admin-marketing-log-filter-field__control.admin-input {
  padding: 0 14px;
}

.admin-marketing-log-filter-field__control.admin-select {
  padding: 0 42px 0 14px;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--text-tertiary) 50%),
    linear-gradient(135deg, var(--text-tertiary) 50%, transparent 50%),
    linear-gradient(to right, color-mix(in srgb, var(--line-divider, #00000014) 100%, transparent), color-mix(in srgb, var(--line-divider, #00000014) 100%, transparent));
  background-position:
    calc(100% - 18px) calc(50% - 3px),
    calc(100% - 12px) calc(50% - 3px),
    calc(100% - 38px) 50%;
  background-size:
    6px 6px,
    6px 6px,
    1px 18px;
  background-repeat: no-repeat;
}

.admin-marketing-log-filter-field__control.admin-select:hover {
  border-color: color-mix(in srgb, var(--brand-main-default) 26%, var(--line-divider, #00000014));
  background-color: color-mix(in srgb, var(--bg-surface) 92%, var(--brand-main-default) 8%);
}

.admin-marketing-log-filter-field__control.admin-select option {
  color: var(--text-primary);
  background: var(--bg-surface);
}

.admin-marketing-log-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.admin-marketing-log-summary__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 84px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--line-divider, #00000014);
  background: var(--bg-block-primary-default);
}

.admin-marketing-log-summary__label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.admin-marketing-log-summary__value {
  font-size: 24px;
  line-height: 1.1;
  color: var(--text-primary);
}

.admin-point-log-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.admin-point-log-item {
  grid-template-columns: auto minmax(0, 1.8fr) minmax(180px, 0.7fr) auto;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid var(--line-divider, #00000014);
  background: var(--bg-block-primary-default);
}

.admin-point-log-item__check {
  padding-top: 4px;
}

.admin-point-log-item__main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.admin-point-log-item__headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.admin-point-log-item__amount {
  white-space: nowrap;
}

.admin-point-log-item__amount.is-increase {
  color: var(--brand-main-default);
}

.admin-point-log-item__amount.is-decrease {
  color: #ff8a65;
}

.admin-point-log-item__meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}

.admin-point-log-item__copy-button {
  margin-left: 8px;
  padding: 0;
  min-height: auto;
  border: none;
  background: transparent;
  color: var(--brand-main-default);
  font-size: 12px;
  font-weight: 500;
}

.admin-point-log-item__aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.admin-point-log-item__status {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.admin-point-log-item__compensation-reason {
  font-size: 12px;
  line-height: 1.6;
  text-align: right;
  color: var(--text-tertiary);
}

.admin-user-point-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.admin-user-point-item {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(120px, 0.8fr));
  gap: 14px;
  align-items: center;
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid var(--line-divider, #00000014);
  background: var(--bg-block-primary-default);
}

.admin-user-point-item__profile {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.admin-user-point-item__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.admin-user-point-item__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--brand-main-default) 18%, var(--bg-surface));
  color: var(--brand-main-default);
  font-weight: 700;
}

.admin-user-point-item__metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.admin-user-point-item__metric-label {
  font-size: 12px;
  color: var(--text-tertiary);
}

.admin-user-point-item__metric-value {
  font-size: 18px;
  line-height: 1.2;
  color: var(--text-primary);
}

.admin-user-point-item__metric-text {
  font-size: 13px;
  color: var(--text-secondary);
}

.admin-compensation-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.admin-compensation-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: flex-start;
  cursor: pointer;
}

.admin-compensation-item__check {
  padding-top: 4px;
}

.admin-compensation-item__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.admin-compensation-item__error {
  color: var(--text-danger, #d14343);
}

.admin-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--text-secondary, rgba(15, 23, 42, 0.68));
}

@media (max-width: 1100px) {
  .admin-marketing-hero,
  .admin-marketing-workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-marketing-hero__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-marketing-sidebar-card {
    position: static;
  }

  .admin-user-point-item {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-marketing-log-toolbar__search {
    grid-template-columns: 1fr;
  }

  .admin-marketing-log-toolbar__actions {
    justify-content: flex-end;
  }

  .admin-marketing-log-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-marketing-log-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .admin-point-log-item,
  .admin-compensation-item {
    grid-template-columns: 1fr;
  }

  .admin-point-log-item__aside {
    align-items: flex-start;
  }

  .admin-point-log-item__compensation-reason {
    text-align: left;
  }

  .admin-point-log-item__meta-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .admin-marketing-hero__stats {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-marketing-main__header {
    flex-direction: column;
  }

  .admin-marketing-main__meta {
    white-space: normal;
  }

  .admin-marketing-log-filters {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-marketing-log-summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .admin-marketing-log-toolbar__actions {
    justify-content: stretch;
    flex-direction: column;
  }

  .admin-marketing-log-toolbar__actions .admin-button {
    width: 100%;
  }

  .admin-point-log-item__headline {
    align-items: flex-start;
    flex-direction: column;
  }

  .admin-user-point-item {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
