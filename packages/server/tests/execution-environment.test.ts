import { describe, expect, it } from 'vitest'
import { executionEnvironment } from '../src/services/execution-environment.js'

describe('executionEnvironment', () => {
  const env = { PATH: '/bin', HOME: '/test', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic',
    AGENT_FLOW_API_TOKEN: 'server', GITHUB_CLIENT_SECRET: 'oauth', NPM_TOKEN: 'registry' }
  it('provides only the selected provider credentials and basic execution environment', () => {
    expect(executionEnvironment('codex', env)).toEqual({ PATH: '/bin', HOME: '/test', OPENAI_API_KEY: 'openai' })
    expect(executionEnvironment('claude', env)).toEqual({ PATH: '/bin', HOME: '/test', ANTHROPIC_API_KEY: 'anthropic' })
  })
  it('does not inherit service or model credentials into deterministic scripts', () => {
    expect(executionEnvironment(undefined, env)).toEqual({ PATH: '/bin', HOME: '/test' })
  })
})
