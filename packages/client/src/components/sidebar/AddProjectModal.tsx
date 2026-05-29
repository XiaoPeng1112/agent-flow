import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Form, Input, App } from 'antd'
import { useAppStore } from '../../store/appStore'
import { projectApi } from '../../api'

interface Props {
  onClose: () => void
}

export function AddProjectModal({ onClose }: Props) {
  const navigate = useNavigate()
  const addProject = useAppStore((s) => s.addProject)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const { message } = App.useApp()

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      const res = await projectApi.create({
        name: values.name.trim(),
        path: values.path.trim(),
        description: values.description?.trim() || undefined,
      })
      const newProject = { ...res.project, skills: [], runs: [] }
      addProject(newProject)
      message.success('项目添加成功')
      onClose()
      navigate(`/projects/${newProject.id}/runs`)
    } catch (err: any) {
      if (err?.message) {
        message.error(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="添加本地项目"
      open={true}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="添加"
      cancelText="取消"
      confirmLoading={loading}
      width={480}
      centered
    >
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          name="name"
          label="项目名称"
          rules={[{ required: true, message: '请输入项目名称' }]}
        >
          <Input placeholder="如：my-react-app" autoFocus />
        </Form.Item>

        <Form.Item
          name="path"
          label="项目路径"
          rules={[{ required: true, message: '请输入项目路径' }]}
          extra="本地项目的绝对路径"
        >
          <Input placeholder="如：/Users/xxx/projects/my-app" className="font-mono" />
        </Form.Item>

        <Form.Item name="description" label="描述（可选）">
          <Input.TextArea placeholder="项目简要描述..." rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
