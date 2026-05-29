#!/usr/bin/env tsx
/**
 * sync-context.ts — Context 文档同步检查脚本
 *
 * 功能：
 * 1. 从源代码中提取关键信息（版本号、模板数量、服务文件列表等）
 * 2. 与 .agent-flow/context/ 中的文档内容做对比
 * 3. 输出需要更新的提示
 *
 * 用法：
 *   npm run sync-context
 *   npx tsx scripts/sync-context.ts
 */

import { readFile, readdir } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT = resolve(__dirname, '..')
const CONTEXT_DIR = join(ROOT, '.agent-flow', 'context')
const SERVER_SRC = join(ROOT, 'packages', 'server', 'src')
const CLIENT_SRC = join(ROOT, 'packages', 'client', 'src')

interface CheckResult {
  file: string
  issue: string
  current: string
  expected: string
}

const results: CheckResult[] = []

// ─── 工具函数 ───

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

function extractVersionFromIndex(content: string): string | null {
  const match = content.match(/version:\s*['"]([^'"]+)['"]/)
  return match ? match[1] : null
}

function extractVersionFromBanner(content: string): string | null {
  const match = content.match(/AgentFlow Server v([\d.]+)/)
  return match ? match[1] : null
}

function extractTemplateCount(content: string): number {
  const matches = content.match(/this\.addTemplate\(/g)
  return matches ? matches.length : 0
}

// ─── 检查项 ───

async function checkVersionConsistency(): Promise<void> {
  const indexContent = await readTextFile(join(SERVER_SRC, 'index.ts'))
  const healthVersion = extractVersionFromIndex(indexContent)
  const bannerVersion = extractVersionFromBanner(indexContent)

  if (healthVersion && bannerVersion && healthVersion !== bannerVersion) {
    results.push({
      file: 'packages/server/src/index.ts',
      issue: '健康检查版本号与 banner 版本号不一致',
      current: `health: ${healthVersion}, banner: ${bannerVersion}`,
      expected: '两者应一致',
    })
  }

  // 检查 ARCHITECTURE.md 中的版本号
  const archContent = await readTextFile(join(CONTEXT_DIR, 'ARCHITECTURE.md'))
  const archVersionMatch = archContent.match(/最后更新：\d{4}-\d{2}-\d{2}（v([\d.]+)）/)
  if (archVersionMatch && healthVersion && archVersionMatch[1] !== healthVersion) {
    results.push({
      file: '.agent-flow/context/ARCHITECTURE.md',
      issue: 'ARCHITECTURE.md 中的版本号与代码不一致',
      current: `文档: v${archVersionMatch[1]}`,
      expected: `代码: v${healthVersion}`,
    })
  }

  // 检查 DEVLOG.md 是否记录了最新版本
  const devlogContent = await readTextFile(join(CONTEXT_DIR, 'DEVLOG.md'))
  if (healthVersion && !devlogContent.includes(`v${healthVersion}`)) {
    results.push({
      file: '.agent-flow/context/DEVLOG.md',
      issue: `DEVLOG.md 中未记录当前版本 v${healthVersion}`,
      current: '未找到版本记录',
      expected: `应包含 v${healthVersion} 的开发日志`,
    })
  }

  // 检查 ChangelogPage.tsx 是否记录了最新版本
  const changelogContent = await readTextFile(join(CLIENT_SRC, 'pages', 'ChangelogPage.tsx'))
  if (healthVersion && !changelogContent.includes(`v${healthVersion}`)) {
    results.push({
      file: 'packages/client/src/pages/ChangelogPage.tsx',
      issue: `ChangelogPage 中未记录当前版本 v${healthVersion}`,
      current: '未找到版本记录',
      expected: `应包含 v${healthVersion} 的更新日志`,
    })
  }
}

async function checkTemplateConsistency(): Promise<void> {
  const templateContent = await readTextFile(join(SERVER_SRC, 'services', 'template.ts'))
  const templateCount = extractTemplateCount(templateContent)

  const archContent = await readTextFile(join(CONTEXT_DIR, 'ARCHITECTURE.md'))

  // 检查 ARCHITECTURE.md 中模板数量描述
  const archTemplateMatch = archContent.match(/(\d+)\s*个内置模板/)
  if (archTemplateMatch && parseInt(archTemplateMatch[1]) !== templateCount) {
    results.push({
      file: '.agent-flow/context/ARCHITECTURE.md',
      issue: '模板数量描述与代码不一致',
      current: `文档: ${archTemplateMatch[1]} 个`,
      expected: `代码: ${templateCount} 个`,
    })
  }

  // 检查所有模板是否都有 deliver 节点
  const deliverMatches = templateContent.match(/type:\s*'deliver'/g)
  const deliverCount = deliverMatches ? deliverMatches.length : 0

  if (templateCount > 0 && deliverCount < templateCount) {
    results.push({
      file: 'packages/server/src/services/template.ts',
      issue: '部分模板缺少 deliver 节点',
      current: `${deliverCount}/${templateCount} 个模板有 deliver 节点`,
      expected: '所有模板都应有 deliver 节点',
    })
  }
}

async function checkServiceFiles(): Promise<void> {
  const servicesDir = join(SERVER_SRC, 'services')
  let serviceFiles: string[] = []
  try {
    const files = await readdir(servicesDir)
    serviceFiles = files.filter(f => f.endsWith('.ts')).map(f => f.replace('.ts', ''))
  } catch {
    return
  }

  const archContent = await readTextFile(join(CONTEXT_DIR, 'ARCHITECTURE.md'))

  for (const svc of serviceFiles) {
    if (!archContent.includes(`${svc}.ts`)) {
      results.push({
        file: '.agent-flow/context/ARCHITECTURE.md',
        issue: `ARCHITECTURE.md 中未列出服务文件: ${svc}.ts`,
        current: '文件存在但文档未记录',
        expected: `应在目录结构中列出 ${svc}.ts`,
      })
    }
  }
}

async function checkLastUpdateDate(): Promise<void> {
  const archContent = await readTextFile(join(CONTEXT_DIR, 'ARCHITECTURE.md'))
  const dateMatch = archContent.match(/最后更新：(\d{4}-\d{2}-\d{2})/)

  if (dateMatch) {
    const lastUpdate = new Date(dateMatch[1])
    const now = new Date()
    const daysDiff = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24))

    if (daysDiff > 7) {
      results.push({
        file: '.agent-flow/context/ARCHITECTURE.md',
        issue: `文档已超过 ${daysDiff} 天未更新`,
        current: `最后更新: ${dateMatch[1]}`,
        expected: '建议每次开发会话结束时更新',
      })
    }
  }
}

// ─── 主流程 ───

async function main(): Promise<void> {
  console.log('🔍 AgentFlow Context 同步检查\n')
  console.log('━'.repeat(50))

  await checkVersionConsistency()
  await checkTemplateConsistency()
  await checkServiceFiles()
  await checkLastUpdateDate()

  if (results.length === 0) {
    console.log('\n✅ 所有 context 文档与代码一致，无需更新！\n')
  } else {
    console.log(`\n⚠️  发现 ${results.length} 处需要关注的不一致：\n`)
    for (const r of results) {
      console.log(`  📄 ${r.file}`)
      console.log(`     问题: ${r.issue}`)
      console.log(`     当前: ${r.current}`)
      console.log(`     期望: ${r.expected}`)
      console.log()
    }
    console.log('━'.repeat(50))
    console.log('💡 提示: 在对话结束时告诉 AI "同步 context" 即可自动更新文档')
    console.log()
  }
}

main().catch(console.error)
