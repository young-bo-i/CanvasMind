import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useSystemInitStore } from '../stores/system-init'
import { useLoadingStore } from '../stores/loading'

// 核心页面懒加载，避免全部进入主 bundle 拖慢首屏
const Home = () => import('../views/home/home.vue')
const Generate = () => import('../views/generate/generate.vue')
const AccountManagement = () => import('../views/account/AccountManagement.vue')
const PublishCenter = () => import('../views/publish/PublishCenter.vue')
const AssetManagement = () => import('../views/asset/AssetManagement.vue')
const Install = () => import('../views/install/InstallView.vue')
const PolicyDetail = () => import('../views/policies/PolicyDetail.vue')
const AdminLayout = () => import('../components/admin/layout/AdminLayout.vue')
const AdminDashboard = () => import('../views/admin/dashboard/AdminDashboard.vue')
const AdminAssets = () => import('../views/admin/assets/AdminAssets.vue')
const AdminConversations = () => import('../views/admin/conversations/AdminConversations.vue')
const AdminConversationSettings = () => import('../views/admin/conversations/AdminConversationSettings.vue')
const AdminGenerations = () => import('../views/admin/generations/AdminGenerations.vue')
const AdminMarketing = () => import('../views/admin/marketing/AdminMarketing.vue')
const AdminSkills = () => import('../views/admin/skills/AdminSkills.vue')
const AdminProviders = () => import('../views/admin/providers/AdminProviders.vue')
const AdminStorage = () => import('../views/admin/storage/AdminStorage.vue')
const AdminSystem = () => import('../views/admin/system/AdminSystem.vue')
const AdminRedis = () => import('../views/admin/redis/AdminRedis.vue')
const AdminTheme = () => import('../views/admin/theme/AdminTheme.vue')
const AdminUsers = () => import('../views/admin/users/AdminUsers.vue')
const AdminAuditLogs = () => import('../views/admin/audit/AdminAuditLogs.vue')
const AdminAccessDenied = () => import('../views/admin/AdminAccessDenied.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/install',
    name: 'Install',
    component: Install,
  },
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: {
      mobileTitle: '首页',
    },
  },
  {
    path: '/generate',
    name: 'Generate',
    component: Generate,
    meta: {
      mobileTitle: '创作',
    },
  },
  {
    path: '/account',
    name: 'AccountManagement',
    component: AccountManagement,
    meta: {
      requiresAuth: true,
      mobileTitle: '我的',
    },
  },
  {
    path: '/publish',
    name: 'PublishCenter',
    component: PublishCenter,
    meta: {
      mobileTitle: '发布',
    },
  },
  {
    path: '/asset',
    name: 'AssetManagement',
    component: AssetManagement,
    meta: {
      mobileTitle: '作品',
    },
  },
  {
    path: '/policies/:type',
    name: 'PolicyDetail',
    component: PolicyDetail,
  },
  {
    path: '/admin-forbidden',
    name: 'AdminAccessDenied',
    component: AdminAccessDenied,
    meta: {
      requiresAuth: true,
    },
  },
  {
    path: '/admin',
    component: AdminLayout,
    meta: {
      requiresAuth: true,
    },
    children: [
      {
        path: '',
        redirect: '/admin/dashboard',
      },
      {
        path: 'dashboard',
        name: 'AdminDashboard',
        component: AdminDashboard,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'assets',
        name: 'AdminAssets',
        component: AdminAssets,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'conversations',
        name: 'AdminConversations',
        component: AdminConversations,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'conversations/settings',
        name: 'AdminConversationSettings',
        component: AdminConversationSettings,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'generations',
        name: 'AdminGenerations',
        component: AdminGenerations,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'publish',
        redirect: '/admin/assets',
      },

      {
        path: 'marketing',
        name: 'AdminMarketing',
        component: AdminMarketing,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'skills',
        name: 'AdminSkills',
        component: AdminSkills,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'providers',
        name: 'AdminProviders',
        component: AdminProviders,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'models',
        redirect: '/admin/providers',
      },
      {
        path: 'storage',
        name: 'AdminStorage',
        component: AdminStorage,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'users',
        name: 'AdminUsers',
        component: AdminUsers,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'system',
        name: 'AdminSystem',
        component: AdminSystem,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'redis',
        name: 'AdminRedis',
        component: AdminRedis,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'audit-logs',
        name: 'AdminAuditLogs',
        component: AdminAuditLogs,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
      {
        path: 'layout',
        name: 'AdminLayout',
        component: AdminSystem,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
          defaultSystemTab: 'layout',
        },
      },
      {
        path: 'theme',
        name: 'AdminTheme',
        component: AdminTheme,
        meta: {
          requiresAuth: true,
          requiresAdmin: true,
        },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 性能(P1-5)：缓存“系统已初始化”标志。返回访客冷加载时据此乐观放行，
// 不再 await 后端 getSystemInitStatus 往返才允许首帧渲染（首帧少一个 RTT，通常 100-500ms）。
const SYSTEM_INITIALIZED_FLAG_KEY = 'canvasmind_system_initialized'
const readCachedInitialized = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SYSTEM_INITIALIZED_FLAG_KEY) === '1'
  } catch {
    return false
  }
}
const writeCachedInitialized = (value: boolean) => {
  try {
    if (typeof localStorage === 'undefined') return
    if (value) localStorage.setItem(SYSTEM_INITIALIZED_FLAG_KEY, '1')
    else localStorage.removeItem(SYSTEM_INITIALIZED_FLAG_KEY)
  } catch {
    // 忽略隐私模式下 localStorage 不可用。
  }
}

