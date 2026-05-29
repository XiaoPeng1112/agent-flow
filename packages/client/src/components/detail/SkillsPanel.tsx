import { useState, useEffect } from 'react'
import { Card, Tag, Empty, Button, Spin } from 'antd'
import {
  ReloadOutlined,
  AppstoreOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { projectApi } from '../../api'
import type { Project, SkillInfo } from '../../types'

interface Props {
  project: Project
}

export function SkillsPanel({ project }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false)

  const loadSkills = async () => {
    setLoading(true)
    try {
      const res = await projectApi.getSkills(project.id)
      setSkills(res.skills)
    } catch (err) {
      console.error('Failed to load skills:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSkills()
  }, [project.id])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900">项目 Skills</h3>
          <p className="text-[12px] text-gray-400 mt-0.5">
            扫描项目目录下的 .catpaw/skills 和全局 Skills
          </p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={loadSkills}
        >
          刷新
        </Button>
      </div>

      <Spin spinning={loading}>
        {skills.length === 0 && !loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span className="text-gray-400">
                未发现 Skills，确保项目路径下存在 .catpaw/skills/ 目录
              </span>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {skills.map((skill) => (
              <Card
                key={skill.id || skill.name}
                className="!border-gray-200 hover:!border-indigo-300 transition-all !bg-white"
                styles={{ body: { padding: '16px 20px' } }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center shrink-0">
                    <AppstoreOutlined className="text-indigo-500 text-[16px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13px] font-medium text-gray-800 mb-1">{skill.name}</h4>
                    <p className="text-[11px] text-gray-400 line-clamp-2 mb-2">{skill.description}</p>
                    {skill.triggers.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {skill.triggers.slice(0, 3).map((trigger) => (
                          <Tag
                            key={trigger}
                            icon={<ThunderboltOutlined />}
                            className="!text-[10px] !m-0 !bg-blue-50 !border-blue-100 !text-blue-600"
                          >
                            {trigger}
                          </Tag>
                        ))}
                        {skill.triggers.length > 3 && (
                          <Tag className="!text-[10px] !m-0">
                            +{skill.triggers.length - 3}
                          </Tag>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Spin>
    </div>
  )
}
