import { useEffect, useState } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useAppStore } from '../store/appStore'
import { RunDetail } from '../components/detail/RunDetail'
import { TaskLogBar } from '../components/detail/TaskLogBar'
import { runApi } from '../api'
import { loadProjectRuns } from '../api/load-project-runs'

/**
 * Run 详情页
 *
 * URL: /projects/:projectId/runs/:runId
 * 独立路由页面，可直接通过 URL 访问特定 Run。
 */
export function RunDetailPage() {
  const { projectId, runId } = useParams<{ projectId: string; runId: string }>()
  const navigate = useNavigate()
  const runs = useAppStore((s) => s.runs)
  const mergeProjectRuns = useAppStore((s) => s.mergeProjectRuns)
  const projects = useAppStore((s) => s.projects)

  const project = projects.find((p) => p.id === projectId)
  const run = runs.find((r) => r.id === runId)
  const [loadedKey, setLoadedKey] = useState('')
  const [loadError, setLoadError] = useState('')
  const loadKey = `${projectId}/${runId}`

  // 如果 runs 为空（刷新后尚未加载），主动获取
  useEffect(() => {
    let disposed = false
    if (projectId && !run) {
      loadProjectRuns(() => runApi.list(projectId), () => useAppStore.getState().runStateVersion,
        (runs, version) => mergeProjectRuns(projectId, runs, version), () => disposed)
        .then(() => {
          if (!disposed) { setLoadedKey(loadKey); setLoadError('') }
        })
        .catch(error => { if (!disposed) { setLoadError(error.message); setLoadedKey(loadKey) } })
    }
    return () => { disposed = true }
  }, [projectId, run, loadKey, mergeProjectRuns])

  // 项目列表未加载完成
  if (projects.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-400">加载中...</div>
      </div>
    )
  }

  // 项目不存在
  if (!project) {
    return <Navigate to="/" replace />
  }

  // Run 尚未加载
  if (!run && loadedKey !== loadKey) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-400">加载中...</div>
      </div>
    )
  }

  // Run 不存在
  if (!run && loadError) return <div role="alert" className="p-6">加载任务失败：{loadError}</div>
  if (!run) {
    return <Navigate to={`/projects/${projectId}/runs`} replace />
  }

  const handleBack = () => {
    navigate(`/projects/${projectId}/runs`)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-[#f5f6fa]">
        <RunDetail run={run} onBack={handleBack} />
      </div>
      <TaskLogBar />
    </div>
  )
}

export default RunDetailPage