// 对需要登录的页面做统一拦截，未登录时回到首页显示登录入口。
router.beforeEach(async (to) => {
  // 路由切换开启全局进度条
  useLoadingStore().start('route')

  const systemInitStore = useSystemInitStore()
  const statusKnown = systemInitStore.systemInitInitialized.value && !systemInitStore.systemInitLoading.value
  if (!statusKnown) {
    if (readCachedInitialized()) {
      // 曾确认已初始化 → 后台拉状态、乐观放行（不阻塞首帧）；若发现实际未初始化则清缓存，下次冷加载会回到等待+跳转。
      void systemInitStore.loadStatus().then(() => {
        if (systemInitStore.systemInitInitialized.value && !systemInitStore.isInitialized.value) {
          writeCachedInitialized(false)
        }
      })
    } else {
      // 未知 / 从未初始化：必须等状态确定，否则未初始化系统会闪一下首页再跳转。
      await systemInitStore.loadStatus()
    }
  }

  // 仅在状态已确定时才据此重定向；乐观放行且状态尚未回来时跳过(此次按已初始化处理，后续导航会纠正)。
  const statusResolved = systemInitStore.systemInitInitialized.value && !systemInitStore.systemInitLoading.value
  if (statusResolved) {
    if (!systemInitStore.isInitialized.value && to.path !== '/install') {
      return {
        path: '/install',
        query: to.fullPath && to.fullPath !== '/install'
          ? { redirect: to.fullPath }
          : undefined,
      }
    }
    if (systemInitStore.isInitialized.value) {
      writeCachedInitialized(true)
    }
  }

  if (systemInitStore.isInitialized.value && to.path === '/install') {
    return {
      path: '/',
    }
  }

  if (!to.meta?.requiresAuth) {
    return true
  }

  const authStore = useAuthStore()
  if (!authStore.sessionInitialized.value && !authStore.sessionLoading.value) {
    await authStore.loadSession()
  }

  if (authStore.sessionLoading.value) {
    await authStore.loadSession()
  }

  if (!authStore.isLoggedIn.value) {
    return {
      path: '/',
      query: {
        login: '1',
      },
    }
  }

  if (to.meta?.requiresAdmin && !authStore.isAdmin.value) {
    return {
      path: '/admin-forbidden',
    }
  }

  return true
})

// 路由结束/失败时关闭进度条
router.afterEach(() => {
  useLoadingStore().stop('route')
})

router.onError(() => {
  useLoadingStore().stop('route')
})

export default router
