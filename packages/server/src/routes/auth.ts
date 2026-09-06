import { createRequestSecurityConfig } from '../services/request-security.js'
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
    const requested = req.query.returnUrl
    const fallback = process.env.FRONTEND_URL || 'http://localhost:5173/agent-flow/'
    let returnUrl: URL
    try {
      returnUrl = new URL(typeof requested === 'string' ? requested : fallback)
      const allowed = createRequestSecurityConfig().allowedOrigins
      if (process.env.FRONTEND_URL) allowed.add(new URL(process.env.FRONTEND_URL).origin)
      if (!['http:', 'https:'].includes(returnUrl.protocol) || returnUrl.username || returnUrl.password || !allowed.has(returnUrl.origin) || returnUrl.href.length > 4096) throw new Error('Invalid return URL')
    } catch {
      res.status(400).json({ success: false, error: '登录返回地址不在允许的前端来源中' }); return
    }
    const url = authService.getAuthUrl(redirectUri, returnUrl.href)
    res.json({ success: true, data: { url, configured: authService.isConfigured() } })
  })

  /** GitHub OAuth 回调 */
  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query
    const pending = typeof state === 'string' ? authService.consumeState(state) : undefined
    if (!pending?.returnUrl) {
      res.status(403).json({ success: false, error: '登录会话已过期，请返回平台重新登录' }); return
    }
    const target = new URL(pending.returnUrl)
    target.searchParams.delete('user')
    target.searchParams.delete('message')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    if (typeof code !== 'string' || error) {
      target.searchParams.set('auth', 'error')
      target.searchParams.set('message', 'GitHub 授权未完成，请重试')
      res.redirect(target.href); return
    }
    try {
      const accessToken = await authService.exchangeCode(code)
      await authService.login(accessToken)
      target.searchParams.set('auth', 'success')
    } catch {
      target.searchParams.set('auth', 'error')
      target.searchParams.set('message', 'GitHub 登录失败，请重试')
    }
    res.redirect(target.href)
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
