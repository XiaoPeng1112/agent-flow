import { spawn, type ChildProcess } from 'child_process'
import type { WebSocket } from 'ws'

/**
 * 终端会话管理
 * 使用 child_process.spawn 创建 PTY 会话，通过 WebSocket 双向通信
 */
export class TerminalService {
  private sessions: Map<string, ChildProcess> = new Map()

  /** 创建新终端会话 */
  createSession(sessionId: string, ws: WebSocket, cwd?: string): void {
    const shell = process.env.SHELL || '/bin/zsh'
    const workDir = cwd || process.cwd()

    const proc = spawn(shell, ['-i'], {
      cwd: workDir,
      env: { ...process.env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.sessions.set(sessionId, proc)

    // stdout → WebSocket
    proc.stdout?.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'terminal:output',
          payload: { sessionId, data: data.toString() },
          timestamp: Date.now(),
        }))
      }
    })

    // stderr → WebSocket
    proc.stderr?.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'terminal:output',
          payload: { sessionId, data: data.toString() },
          timestamp: Date.now(),
        }))
      }
    })

    proc.on('exit', (code) => {
      this.sessions.delete(sessionId)
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'terminal:output',
          payload: { sessionId, data: `\r\n[Process exited with code ${code}]\r\n` },
          timestamp: Date.now(),
        }))
      }
    })
  }

  /** 向终端输入 */
  write(sessionId: string, data: string): void {
    const proc = this.sessions.get(sessionId)
    if (proc?.stdin?.writable) {
      proc.stdin.write(data)
    }
  }

  /** 关闭终端会话 */
  close(sessionId: string): void {
    const proc = this.sessions.get(sessionId)
    if (proc) {
      proc.kill()
      this.sessions.delete(sessionId)
    }
  }

  /** 关闭所有会话 */
  closeAll(): void {
    for (const [id] of this.sessions) {
      this.close(id)
    }
  }
}
