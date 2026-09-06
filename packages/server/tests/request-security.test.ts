import { describe, expect, it } from 'vitest'
import {
  createRequestSecurityConfig,
  getHeaderToken,
  isOriginAllowed,
  isTokenAllowed,
} from '../src/services/request-security.js'

describe('request security', () => {
  it('allows only local development origins by default', () => {
    const config = createRequestSecurityConfig({})

    expect(isOriginAllowed('http://localhost:5173', config)).toBe(true)
    expect(isOriginAllowed('http://127.0.0.1:5173', config)).toBe(true)
    expect(isOriginAllowed('https://attacker.example', config)).toBe(false)
    expect(isOriginAllowed(undefined, config)).toBe(true)
  })

  it('uses the configured origin allowlist', () => {
    const config = createRequestSecurityConfig({
      ALLOWED_ORIGINS: 'https://agent.example, http://localhost:4173',
    })

    expect(isOriginAllowed('https://agent.example', config)).toBe(true)
    expect(isOriginAllowed('http://localhost:5173', config)).toBe(false)
  })

  it('requires an exact token only when configured', () => {
    const openConfig = createRequestSecurityConfig({})
    const protectedConfig = createRequestSecurityConfig({ AGENT_FLOW_API_TOKEN: 'local-secret' })

    expect(isTokenAllowed(undefined, openConfig)).toBe(true)
    expect(isTokenAllowed('local-secret', protectedConfig)).toBe(true)
    expect(isTokenAllowed('wrong-secret', protectedConfig)).toBe(false)
    expect(isTokenAllowed(undefined, protectedConfig)).toBe(false)
  })

  it('extracts tokens from either supported HTTP header', () => {
    expect(getHeaderToken({ 'x-agent-flow-token': 'direct-token' })).toBe('direct-token')
    expect(getHeaderToken({ authorization: 'Bearer bearer-token' })).toBe('bearer-token')
    expect(getHeaderToken({ authorization: 'Basic abc' })).toBeUndefined()
  })
})
