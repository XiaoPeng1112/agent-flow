import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

/**
 * GitHub 用户信息
 */
export interface GitHubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string
  html_url: string
  email: string | null
  bio: string | null
  public_repos: number
  followers: number
  following: number
}

/**
 * GitHub 仓库信息
 */
export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  description: string | null
  html_url: string
  clone_url: string
  ssh_url: string
  language: string | null
  stargazers_count: number
  updated_at: string
  private: boolean
  default_branch: string
}

/**
 * 认证会话数据
 */
interface AuthSession {
  accessToken: string
  user: GitHubUser
  loginAt: number
}

/**
 * GitHub OAuth 认证服务
 *
 * 支持：
 *   1. GitHub OAuth App 授权流程
 *   2. 用户信息持久化
 *   3. 访问 GitHub API（repos、user info）
 */
export class AuthService {
  private session: AuthSession | null = null
  private storagePath: string

  // GitHub OAuth App 配置（可通过环境变量覆盖）
  private clientId: string
  private clientSecret: string

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'auth.json')
    this.clientId = process.env.GITHUB_CLIENT_ID || ''
    this.clientSecret = process.env.GITHUB_CLIENT_SECRET || ''
  }

  /** 获取 GitHub OAuth 授权 URL */
  getAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email repo',
      state: `agentflow_${Date.now()}`,
    })
    return `https://github.com/login/oauth/authorize?${params.toString()}`
  }

  /** 用授权码换取 access_token */
  async exchangeCode(code: string): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    })
    const data = await res.json() as any
    if (data.error) {
      throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`)
    }
    return data.access_token
  }

  /** 获取 GitHub 用户信息 */
  async fetchUser(accessToken: string): Promise<GitHubUser> {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
    if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`)
    return res.json() as Promise<GitHubUser>
  }

  /** 获取用户的仓库列表 */
  async fetchRepos(accessToken?: string): Promise<GitHubRepo[]> {
    const token = accessToken || this.session?.accessToken
    if (!token) throw new Error('Not authenticated')

    const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=50', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
    if (!res.ok) throw new Error(`Failed to fetch repos: ${res.status}`)
    return res.json() as Promise<GitHubRepo[]>
  }

  /** 完成登录：保存 session */
  async login(accessToken: string): Promise<GitHubUser> {
    const user = await this.fetchUser(accessToken)
    this.session = {
      accessToken,
      user,
      loginAt: Date.now(),
    }
    await this.save()
    return user
  }

  /** 登出 */
  async logout(): Promise<void> {
    this.session = null
    await this.save()
  }

  /** 获取当前登录用户 */
  getCurrentUser(): (GitHubUser & { loginAt: number }) | null {
    if (!this.session) return null
    return { ...this.session.user, loginAt: this.session.loginAt }
  }

  /** 是否已登录 */
  isAuthenticated(): boolean {
    return this.session !== null
  }

  /** 获取 access token（内部使用） */
  getAccessToken(): string | null {
    return this.session?.accessToken || null
  }

  /** 检查 OAuth 配置是否完整 */
  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret)
  }

  /** 加载持久化的会话 */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storagePath, 'utf-8')
      this.session = JSON.parse(raw)
    } catch {
      this.session = null
    }
  }

  /** 持久化会话 */
  private async save(): Promise<void> {
    const dir = this.storagePath.replace(/\/[^/]+$/, '')
    await mkdir(dir, { recursive: true })
    if (this.session) {
      await writeFile(this.storagePath, JSON.stringify(this.session, null, 2), 'utf-8')
    } else {
      await writeFile(this.storagePath, 'null', 'utf-8')
    }
  }
}
