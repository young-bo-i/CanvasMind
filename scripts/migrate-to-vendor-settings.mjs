/**
 * Phase E 数据迁移：把旧 AiProvider 的 API 密钥迁进新的 VendorSetting 表（按管理员作用域）。
 *
 * 只迁「密钥」，不迁旧定价——因为定价已统一改为内置目录的 60% 加价（builtin-catalog），
 * 各管理员起步都用内置默认价，日后可在后台按 VendorSetting.pricingJson 各自微调。
 *
 * 密钥直接复制密文（apiKeyEncrypted）：新旧用同一把 PROVIDER_CONFIG_SECRET，无需重加密。
 * 厂商映射：baseUrl/code 含 cometapi → 'cometapi'；含 chengmeng → 'chengmeng'。
 *
 * 幂等：同一 (ownerAdminId, vendorCode) 已存在则更新，否则新建（全局桶 NULL 先查后写）。
 * 安全：只读旧表 + 只写 vendor_settings，不动任何账号/积分/生成/资产数据。
 *
 * 运行（部署时，容器内）：
 *   node scripts/migrate-to-vendor-settings.mjs
 * 干跑（只打印不写库）：
 *   node scripts/migrate-to-vendor-settings.mjs --dry
 */
import prismaClientPackage from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

const { PrismaClient } = prismaClientPackage
const DRY = process.argv.includes('--dry')

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('缺少 DATABASE_URL')
  process.exit(1)
}
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl), log: ['error'] })

const resolveVendorCode = (provider) => {
  const hay = `${provider.code || ''} ${provider.baseUrl || ''}`.toLowerCase()
  if (hay.includes('cometapi')) return 'cometapi'
  if (hay.includes('chengmeng')) return 'chengmeng'
  return null
}

const main = async () => {
  const providers = await prisma.aiProvider.findMany({
    select: { id: true, code: true, name: true, baseUrl: true, ownerAdminId: true, apiKeyEncrypted: true, apiKeyHint: true, isEnabled: true },
  })

  // 每个 (scope, vendorCode) 选一条：优先 isEnabled 且有 key 的。
  const picked = new Map() // key = `${scope||'null'}::${vendorCode}`
  for (const p of providers) {
    const vendorCode = resolveVendorCode(p)
    if (!vendorCode || !p.apiKeyEncrypted) continue
    const scope = p.ownerAdminId || null
    const mapKey = `${scope || 'null'}::${vendorCode}`
    const prev = picked.get(mapKey)
    if (!prev || (p.isEnabled && !prev.isEnabled)) picked.set(mapKey, { scope, vendorCode, provider: p })
  }

  const results = []
  for (const { scope, vendorCode, provider } of picked.values()) {
    const data = {
      apiKeyEncrypted: provider.apiKeyEncrypted,
      apiKeyHint: provider.apiKeyHint,
      isEnabled: true,
    }
    let action = 'create'
    if (!DRY) {
      // 全局桶(scope=null)复合唯一不去重，先查后写。
      const existing = await prisma.vendorSetting.findFirst({
        where: { ownerAdminId: scope, vendorCode },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
      if (existing) { await prisma.vendorSetting.update({ where: { id: existing.id }, data }); action = 'update' }
      else await prisma.vendorSetting.create({ data: { ownerAdminId: scope, vendorCode, ...data } })
    }
    results.push({ scope: scope || '(global)', vendorCode, from: provider.code, hint: provider.apiKeyHint, action })
  }

  // 覆盖检查：列出「有作用域但缺某厂商 key」的情况（如某普管没配 chengmeng → 视频不可用）。
  const admins = await prisma.appUser.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } }, select: { id: true, username: true, role: true } })
  const scopes = [{ id: null, name: '(global/super-admin)' }, ...admins.filter(a => a.role === 'ADMIN').map(a => ({ id: a.id, name: a.username }))]
  const gaps = []
  for (const s of scopes) {
    for (const vendorCode of ['cometapi', 'chengmeng']) {
      if (!picked.has(`${s.id || 'null'}::${vendorCode}`)) gaps.push(`${s.name} 缺 ${vendorCode} 密钥`)
    }
  }

  console.log(JSON.stringify({ dryRun: DRY, migrated: results, gaps }, null, 2))
  if (gaps.length) console.error('\n⚠️ 覆盖缺口(这些作用域该厂商无密钥，对应功能需管理员在后台补填)：\n - ' + gaps.join('\n - '))
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
