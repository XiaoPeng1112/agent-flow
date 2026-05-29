import { watch } from 'chokidar'
import { readFile, readdir, stat, writeFile } from 'fs/promises'
import { join, relative, resolve, normalize } from 'path'
import { createTwoFilesPatch } from 'diff'
import type { FileChange } from '../types/index.js'

/**
 * 文件系统服务
 * 负责文件读写、目录浏览、变更监听和 diff 计算
 */
export class FileSystemService {
  private watchers: Map<string, ReturnType<typeof watch>> = new Map()
  private fileSnapshots: Map<string, string> = new Map()
  private allowedRoots: string[] = []

  /**
   * 设置允许访问的根目录列表
   * 所有文件操作必须在这些目录下，防止路径穿越攻击
   */
  setAllowedRoots(roots: string[]): void {
    this.allowedRoots = roots.map(r => resolve(r))
  }

  /**
   * 路径安全校验：确保解析后的绝对路径在允许的根目录内
   * 防止 ../ 等路径穿越攻击
   */
  private assertPathSafe(targetPath: string): string {
    const resolved = resolve(normalize(targetPath))
    // 如果未配置 allowedRoots，则不限制（向后兼容）
    if (this.allowedRoots.length === 0) return resolved
    const isAllowed = this.allowedRoots.some(root => 
      resolved === root || resolved.startsWith(root + '/')
    )
    if (!isAllowed) {
      throw new Error(`Access denied: path "${targetPath}" is outside allowed directories`)
    }
    return resolved
  }

  /** 读取文件内容 */
  async readFile(filePath: string): Promise<string> {
    const safePath = this.assertPathSafe(filePath)
    return readFile(safePath, 'utf-8')
  }

  /** 写入文件 */
  async writeFile(filePath: string, content: string): Promise<void> {
    const safePath = this.assertPathSafe(filePath)
    await writeFile(safePath, content, 'utf-8')
  }

  /** 列出目录内容 */
  async listDir(dirPath: string): Promise<Array<{ name: string; isDir: boolean; path: string }>> {
    const safePath = this.assertPathSafe(dirPath)
    const entries = await readdir(safePath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        path: join(safePath, e.name),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  /** 获取文件状态 */
  async getFileStat(filePath: string) {
    const safePath = this.assertPathSafe(filePath)
    const s = await stat(safePath)
    return {
      size: s.size,
      isFile: s.isFile(),
      isDir: s.isDirectory(),
      modified: s.mtime.toISOString(),
    }
  }

  /** 计算文件 diff */
  async computeDiff(filePath: string, newContent: string): Promise<string> {
    const oldContent = this.fileSnapshots.get(filePath) || ''
    return createTwoFilesPatch(filePath, filePath, oldContent, newContent, 'before', 'after')
  }

  /** 快照文件（用于后续 diff 计算） */
  async snapshotFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8')
      this.fileSnapshots.set(filePath, content)
    } catch {
      // 文件不存在则记录空
      this.fileSnapshots.set(filePath, '')
    }
  }

  /** 监听目录变化 */
  watchDirectory(
    dirPath: string,
    onChange: (change: FileChange) => void
  ): void {
    if (this.watchers.has(dirPath)) return

    const watcher = watch(dirPath, {
      ignored: /(^|[/\\])\.|node_modules|\.git|dist/,
      persistent: true,
      ignoreInitial: true,
    })

    watcher
      .on('add', (path) => {
        onChange({ path: relative(dirPath, path), type: 'add' })
      })
      .on('change', async (path) => {
        const content = await readFile(path, 'utf-8').catch(() => '')
        const diff = await this.computeDiff(path, content)
        onChange({ path: relative(dirPath, path), type: 'change', content, diff })
      })
      .on('unlink', (path) => {
        onChange({ path: relative(dirPath, path), type: 'unlink' })
      })

    this.watchers.set(dirPath, watcher)
  }

  /** 停止监听 */
  unwatchAll(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
  }
}
