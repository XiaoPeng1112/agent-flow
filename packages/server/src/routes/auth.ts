import { Router } from 'express'
import type { AuthService } from '../services/auth.js'

export function createAuthRouter(deps: {
  authService: AuthService
}): Router {
  const router = Router()
  const { authService } = deps

  /** 获取 GitHub OAuth 授权地址 */
  router.get('/github', (req, res) => {
    const host = req.headers.host || 'localhost:3001'
    const protocol = req.headers['x-forwarded-proto'] || 'http'
    const redirectUri = `${protocol}://${host}/api/auth/callback`
    const url = authService.getAuthUrl(redirectUri)
    res.json({ success: true, data: { url, configured: authService.isConfigured() } })
  })

  /** GitHub OAuth 回调 */
  router.get('/callback', async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string }
    if (!code) {
      res.status(400).json({ success: false, error: 'Missing code parameter' })
      return
    }
    // 校验 state 参数防止 CSRF 攻击
    if (!state || !authService.validateState(state)) {
      res.status(403).json({ success: false, error: 'Invalid or expired OAuth state parameter' })
      return
    }
    try {
      const accessToken = await authService.exchangeCode(code)
      const user = await authService.login(accessToken)
      // 重定向回前端页面
      const frontendUrl = process.env.FRONTEND_URL || '/agent-flow/'
      res.redirect(`${frontendUrl}?auth=success&user=${encodeURIComponent(user.login)}`)
    } catch (err) {
      const frontendUrl = process.env.FRONTEND_URL || '/agent-flow/'
      res.redirect(`${frontendUrl}?auth=error&message=${encodeURIComponent((err as Error).message)}`)
    }
  })

  /** 获取当前登录用户 */
  router.get('/me', (_req, res) => {
    const user = authService.getCurrentUser()
    res.json({ success: true, data: { user, authenticated: authService.isAuthenticated() } })
  })

  /** 登出 */
  router.post('/logout', async (_req, res) => {
    await authService.logout()
    res.json({ success: true })
  })

  /** 获取 GitHub repos 列表 */
  router.get('/repos', async (_req, res) => {
    try {
      const repos = await authService.fetchRepos()
      res.json({ success: true, data: { repos } })
    } catch (err) {
      res.status(401).json({ success: false, error: (err as Error).message })
    }
  })

  return router
}
