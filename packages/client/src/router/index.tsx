import { lazy, Suspense } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { RouteLoadingFallback } from '../components/common/RouteLoadingFallback'

// ═══════════════ 路由级代码分割 ═══════════════
// 使用 React.lazy() 按需加载页面组件，将单 chunk 拆分为多个异步模块
// 首屏只加载 AppLayout + Sidebar，其余页面在导航时动态加载

const HomePage = lazy(() => import('../pages/HomePage'))
const ProjectPage = lazy(() => import('../pages/ProjectPage'))
const RunDetailPage = lazy(() => import('../pages/RunDetailPage'))
const ChangelogPage = lazy(() => import('../pages/ChangelogPage'))
const AboutPage = lazy(() => import('../pages/AboutPage'))
const ContextDBSysPage = lazy(() => import('../pages/ContextDBSysPage'))
const ContextDBL1Page = lazy(() => import('../pages/ContextDBL1Page'))

/**
 * 企业级路由配置
 *
 * 路由结构：
 *   /                                → 首页（欢迎页，引导选择项目）
 *   /projects/:projectId             → 重定向到默认 tab（runs）
 *   /projects/:projectId/:tab        → 项目详情（runs | workflow | skills | agents | settings）
 *   /projects/:projectId/runs/:runId → Run 详情页（DAG + 节点执行）
 *   /changelog                       → 更新日志
 *   /about                           → 项目介绍
 *
 * 设计原则：
 *   1. URL 即状态 — 刷新/分享链接可完整恢复视图
 *   2. 路由只管导航，业务数据由 Zustand Store 管理
 *   3. 嵌套布局：Layout 层负责侧边栏 + 全局初始化
 *   4. 代码分割：页面级组件使用 React.lazy 按需加载，减小首屏体积
 */

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
}

export const router = createHashRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        {
          index: true,
          element: <SuspenseWrapper><HomePage /></SuspenseWrapper>,
        },
        {
          path: 'projects/:projectId',
          element: <Navigate to="runs" replace />,
        },
        {
          path: 'projects/:projectId/:tab',
          element: <SuspenseWrapper><ProjectPage /></SuspenseWrapper>,
        },
        {
          path: 'projects/:projectId/runs/:runId',
          element: <SuspenseWrapper><RunDetailPage /></SuspenseWrapper>,
        },
        {
          path: 'changelog',
          element: <SuspenseWrapper><ChangelogPage /></SuspenseWrapper>,
        },
        {
          path: 'about',
          element: <SuspenseWrapper><AboutPage /></SuspenseWrapper>,
        },
        {
          path: 'context-db/sys',
          element: <SuspenseWrapper><ContextDBSysPage /></SuspenseWrapper>,
        },
        {
          path: 'context-db/l1',
          element: <SuspenseWrapper><ContextDBL1Page /></SuspenseWrapper>,
        },
      ],
    },
  ],
)
