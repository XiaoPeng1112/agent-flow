import { create } from 'zustand'
import type { Project, AgentConfig, SkillInfo, TaskRecord, WorkflowTemplate, ProjectTab } from '../types'

// ===== 默认工作流模板 =====
const defaultWorkflowTemplates: WorkflowTemplate[] = [
  {
    id: 'fullstack-flow',
    name: '全栈开发流程',
    description: '从需求到交付的完整开发闭环',
    steps: [
      { id: 's1', name: '需求分析', type: 'requirement', description: '分析和明确需求细节' },
      { id: 's2', name: 'PRD 编写', type: 'prd', description: '生成产品需求文档' },
      { id: 's3', name: '设计方案', type: 'design', description: '技术架构与设计' },
      { id: 's4', name: 'UI 实现', type: 'ui', description: '界面设计与样式实现' },
      { id: 's5', name: '功能开发', type: 'development', description: '核心功能代码实现' },
      { id: 's6', name: '问题修复', type: 'bugfix', description: '缺陷修复与代码优化' },
      { id: 's7', name: '测试验收', type: 'testing', description: '自动化测试与验收' },
    ],
  },
  {
    id: 'quick-feature',
    name: '快速功能迭代',
    description: '适用于小功能快速开发',
    steps: [
      { id: 's1', name: '需求描述', type: 'requirement', description: '简要需求说明' },
      { id: 's2', name: '代码实现', type: 'development', description: '直接编码实现' },
      { id: 's3', name: '测试修复', type: 'testing', description: '测试并修复问题' },
    ],
  },
  {
    id: 'bug-fix-flow',
    name: 'Bug 修复流程',
    description: '定位问题并修复',
    steps: [
      { id: 's1', name: '问题分析', type: 'requirement', description: '复现并分析问题根因' },
      { id: 's2', name: '修复实现', type: 'bugfix', description: '编写修复代码' },
      { id: 's3', name: '回归验证', type: 'testing', description: '验证修复无回归' },
    ],
  },
]

// ===== Store 接口 =====
interface AppState {
  // 项目管理
  projects: Project[]
  selectedProjectId: string | null
  activeTab: ProjectTab

  // Agent 列表
  agents: AgentConfig[]

  // 全局任务历史
  tasks: TaskRecord[]

  // 工作流模板
  workflowTemplates: WorkflowTemplate[]

  // 全局 UI 状态
  showTaskLog: boolean
  taskLogContent: string[]

  // Actions - 项目
  addProject: (project: Omit<Project, 'id' | 'createdAt' | 'lastActiveAt' | 'skills'>) => void
  removeProject: (id: string) => void
  selectProject: (id: string | null) => void
  updateProjectSkills: (projectId: string, skills: SkillInfo[]) => void

  // Actions - Tab
  setActiveTab: (tab: ProjectTab) => void

  // Actions - 任务
  addTask: (task: TaskRecord) => void
  updateTask: (taskId: string, updates: Partial<TaskRecord>) => void

  // Actions - 工作流模板
  addWorkflowTemplate: (template: WorkflowTemplate) => void
  removeWorkflowTemplate: (id: string) => void

  // Actions - UI
  toggleTaskLog: () => void
  appendTaskLog: (line: string) => void
  clearTaskLog: () => void

  // Actions - 数据加载
  setAgents: (agents: AgentConfig[]) => void
  setProjects: (projects: Project[]) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // 初始状态
  projects: [],
  selectedProjectId: null,
  activeTab: 'workflow',
  agents: [],
  tasks: [],
  workflowTemplates: defaultWorkflowTemplates,
  showTaskLog: false,
  taskLogContent: [],

  // 项目操作
  addProject: (data) => {
    const project: Project = {
      ...data,
      id: `proj_${Date.now()}`,
      skills: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    set({ projects: [...get().projects, project] })
  },

  removeProject: (id) => {
    const { projects, selectedProjectId } = get()
    set({
      projects: projects.filter((p) => p.id !== id),
      selectedProjectId: selectedProjectId === id ? null : selectedProjectId,
    })
  },

  selectProject: (id) => {
    set({ selectedProjectId: id, activeTab: 'workflow' })
    if (id) {
      // 更新 lastActiveAt
      const projects = get().projects.map((p) =>
        p.id === id ? { ...p, lastActiveAt: Date.now() } : p
      )
      set({ projects })
    }
  },

  updateProjectSkills: (projectId, skills) => {
    set({
      projects: get().projects.map((p) =>
        p.id === projectId ? { ...p, skills } : p
      ),
    })
  },

  // Tab
  setActiveTab: (tab) => set({ activeTab: tab }),

  // 任务
  addTask: (task) => set({ tasks: [task, ...get().tasks] }),

  updateTask: (taskId, updates) => {
    set({
      tasks: get().tasks.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      ),
    })
  },

  // 工作流模板
  addWorkflowTemplate: (template) => {
    set({ workflowTemplates: [...get().workflowTemplates, template] })
  },

  removeWorkflowTemplate: (id) => {
    set({ workflowTemplates: get().workflowTemplates.filter((t) => t.id !== id) })
  },

  // UI
  toggleTaskLog: () => set({ showTaskLog: !get().showTaskLog }),
  appendTaskLog: (line) => set({ taskLogContent: [...get().taskLogContent, line] }),
  clearTaskLog: () => set({ taskLogContent: [] }),

  // 数据加载
  setAgents: (agents) => set({ agents }),
  setProjects: (projects) => set({ projects }),
}))
