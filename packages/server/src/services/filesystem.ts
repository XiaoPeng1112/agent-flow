import { watch } from 'chokidar'
import { readFile, readdir, stat, writeFile } from 'fs/promises'
import { join, relative } from 'path'
import { createTwoFilesPatch } from 'diff'
import type { FileChange } from '../types/index.js'

/**
 * 文件系统服务
 * 负责文件读写、目录浏览、变更监听和 diff 计算
 */
export class FileSystemService {
  private watchers: Map<string, ReturnType<typeof watch>> = new Map()
  private fileSnapshots: Map<string, string> = new Map()

  /** 读取文件内容 */
  async readFile(filePath: string): Promise<string> {
    return readFile(filePath, 'utf-8')
  }

  /** 写入文件 */
  async writeFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8')
  }

  /** 列出目录内容 */
  async listDir(dirPath: string): Promise<Array<{ name: string; isDir: boolean; path: string }>> {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        path: join(dirPath, e.name),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  /** 获取文件状态 */
  async getFileStat(filePath: string) {
    const s = await stat(filePath)
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
