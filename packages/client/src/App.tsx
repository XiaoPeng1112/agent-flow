import { useEffect } from 'react'
import { ProjectList } from './components/sidebar/ProjectList'
import { ProjectDetail } from './components/detail/ProjectDetail'
import { useAppStore } from './store/appStore'
import { fetchAgents } from './api'

function App() {
  const setAgents = useAppStore((s) => s.setAgents)

  // 初始化：加载 Agent 列表
  useEffect(() => {
    fetchAgents()
      .then((res) => setAgents(res.agents))
      .catch((err) => console.error('Failed to load agents:', err))
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      {/* 左侧项目列表 */}
      <ProjectList />

      {/* 右侧项目详情 */}
      <ProjectDetail />
    </div>
  )
}

export default App
