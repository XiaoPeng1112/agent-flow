/** Keep server/OAuth/sync secrets out of child processes. Provider keys are opt-in by provider. */
export function executionEnvironment(provider?: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot',
    'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  ])
  if (provider === 'codex') for (const name of ['CODEX_HOME', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']) allowed.add(name)
  if (provider === 'claude') for (const name of ['CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']) allowed.add(name)
  return Object.fromEntries(Object.entries(env).filter(([name]) => allowed.has(name)))
}
