// 深读批结果消化：把 reader 拿回来的页面交给 LLM 抽取证据/事实，再写入 evidenceStore。
// 每页一次 LLM 调用，其 usage 通过 ctx.usageAccumulator 累加。

import { normalizeComparableUrl } from '../read-target-ranker'
import { runResearchStageModel } from '../model-runner'
import {
  buildResearchDeepReadingSystemPrompt,
  buildResearchDeepReadingUserPrompt,
} from '../prompts/deep-reading'
import { resolveSourceType } from './seed-evidence'
import type { ResearchSearchResultItem } from '../tools'
import type { ResearchReaderBatchResult } from './reader-batch'
import type { ResearchStepContext } from './context'
import type {
  ResearchEvidence,
  ResearchFactNature,
} from '../../../src/shared/research/research-types'

export const shouldKeepExtractedResearchFact = (statement: string, evidence?: ResearchEvidence) => {
  const normalized = String(statement || '').replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.length < 8) {
    return false
  }

  if (evidence?.topicAlignment === 'low' || evidence?.usableFor === '不建议入正文' || evidence?.pageRole === 'noisy') {
    return false
  }

  if (/第[一二三四五六七八九十\d]+篇|本文|下文|上文|关注公众号|点赞|收藏|转发|欢迎|教程|函数|公式|操作步骤/u.test(normalized)) {
    return false
  }

  if (/发布日期|发布时间|作者简介|来源链接|阅读原文/u.test(normalized)) {
    return false
  }

  return true
}

export const inferResearchFactNature = (
  statement: string,
  sourceKind: 'fact' | 'claim',
  evidence?: ResearchEvidence,
): ResearchFactNature => {
  const normalized = String(statement || '').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'soft_claim'
  }

  if (sourceKind === 'claim') {
    return /载体|机制|逻辑|本质|视角|框架|体现|反映|表征|意味着|可视为|可以看作/u.test(normalized)
      ? 'framework_claim'
      : 'soft_claim'
  }

  if (
    (evidence?.extractedNumbers || []).length
    || (evidence?.freshnessSignals || []).length
    || /\d/.test(normalized)
    || /位于|发布于|成立于|共有|包括|增设|恢复|实施|达到|入选|公布|发布|上线/u.test(normalized)
  ) {
    return 'hard_fact'
  }

  if (/载体|机制|逻辑|本质|视角|框架|体现|反映|表征|象征|可概括为|可分为/u.test(normalized)) {
    return 'framework_claim'
  }

  return 'soft_claim'
}

// 深读单页 LLM 抽取的结构化结果类型。
type DeepReadExtraction = {
  entityMatched?: boolean
  pageRole?: 'framework' | 'evidence' | 'case' | 'opinion' | 'tool_tutorial' | 'noisy'
  topicAlignment?: 'high' | 'medium' | 'low'
  usableFor?: '主论证' | '补充案例' | '风险提示' | '不建议入正文'
  scopeWarning?: string
  summary?: string
  extractedFacts?: string[]
  extractedClaims?: string[]
  extractedNumbers?: string[]
  contradictions?: string[]
  freshnessSignals?: string[]
  authorityHints?: string[]
}

// 深读 LLM 抽取的有界并发数：此前逐页串行(N 次 90s 超时串起来)，这里与 HTTP 抓取一样并行。
const DEEP_READ_EXTRACT_CONCURRENCY = Math.max(1, Number.parseInt(process.env.DEEP_READ_CONCURRENCY || '4', 10))
// 研究全局 token 预算(0=不限)：超过后跳过剩余深读 LLM 调用，避免成本随页数线性失控。
const RESEARCH_TOKEN_BUDGET = Math.max(0, Number.parseInt(process.env.RESEARCH_TOKEN_BUDGET || '0', 10))

