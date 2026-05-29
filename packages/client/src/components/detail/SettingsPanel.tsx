import { useState } from 'react'
import { Card, Form, Input, Button, Divider, App } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { projectApi } from '../../api'
import { useAppStore } from '../../store/appStore'
import type { Project } from '../../types'

interface Props {
  project: Project
}

export function SettingsPanel({ project }: Props) {
  const [saving, setSaving] = useState(false)
  const setProjects = useAppStore((s) => s.setProjects)
  const projects = useAppStore((s) => s.projects)
  const { message } = App.useApp()
  const [form] = Form.useForm()

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = form.getFieldsValue()
      const res = await projectApi.update(project.id, {
        name: values.name,
        description: values.description,
        contextConfig: {
          product: values.product,
          technical: values.technical,
          repoUrl: values.repoUrl,
        },
      })
      setProjects(projects.map((p) =>
        p.id === project.id ? { ...p, ...res.project } : p
      ))
      message.success('设置已保存')
    } catch (err: any) {
      message.error(`保存失败: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h3 className="text-[15px] font-semibold text-gray-900 mb-5">项目设置</h3>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: project.name,
          description: project.description || '',
          path: project.path,
          product: project.contextConfig?.product || '',
          technical: project.contextConfig?.technical || '',
          repoUrl: project.contextConfig?.repoUrl || '',
        }}
      >
        {/* 基本信息 */}
        <Card
          title="基本信息"
          className="!mb-5 !border-gray-100 !shadow-sm"
          styles={{ header: { borderBottom: '1px solid #f3f4f6' }, body: { padding: '20px 24px' } }}
        >
          <Form.Item name="name" label="项目名称">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="项目简要描述" />
          </Form.Item>
          <Form.Item name="path" label="本地路径">
            <Input disabled className="!bg-gray-50 font-mono !text-gray-500" />
          </Form.Item>
        </Card>

        {/* 上下文配置 */}
        <Card
          title="上下文配置"
          className="!mb-5 !border-gray-100 !shadow-sm"
          styles={{ header: { borderBottom: '1px solid #f3f4f6' }, body: { padding: '20px 24px' } }}
          extra={
            <span className="text-[11px] text-gray-400">参考 MAF 三维上下文切分</span>
          }
        >
          <Form.Item
            name="product"
            label="产品上下文"
            extra="描述项目的产品目标、业务背景、用户场景"
          >
            <Input.TextArea rows={3} placeholder="例如：这是一个面向开发者的 AI 工作流管理平台..." />
          </Form.Item>
          <Form.Item
            name="technical"
            label="技术上下文"
            extra="描述技术栈、架构模式、关键约束"
          >
            <Input.TextArea rows={3} placeholder="例如：React + TypeScript + Vite, 后端 Express + WS..." />
          </Form.Item>
          <Form.Item
            name="repoUrl"
            label="仓库地址"
          >
            <Input placeholder="https://github.com/..." className="font-mono" />
          </Form.Item>
        </Card>

        <Divider className="!my-4" />

        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          size="large"
        >
          保存设置
        </Button>
      </Form>
    </div>
  )
}
