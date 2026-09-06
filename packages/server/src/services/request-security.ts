import { timingSafeEqual } from 'crypto'

export interface RequestSecurityConfig {
  allowedOrigins: Set<string>
  apiToken?: string
}

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

export function createRequestSecurityConfig(env: NodeJS.ProcessEnv = process.env): RequestSecurityConfig {
  const configuredOrigins = env.ALLOWED_ORIGINS
    ?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  return {
    allowedOrigins: new Set(configuredOrigins?.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS),
    apiToken: env.AGENT_FLOW_API_TOKEN?.trim() || undefined,
  }
}

export function isOriginAllowed(origin: string | undefined, config: RequestSecurityConfig): boolean {
  return !origin || config.allowedOrigins.has(origin)
}

export function isTokenAllowed(token: string | undefined, config: RequestSecurityConfig): boolean {
  if (!config.apiToken) return true
  if (!token) return false

  const expected = Buffer.from(config.apiToken)
  const actual = Buffer.from(token)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function getHeaderToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const explicitToken = headers['x-agent-flow-token']
  if (typeof explicitToken === 'string') return explicitToken

  const authorization = headers.authorization
  if (typeof authorization !== 'string') return undefined
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  return match?.[1]
}

