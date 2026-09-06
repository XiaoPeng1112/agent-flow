import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthService } from '../src/services/auth.js'
import { createAuthRouter } from '../src/routes/auth.js'

afterEach(() => vi.unstubAllEnvs())
function fixture() {
  vi.stubEnv('ALLOWED_ORIGINS', 'https://xiaopeng1112.github.io,http://localhost:5173')
  const auth = new AuthService()
  const exchange = vi.spyOn(auth, 'exchangeCode').mockResolvedValue('test-token')
  vi.spyOn(auth, 'login').mockResolvedValue({ login: 'test' } as never)
  const router = createAuthRouter({ authService: auth })
  const call = async (path: string, query: Record<string,string>) => {
    let body: any, redirect = '', status = 200
    const handler = (router.stack.find((layer: any) => layer.route?.path === path) as any).route.stack[0].handle
    await handler({ query, headers: { host: 'localhost:3001' } }, {
      json(value: unknown) { body = value }, status(value: number) { status = value; return this },
      redirect(value: string) { redirect = value }, setHeader() {},
    })
    return { body, redirect, status }
  }
  const start = async (returnUrl: string) => {
    const response = await call('/github', { returnUrl })
    return new URL(response.body.data.url).searchParams.get('state')!
  }
  return { call, start, exchange }
}
describe('OAuth returns to the initiating frontend', () => {
  it.each(['https://xiaopeng1112.github.io/agent-flow/?view=full#/projects/p/runs/r', 'http://localhost:5173/agent-flow/#/projects/p'])('returns to %s and preserves its route', async target => {
    const f = fixture(); const state = await f.start(target)
    const result = await f.call('/callback', { code: 'test-code', state })
    const url = new URL(result.redirect), original = new URL(target)
    expect(url.origin).toBe(original.origin); expect(url.pathname).toBe(original.pathname); expect(url.hash).toBe(original.hash)
    expect(url.searchParams.get('auth')).toBe('success')
    expect(url.searchParams.get('view')).toBe(original.searchParams.get('view'))
    expect(result.redirect).not.toContain('test-token')
    expect((await f.call('/callback', { code: 'test-code', state })).status).toBe(403)
    expect(f.exchange).toHaveBeenCalledTimes(1)
  })
  it('returns declined authorizations and exchange failures to the frontend', async () => {
    const f = fixture(), target = 'https://xiaopeng1112.github.io/agent-flow/#/home'
    const denied = await f.call('/callback', { state: await f.start(target), error: 'access_denied' })
    expect(new URL(denied.redirect).searchParams.get('auth')).toBe('error')
    expect(f.exchange).not.toHaveBeenCalled()
    f.exchange.mockRejectedValueOnce(new Error('secret provider details'))
    const failed = await f.call('/callback', { state: await f.start(target), code: 'code' })
    expect(new URL(failed.redirect).hash).toBe('#/home')
    expect(failed.redirect).not.toContain('secret')
  })
  it('rejects untrusted, credential-bearing and non-http return URLs', async () => {
    const f = fixture()
    for (const returnUrl of ['https://evil.example/', 'https://xiaopeng1112.github.io.evil.example/', 'https://user@xiaopeng1112.github.io/', 'javascript:alert(1)', '//evil.example/']) {
      expect((await f.call('/github', { returnUrl })).status).toBe(400)
    }
    expect((await f.call('/callback', { code: 'code', state: 'forged' })).status).toBe(403)
    expect(f.exchange).not.toHaveBeenCalled()
  })
  it('expires state and isolates destinations for concurrent logins', async () => {
    const f = fixture(), first = await f.start('http://localhost:5173/agent-flow/#/one')
    const second = await f.start('https://xiaopeng1112.github.io/agent-flow/#/two')
    expect(new URL((await f.call('/callback', { code: 'code', state: second })).redirect).hash).toBe('#/two')
    const now = Date.now(); const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 600_001)
    expect((await f.call('/callback', { code: 'code', state: first })).status).toBe(403)
    spy.mockRestore()
  })
})
