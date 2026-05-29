import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../sidebar/Sidebar'
import { useAppStore } from '../../store/appStore'
import { projectApi, agentApi, templateApi, createWebSocket } from '../../api'

/**
 * 应用根布局
 *
 * 职责：
 *   1. 初始化全局数据（项目列表、Agent 状态、工作流模板）
 *   2. 建立 WebSocket 连接
 *   3. 提供 Sidebar + 内容区布局结构
 *   4. Outlet 渲染子路由页面
 */
export function AppLayout() {
  const setAgents = useAppStore((s) => s.setAgents)
  const setProjects = useAppStore((s) => s.setProjects)
  const setTemplates = useAppStore((s) => s.setTemplates)
  const handleWsMessage = useAppStore((s) => s.handleWsMessage)

  useEffect(() => {
    // 并行加载全局初始化数据
    Promise.all([
      agentApi.getStatus().then((res) => setAgents(res.agents)),
      projectApi.list().then((res) =>
        setProjects(res.projects.map((p: any) => ({ ...p, skills: [], runs: [] })))
      ),
      templateApi.list().then((res) => setTemplates(res.templates)),
    ]).catch((err) => console.error('Failed to load initial data:', err))

    // WebSocket 实时通信
    const ws = createWebSocket(handleWsMessage)
    return () => { ws.close() }
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* 深色侧边栏 */}
      <Sidebar />

      {/* 右侧内容区 — 由 Outlet 渲染当前路由页面 */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#f5f6fa]">
        <Outlet />
      </main>
    </div>
  )
}
