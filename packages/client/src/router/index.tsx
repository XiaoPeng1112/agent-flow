import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { HomePage } from '../pages/HomePage'
import { ProjectPage } from '../pages/ProjectPage'
import { RunDetailPage } from '../pages/RunDetailPage'
import { ChangelogPage } from '../pages/ChangelogPage'
import { AboutPage } from '../pages/AboutPage'

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
 */
export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        {
          index: true,
          element: <HomePage />,
        },
        {
          path: 'projects/:projectId',
          element: <Navigate to="runs" replace />,
        },
        {
          path: 'projects/:projectId/:tab',
          element: <ProjectPage />,
        },
        {
          path: 'projects/:projectId/runs/:runId',
          element: <RunDetailPage />,
        },
        {
          path: 'changelog',
          element: <ChangelogPage />,
        },
        {
          path: 'about',
          element: <AboutPage />,
        },
      ],
    },
  ],
  {
    basename: '/agent-flow',
  }
)
