import { useEffect, useState } from 'react'
import { RefreshCw, Puzzle } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { scanProjectSkills } from '../../api'
import type { Project, SkillInfo } from '../../types'

interface Props {
  project: Project
}

export function SkillsPanel({ project }: Props) {
  const updateProjectSkills = useAppStore((s) => s.updateProjectSkills)
  const [loading, setLoading] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null)

  const loadSkills = async () => {
    setLoading(true)
    try {
      const res = await scanProjectSkills(project.id)
      updateProjectSkills(project.id, res.skills)
    } catch (err) {
      console.error('Failed to load skills:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (project.skills.length === 0) {
      loadSkills()
    }
  }, [project.id])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-800">项目 Skills</h3>
        <button
          onClick={loadSkills}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {project.skills.length === 0 ? (
        <div className="text-center py-12">
          <Puzzle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            {loading ? '正在扫描项目 Skills...' : '未发现可用 Skills'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Skills 文件通常位于项目 .catpaw/skills/ 目录下
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {project.skills.map((skill) => (
            <div
              key={skill.name}
              onClick={() => setSelectedSkill(skill)}
              className={`p-4 bg-white border rounded-xl cursor-pointer transition-all ${
                selectedSkill?.name === skill.name
                  ? 'border-indigo-300 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-slate-800 truncate">{skill.name}</h4>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{skill.description}</p>
                </div>
                <Puzzle className="w-4 h-4 text-indigo-400 shrink-0 ml-2" />
              </div>
              {skill.triggers.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.triggers.slice(0, 4).map((t) => (
                    <span key={t} className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded">
                      {t}
                    </span>
                  ))}
                  {skill.triggers.length > 4 && (
                    <span className="text-[10px] text-slate-400">+{skill.triggers.length - 4}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Skill 详情 */}
      {selectedSkill && (
        <div className="mt-6 bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-800">{selectedSkill.name} 详情</h4>
            <button
              onClick={() => setSelectedSkill(null)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              关闭
            </button>
          </div>
          <p className="text-xs text-slate-600 mb-2">{selectedSkill.description}</p>
          <div className="text-xs text-slate-400 font-mono truncate">
            路径: {selectedSkill.path}
          </div>
        </div>
      )}
    </div>
  )
}
