import type { Project } from '../../types'

interface Props {
  project: Project
}

export function SettingsPanel({ project }: Props) {
  return (
    <div className="p-6">
      <h3 className="text-base font-semibold text-slate-800 mb-4">项目设置</h3>
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">项目名称</label>
          <input
            type="text"
            defaultValue={project.name}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            readOnly
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">项目路径</label>
          <input
            type="text"
            defaultValue={project.path}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono bg-slate-50"
            readOnly
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
          <textarea
            defaultValue={project.description || ''}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            readOnly
          />
        </div>
        <div className="pt-2 border-t border-slate-100">
          <p className="text-xs text-slate-400">
            创建时间: {new Date(project.createdAt).toLocaleString()} · 
            最近活跃: {new Date(project.lastActiveAt).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}
