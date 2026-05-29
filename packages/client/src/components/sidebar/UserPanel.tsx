import { useState, useEffect } from 'react'
import { Dropdown, Avatar, Spin } from 'antd'
import {
  GithubOutlined,
  LogoutOutlined,
  UserOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { authApi } from '../../api'

interface GitHubUser {
  login: string
  name: string | null
  avatar_url: string
  html_url: string
  public_repos: number
}

/**
 * 用户面板 — 显示在 Sidebar 底部
 *
 * 未登录：显示 GitHub 登录按钮
 * 已登录：显示用户头像和名称，下拉菜单可查看详情/登出
 */
export function UserPanel() {
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi.me()
      .then((res) => {
        if (res.authenticated && res.user) {
          setUser(res.user)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // 处理 OAuth 回调（页面加载时检查 hash 中是否有 auth 成功标记）
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('auth=success')) {
      // 清理 hash 并重新获取用户信息
      window.history.replaceState(null, '', window.location.pathname)
      authApi.me().then((res) => {
        if (res.authenticated && res.user) {
          setUser(res.user)
        }
      })
    }
  }, [])

  const handleLogin = async () => {
    try {
      const { url } = await authApi.getAuthUrl()
      window.location.href = url
    } catch (err) {
      console.error('Failed to get auth URL:', err)
    }
  }

  const handleLogout = async () => {
    await authApi.logout()
    setUser(null)
  }

  if (loading) {
    return (
      <div className="px-4 py-2 flex items-center justify-center">
        <Spin size="small" />
      </div>
    )
  }

  if (!user) {
    return (
      <button
        onClick={handleLogin}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
      >
        <GithubOutlined className="text-[15px]" />
        <span>GitHub 登录</span>
      </button>
    )
  }

  const menuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <a href={user.html_url} target="_blank" rel="noopener noreferrer">
          {user.login} · {user.public_repos} repos
        </a>
      ),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: handleLogout,
    },
  ]

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="topLeft">
      <button className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-slate-300 hover:bg-white/5 rounded-lg transition-colors cursor-pointer">
        <Avatar src={user.avatar_url} size={22} className="!border !border-white/20" />
        <span className="truncate flex-1 text-left">{user.name || user.login}</span>
        <SyncOutlined className="text-[10px] text-slate-500" />
      </button>
    </Dropdown>
  )
}
