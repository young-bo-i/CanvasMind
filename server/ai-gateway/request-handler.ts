import {
  joinUpstreamUrl,
  normalizeGatewayPayload,
  readJsonBody,
  sendJson,
} from './shared'
import { forwardGatewayPayload, forwardMultipartRequest } from './forward'
import { assertProviderInScope, resolveGatewayProviderUpstream } from '../provider-config/service'
import { requireCurrentSessionUser } from '../auth/session'
import { consumeGenerationPoints, refundGenerationPoints, resolveGenerationPointCost } from '../marketing-center/service'
import { normalizeChargeableEndpointType, type AiEndpointType } from '../../src/shared/provider-endpoint-strategy'

const shouldExposeGatewayDebug = () => String(process.env.AI_GATEWAY_DEBUG_HEADERS || '').trim() === 'true'

const isChargeableGenerationRequest = (input: {
  providerId: string
  endpointType?: AiEndpointType
  method: string
}) => {
  const chargeableEndpointType = normalizeChargeableEndpointType(input.endpointType)
  return Boolean(input.providerId)
    && input.method === 'POST'
    && (chargeableEndpointType === 'image' || chargeableEndpointType === 'video')
}

const buildGatewayAssociationNo = () => {
  return `GWY${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export const handleAiGatewayRequest = async (req: any, res: any) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Method Not Allowed' })
    return
  }

  // 安全：所有网关请求一律要求登录（此前仅对"计费分支"鉴权，导致未授权用户可
  // 借网关发起 SSRF / 把服务器当匿名中转）。鉴权前置后，下方分支统一复用该用户。
  const sessionUser = await requireCurrentSessionUser(req, res)
  if (!sessionUser?.id) {
    return
  }

  // 默认禁止"客户端自定义上游地址/密钥"转发(SSRF/凭据中转风险)。正常前端只发
  // providerId/modelKey，由服务端解析真实上游。确需放开时设 AI_GATEWAY_ALLOW_RAW_UPSTREAM=true。
  const allowRawUpstream = String(process.env.AI_GATEWAY_ALLOW_RAW_UPSTREAM || '').trim() === 'true'

  let debugUpstreamUrl = ''
  let debugUpstreamMethod = 'POST'

  try {
    const headerBaseUrl = String(req.headers['x-upstream-base-url'] || '').trim()
    const headerEndpoint = String(req.headers['x-upstream-endpoint'] || '').trim()
    const headerApiKey = String(req.headers['x-upstream-api-key'] || '').trim()
    const headerProviderId = String(req.headers['x-upstream-provider-id'] || '').trim()
    const headerEndpointType = String(req.headers['x-upstream-endpoint-type'] || '').trim() as AiEndpointType
    const headerModelKey = String(req.headers['x-upstream-model-key'] || '').trim()
    const headerMethod = String(req.headers['x-upstream-method'] || 'POST').trim().toUpperCase()
    const billedHeaderEndpointType = normalizeChargeableEndpointType(headerEndpointType)

    const shouldChargeHeaderRequest = isChargeableGenerationRequest({
      providerId: headerProviderId,
      endpointType: headerEndpointType,
      method: headerMethod,
    })

    if (headerProviderId && headerEndpointType) {
      const currentUser = sessionUser

      // 租户隔离：只能用本人所属管理员作用域内的厂商。
      await assertProviderInScope(headerProviderId, currentUser?.id)

      const upstream = await resolveGatewayProviderUpstream({
        providerId: headerProviderId,
        endpointType: headerEndpointType,
        modelKey: headerModelKey || undefined,
      })
      debugUpstreamUrl = joinUpstreamUrl(upstream.baseUrl, upstream.endpoint)
      debugUpstreamMethod = headerMethod

      const billingDetail = shouldChargeHeaderRequest
        ? await resolveGenerationPointCost({
          providerId: headerProviderId,
          modelKey: headerModelKey,
          endpointType: billedHeaderEndpointType as 'image' | 'video',
        })
        : { pointCost: 0, modelId: '', modelName: '' }

      const associationNo = buildGatewayAssociationNo()
      const consumedPointLog = shouldChargeHeaderRequest && billingDetail.pointCost > 0
        ? await consumeGenerationPoints({
          userId: currentUser!.id,
          pointCost: billingDetail.pointCost,
          sourceId: associationNo,
          associationNo,
          endpointType: billedHeaderEndpointType as 'image' | 'video',
          providerId: headerProviderId,
          modelKey: headerModelKey,
          modelName: billingDetail.modelName,
          metaJson: {
            gatewayPath: 'multipart-header',
          },
        })
        : null

      let refunded = false
      const refundConsumedPointsIfNeeded = async (reason: string) => {
        if (!consumedPointLog || refunded) return
        refunded = true
        try {
          await refundGenerationPoints({
            userId: currentUser!.id,
            pointCost: billingDetail.pointCost,
            sourceId: associationNo,
            associationNo,
            endpointType: billedHeaderEndpointType as 'image' | 'video',
            providerId: headerProviderId,
            modelKey: headerModelKey,
            modelName: billingDetail.modelName,
            dedupeKey: `gen-refund:${associationNo}`,
            metaJson: { refundReason: reason },
          })
        } catch (error) {
          console.error('[ai-gateway][refund-error]', JSON.stringify({
            reason,
            endpointType: headerEndpointType,
            providerId: headerProviderId,
            modelKey: headerModelKey,
            message: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      await forwardMultipartRequest({
        req,
        res,
        baseUrl: upstream.baseUrl,
        endpoint: upstream.endpoint,
        apiKey: upstream.apiKey || undefined,
        method: headerMethod,
        // 厂商上游由管理员在后台配置，可信(允许自建本地模型)。
        allowPrivateHosts: true,
        beforeProxy: async ({ upstreamResponse, res: currentRes }) => {
          if (!upstreamResponse.ok) {
            await refundConsumedPointsIfNeeded(`upstream_status_${upstreamResponse.status}`)
            return
          }
          if (consumedPointLog) {
            currentRes.setHeader('x-marketing-points-updated', '1')
            currentRes.setHeader('x-marketing-points-balance', String(consumedPointLog.balanceAfter || consumedPointLog.availableAmount || 0))
          }
        },
        onError: async () => {
          await refundConsumedPointsIfNeeded('gateway_fetch_failed')
        },
      })
      return
    }

    if (headerBaseUrl && headerEndpoint) {
      if (!allowRawUpstream) {
        sendJson(res, 403, {
          message: '已禁用自定义上游地址转发',
          error: { type: 'gateway_raw_upstream_forbidden', message: '已禁用自定义上游地址转发' },
        })
        return
      }
      debugUpstreamUrl = `${headerBaseUrl.replace(/\/+$/, '')}/${headerEndpoint.replace(/^\/+/, '')}`
      debugUpstreamMethod = headerMethod
      await forwardMultipartRequest({
        req,
        res,
        baseUrl: headerBaseUrl,
        endpoint: headerEndpoint,
        apiKey: headerApiKey || undefined,
        method: headerMethod,
        // 客户端自定义上游：禁止私网目标，防 SSRF。
        allowPrivateHosts: false,
      })
      return
    }

    const payload = await readJsonBody(req)
    const normalized = normalizeGatewayPayload(payload)
    // 租户隔离：只能用本人所属管理员作用域内的厂商。
    if (normalized.providerId) {
      await assertProviderInScope(normalized.providerId, sessionUser?.id)
    }
    const upstream = normalized.providerId && normalized.endpointType
      ? await resolveGatewayProviderUpstream({
        providerId: normalized.providerId,
        endpointType: normalized.endpointType,
        modelKey: normalized.modelKey || undefined,
      })
      : null

    // 无法解析到后台厂商配置(即依赖客户端自带 baseUrl/apiKey)时默认拒绝，防 SSRF/凭据中转。
    if (!upstream && !allowRawUpstream) {
      sendJson(res, 400, {
        message: '缺少有效的上游模型配置',
        error: { type: 'gateway_invalid_upstream', message: '缺少有效的上游模型配置' },
      })
      return
    }

    debugUpstreamUrl = upstream
      ? joinUpstreamUrl(upstream.baseUrl, upstream.endpoint)
      : normalized.upstreamUrl
    debugUpstreamMethod = normalized.method

    const shouldChargeJsonRequest = isChargeableGenerationRequest({
      providerId: normalized.providerId,
      endpointType: normalized.endpointType,
      method: normalized.method,
    })
    const billedJsonEndpointType = normalizeChargeableEndpointType(normalized.endpointType)

    const currentUser = sessionUser

    // 图片按张计费：从请求体取 n/count（兼容 body 为对象或 JSON 字符串）。
    const gatewayJsonBody = ((): Record<string, unknown> => {
      const body = normalized.body
      if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
      if (typeof body === 'string') {
        try {
          const parsed = JSON.parse(body)
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
        } catch {
          return {}
        }
      }
      return {}
    })()
    const gatewayImageCount = Math.max(1, Math.floor(Number(gatewayJsonBody.n ?? gatewayJsonBody.count) || 1))

    const billingDetail = shouldChargeJsonRequest
      ? await resolveGenerationPointCost({
        providerId: normalized.providerId,
        modelKey: normalized.modelKey,
        endpointType: billedJsonEndpointType as 'image' | 'video',
        imageCount: billedJsonEndpointType === 'image' ? gatewayImageCount : undefined,
      })
      : { pointCost: 0, modelId: '', modelName: '' }

    const associationNo = buildGatewayAssociationNo()
    const consumedPointLog = shouldChargeJsonRequest && billingDetail.pointCost > 0
      ? await consumeGenerationPoints({
        userId: currentUser!.id,
        pointCost: billingDetail.pointCost,
        sourceId: associationNo,
        associationNo,
        endpointType: billedJsonEndpointType as 'image' | 'video',
        providerId: normalized.providerId,
        modelKey: normalized.modelKey,
        modelName: billingDetail.modelName,
        metaJson: {
          gatewayPath: 'json-payload',
        },
      })
      : null

    let refunded = false
    const refundConsumedPointsIfNeeded = async (reason: string) => {
      if (!consumedPointLog || refunded) return
      refunded = true
      try {
        await refundGenerationPoints({
          userId: currentUser!.id,
          pointCost: billingDetail.pointCost,
          sourceId: associationNo,
          associationNo,
          endpointType: billedJsonEndpointType as 'image' | 'video',
          providerId: normalized.providerId,
          modelKey: normalized.modelKey,
          modelName: billingDetail.modelName,
          dedupeKey: `gen-refund:${associationNo}`,
          metaJson: { refundReason: reason },
        })
      } catch (error) {
        console.error('[ai-gateway][refund-error]', JSON.stringify({
          reason,
          endpointType: normalized.endpointType,
          providerId: normalized.providerId,
          modelKey: normalized.modelKey,
          message: error instanceof Error ? error.message : String(error),
        }))
      }
    }

    await forwardGatewayPayload({
      res,
      upstreamUrl: upstream
        ? joinUpstreamUrl(upstream.baseUrl, upstream.endpoint)
        : normalized.upstreamUrl,
      apiKey: upstream
        ? (upstream.apiKey || undefined)
        : (normalized.apiKey || undefined),
      method: normalized.method,
      headers: normalized.headers,
      body: normalized.body,
      // 厂商上游(管理员配置)允许私网；仅当放开 raw 上游时才会走到客户端自带地址，那时禁止私网。
      allowPrivateHosts: Boolean(upstream),
      beforeProxy: async ({ upstreamResponse, res: currentRes }) => {
        if (!upstreamResponse.ok) {
          await refundConsumedPointsIfNeeded(`upstream_status_${upstreamResponse.status}`)
          return
        }
        if (consumedPointLog) {
          currentRes.setHeader('x-marketing-points-updated', '1')
          currentRes.setHeader('x-marketing-points-balance', String(consumedPointLog.balanceAfter || consumedPointLog.availableAmount || 0))
        }
      },
      onError: async () => {
        await refundConsumedPointsIfNeeded('gateway_fetch_failed')
      },
    })
  } catch (error: any) {
    if (error?.code === 'INSUFFICIENT_POINTS') {
      sendJson(res, 402, {
        message: error?.message || '积分不足',
        error: {
          type: 'insufficient_points',
          message: error?.message || '积分不足',
          currentBalance: Number(error?.currentBalance || 0),
          requiredPoints: Number(error?.requiredPoints || 0),
        },
      })
      return
    }

    // 透传带 statusCode 的错误(如 RawBodyTooLargeError → 413)，与 storage handler 一致；
    // 其余未知错误仍按 500。
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500
    sendJson(res, statusCode, {
      message: error?.message || 'AI 网关转发失败',
      error: {
        type: statusCode === 413 ? 'request_too_large' : 'gateway_error',
        message: error?.message || 'AI 网关转发失败',
      },
      ...(shouldExposeGatewayDebug()
        ? {
            debug: {
              upstreamUrl: debugUpstreamUrl || undefined,
              upstreamMethod: debugUpstreamMethod || undefined,
            },
          }
        : {}),
    })
  }
}
