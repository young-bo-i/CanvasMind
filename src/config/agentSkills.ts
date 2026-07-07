import { buildApiUrl } from '@/api/http'
import { readApiData } from '@/api/response'
import {
  applyPublicSkillCatalog,
  buildAgentChatMessages,
  buildAgentWorkflowStrategy,
  getAgentSkillCatalogItem,
  getAgentSkillConfig,
  isAgentWorkspaceSkill,
  listEnabledAgentSkills,
  type AgentSkillConfig,
  type AgentSkillKey,
  type AgentWorkflowStrategy,
  type PublicAgentSkillCatalogItem,
} from '@/shared/agent-skills-core'

export {
  applyPublicSkillCatalog,
  buildAgentChatMessages,
  buildAgentWorkflowStrategy,
  getAgentSkillCatalogItem,
  getAgentSkillConfig,
  isAgentWorkspaceSkill,
  listEnabledAgentSkills,
}

export type {
  AgentSkillConfig,
  AgentSkillKey,
  AgentWorkflowStrategy,
  PublicAgentSkillCatalogItem,
}

const AGENT_SKILL_CATALOG_API_PATH = '/api/skill-config/catalog'
let publicSkillCatalogPromise: Promise<PublicAgentSkillCatalogItem[]> | null = null
// 内存 TTL：技能目录在生成页 mount + Promise.all + AgentToolbar 多处调用，60s 内非 force 复用。
let skillCatalogLoadedAt = 0
let lastSkillCatalog: PublicAgentSkillCatalogItem[] = []
const SKILL_CATALOG_TTL_MS = 60_000

export const loadPublicSkillCatalog = async (force = false) => {
  if (!force && publicSkillCatalogPromise) {
    return publicSkillCatalogPromise
  }
  if (!force && skillCatalogLoadedAt && Date.now() - skillCatalogLoadedAt < SKILL_CATALOG_TTL_MS) {
    return lastSkillCatalog
  }

  publicSkillCatalogPromise = fetch(buildApiUrl(AGENT_SKILL_CATALOG_API_PATH), {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })
    .then(response => readApiData<PublicAgentSkillCatalogItem[]>(response, { showErrorMessage: false }))
    .then((data) => {
      skillCatalogLoadedAt = Date.now()
      lastSkillCatalog = applyPublicSkillCatalog(data)
      return lastSkillCatalog
    })
    .catch(() => applyPublicSkillCatalog([]))
    .finally(() => {
      publicSkillCatalogPromise = null
    })

  return publicSkillCatalogPromise
}
