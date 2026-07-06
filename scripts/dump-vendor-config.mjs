/**
 * 只读导出脚本：把当前生产库里"厂商 / 模型 / 旧配置"的完整配置导出为 JSON，
 * 用于把这些模型"内置化"（写死进代码）+ 核对迁移是否覆盖历史用过的所有 modelKey。
 *
 * 安全性：只读，不写任何数据；API 密钥密文一律脱敏（只保留 apiKeyHint 掩码）。
 *
 * 运行方式（在项目根目录 CanvasMind/ 下）：
 *   node --env-file=.env.production scripts/dump-vendor-config.mjs > vendor-config-dump.json
 * 或用开发库：
 *   node --env-file=.env.development scripts/dump-vendor-config.mjs > vendor-config-dump.json
 *
 * 然后把生成的 vendor-config-dump.json 内容贴给我即可（里面没有明文密钥，可安全分享）。
 */
import prismaClientPackage from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

const { PrismaClient } = prismaClientPackage

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('缺少 DATABASE_URL，请用 --env-file=.env.production 运行。')
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl), log: ['error'] })

const redact = (obj) => {
  if (!obj || typeof obj !== 'object') return obj
  const clone = Array.isArray(obj) ? [...obj] : { ...obj }
  for (const k of Object.keys(clone)) {
    if (/apiKeyEncrypted|api_key_encrypted/i.test(k)) {
      clone[k] = clone[k] ? '[REDACTED]' : null
    }
  }
  return clone
}

const main = async () => {
  // 1) 正式厂商实体（含归属管理员、端点、extraJson 视频协议配置）
  const providers = await prisma.aiProvider.findMany({
    include: {
      models: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] },
      ownerAdmin: { select: { id: true, username: true, role: true } },
    },
    orderBy: [{ ownerAdminId: 'asc' }, { sortOrder: 'asc' }],
  })

  // 2) 旧版用户级配置（materializeLegacyProvider 的来源，通常已迁移，导出以防万一）
  const legacyConfigs = await prisma.aiProviderConfig.findMany({
    include: { customModels: true },
  })

  // 3) 历史生成记录里实际用过的 modelKey / modelLabel（确保内置目录不遗漏历史模型）
  const usedModelsRaw = await prisma.generationRecord.groupBy({
    by: ['type', 'modelKey', 'modelLabel'],
    _count: { _all: true },
    where: { modelKey: { not: null } },
  })
  const usedModels = usedModelsRaw
    .map((r) => ({ type: r.type, modelKey: r.modelKey, modelLabel: r.modelLabel, count: r._count._all }))
    .sort((a, b) => b.count - a.count)

  // 4) 各生成类型的记录数（评估删除 agent/research/digital-human/motion 的历史体量）
  const typeCountsRaw = await prisma.generationRecord.groupBy({ by: ['type'], _count: { _all: true } })
  const typeCounts = typeCountsRaw.map((r) => ({ type: r.type, count: r._count._all }))

  // 5) 管理员清单（确认 ownerAdminId 租户维度）
  const admins = await prisma.appUser.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
    select: { id: true, username: true, role: true, ownerAdminId: true },
  })

  const output = {
    generatedAt: new Date().toISOString(),
    admins,
    providers: providers.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      ownerAdminId: p.ownerAdminId,
      ownerAdmin: p.ownerAdmin,
      baseUrl: p.baseUrl,
      apiKeyHint: p.apiKeyHint,
      hasApiKey: Boolean(p.apiKeyEncrypted),
      chatEndpoint: p.chatEndpoint,
      imageEndpoint: p.imageEndpoint,
      imageEditEndpoint: p.imageEditEndpoint,
      videoEndpoint: p.videoEndpoint,
      defaultChatModel: p.defaultChatModel,
      supportedTypesJson: p.supportedTypesJson,
      extraJson: redact(p.extraJson),
      isEnabled: p.isEnabled,
      isBuiltIn: p.isBuiltIn,
      models: p.models.map((m) => ({
        category: m.category,
        name: m.name,
        modelKey: m.modelKey,
        description: m.description,
        capabilityJson: m.capabilityJson,
        defaultParamsJson: m.defaultParamsJson,
        sortOrder: m.sortOrder,
        isEnabled: m.isEnabled,
      })),
    })),
    legacyConfigs: legacyConfigs.map((c) => ({
      id: c.id,
      userId: c.userId,
      scene: c.scene,
      name: c.name,
      baseUrl: c.baseUrl,
      apiKeyHint: c.apiKeyHint,
      hasApiKey: Boolean(c.apiKeyEncrypted),
      defaultImageModel: c.defaultImageModel,
      defaultVideoModel: c.defaultVideoModel,
      extraJson: redact(c.extraJson),
      customModels: c.customModels.map((m) => ({
        category: m.category,
        label: m.label,
        modelKey: m.modelKey,
        capabilityJson: m.capabilityJson,
        defaultParamsJson: m.defaultParamsJson,
        isEnabled: m.isEnabled,
      })),
    })),
    usedModelsInHistory: usedModels,
    generationTypeCounts: typeCounts,
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
}

main()
  .catch((err) => {
    console.error('导出失败：', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