export const processDeepReadBatchResults = async (input: {
  ctx: ResearchStepContext
  readBatchResults: ResearchReaderBatchResult[]
  rankedResultLookup: Map<string, ResearchSearchResultItem>
  rankedResults: ResearchSearchResultItem[]
}) => {
  const { ctx } = input
  const pages = input.readBatchResults.filter((item) => item.readResult)
  if (!pages.length) {
    return
  }

  ctx.executor.emitTaskStreamEvent(ctx.task.recordId, {
    type: 'stage_changed',
    recordId: ctx.task.recordId,
    done: false,
    stopped: false,
    stage: 'deep_reading',
    message: `正在并行分析 ${pages.length} 个页面`,
    researchStage: {
      stage: 'deep_reading',
      message: `正在并行分析 ${pages.length} 个页面`,
    },
  })

  // 阶段 A：有界并发调用 LLM 抽取(贵且独立)，结果按原顺序回填；usage 同步累加(单线程安全)。
  const extractions: Array<{ item: ResearchReaderBatchResult; data: DeepReadExtraction } | null> = new Array(pages.length).fill(null)
  let cursor = 0
  const runExtractWorker = async () => {
    for (;;) {
      const myIndex = cursor
      cursor += 1
      if (myIndex >= pages.length) {
        break
      }
      const item = pages[myIndex]
      const readResult = item.readResult
      if (!readResult) {
        continue
      }
      const target = item.target
      try {
        await ctx.executor.ensureTaskNotAborted(ctx.task)
        // 命中全局 token 预算则跳过剩余抽取，控制成本。
        if (RESEARCH_TOKEN_BUDGET > 0 && ctx.usageAccumulator.snapshot().totalTokens >= RESEARCH_TOKEN_BUDGET) {
          break
        }
        const stageResult = await runResearchStageModel<DeepReadExtraction>({
          payloadRequestBody: ctx.payload.requestBody,
          modelKey: ctx.modelKey,
          systemPrompt: buildResearchDeepReadingSystemPrompt(),
          userPrompt: buildResearchDeepReadingUserPrompt({
            subject: ctx.subject,
            goal: ctx.goal,
            url: readResult.url,
            title: readResult.title,
            content: readResult.content,
          }),
          signal: ctx.task.abortController.signal,
          stage: `deep_reading_${target.batchIndex || 1}`,
          logGenerationTask: ctx.executor.logGenerationTask,
        })
        ctx.usageAccumulator.add(stageResult.usage)
        extractions[myIndex] = { item, data: stageResult.data }
      } catch (error) {
        ctx.executor.logGenerationTask('research_reader:skip', {
          recordId: ctx.task.recordId,
          url: target.url,
          errorMessage: error instanceof Error ? error.message : String(error || ''),
        })
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DEEP_READ_EXTRACT_CONCURRENCY, pages.length) }, () => runExtractWorker()),
  )

  // 阶段 B：顺序消化抽取结果(evidenceStore/emit 有状态，串行避免竞态与 id 抖动)。
  for (const extraction of extractions) {
    if (!extraction) {
      continue
    }
    const item = extraction.item
    const readResult = item.readResult
    if (!readResult) {
      continue
    }
    const target = item.target

    try {
      const deepReadResult = extraction.data

      const evidence = ctx.evidenceStore.addEvidence({
        id: `evidence-read-${target.batchIndex || 1}`,
        title: readResult.title,
        summary: String(deepReadResult.summary || readResult.excerpt || target.snippet || '已完成网页阅读').trim(),
        source: {
          title: readResult.title,
          url: readResult.url,
          sourceType: resolveSourceType(readResult.url),
          note: target.siteName || undefined,
        },
        tags: ['网页深读', ctx.subject],
        entityMatched: deepReadResult.entityMatched !== false,
        pageRole: deepReadResult.pageRole,
        topicAlignment: deepReadResult.topicAlignment,
        usableFor: deepReadResult.usableFor,
        scopeWarning: String(deepReadResult.scopeWarning || '').trim() || undefined,
        authorityHints: Array.isArray(deepReadResult.authorityHints) ? deepReadResult.authorityHints.map(entry => String(entry || '').trim()).filter(Boolean) : [],
        freshnessSignals: Array.isArray(deepReadResult.freshnessSignals) ? deepReadResult.freshnessSignals.map(entry => String(entry || '').trim()).filter(Boolean) : [],
        extractedFacts: Array.isArray(deepReadResult.extractedFacts) ? deepReadResult.extractedFacts.map(entry => String(entry || '').trim()).filter(Boolean) : [],
        extractedClaims: Array.isArray(deepReadResult.extractedClaims) ? deepReadResult.extractedClaims.map(entry => String(entry || '').trim()).filter(Boolean) : [],
        extractedNumbers: Array.isArray(deepReadResult.extractedNumbers) ? deepReadResult.extractedNumbers.map(entry => String(entry || '').trim()).filter(Boolean) : [],
        contradictions: Array.isArray(deepReadResult.contradictions) ? deepReadResult.contradictions.map(entry => String(entry || '').trim()).filter(Boolean) : [],
        discovery: (() => {
          const matchedSearchResult = input.rankedResultLookup.get(normalizeComparableUrl(readResult.url))
            || input.rankedResultLookup.get(normalizeComparableUrl(target.url))
          return matchedSearchResult
            ? {
              query: matchedSearchResult.query || '',
              provider: matchedSearchResult.provider || ctx.searchRuntime.provider || 'auto',
              rank: input.rankedResults.findIndex(result => normalizeComparableUrl(result.url) === normalizeComparableUrl(matchedSearchResult.url)) + 1,
              searchSources: matchedSearchResult.searchSources || [],
            }
            : undefined
        })(),
      })

      if (!evidence || evidence.entityMatched === false) {
        continue
      }

      ctx.executor.emitTaskStreamEvent(ctx.task.recordId, {
        type: 'evidence_added',
        recordId: ctx.task.recordId,
        done: false,
        stopped: false,
        stage: 'evidence_merge',
        message: '已采纳新的网页证据',
        evidence,
      })

      const factCandidates = [
        ...(evidence.extractedFacts || []).map(statement => ({
          statement,
          sourceKind: 'fact' as const,
        })),
        ...(evidence.extractedClaims || []).map(statement => ({
          statement,
          sourceKind: 'claim' as const,
        })),
      ].filter(candidate => shouldKeepExtractedResearchFact(candidate.statement, evidence)).slice(0, 3)

      for (const [factIndex, factCandidate] of factCandidates.entries()) {
        const statement = String(factCandidate.statement || '').trim()
        const fact = ctx.evidenceStore.addFact({
          id: `fact-read-${target.batchIndex || 1}-${factIndex + 1}`,
          statement,
          confidence: evidence.confidence,
          supportedEvidenceIds: [evidence.id],
          factType: factCandidate.sourceKind === 'fact' ? 'fact' : 'claim',
          factNature: inferResearchFactNature(statement, factCandidate.sourceKind, evidence),
          numbers: evidence.extractedNumbers || [],
          timeRefs: evidence.freshnessSignals || [],
          verificationStatus: 'unverified',
        })
        ctx.executor.emitTaskStreamEvent(ctx.task.recordId, {
          type: 'fact_update',
          recordId: ctx.task.recordId,
          done: false,
          stopped: false,
          stage: 'evidence_merge',
          message: '已更新研究事实',
          fact,
        })
      }
    } catch (error) {
      ctx.executor.logGenerationTask('research_reader:skip', {
        recordId: ctx.task.recordId,
        url: target.url,
        errorMessage: error instanceof Error ? error.message : String(error || ''),
      })
    }
  }
}
