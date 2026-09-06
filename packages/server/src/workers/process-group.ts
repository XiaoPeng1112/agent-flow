import { execFile, type ChildProcess } from 'child_process'

export function groupExists(pid: number): boolean {
  try { process.kill(process.platform === 'win32' ? pid : -pid, 0); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Only accept a process handle created by this worker, never a PID from an API request. */
export async function stopProcessGroup(child: ChildProcess, graceMs = 1500): Promise<void> {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], error => {
      if (error && child.exitCode === null) reject(error)
      else resolve()
    }))
    return
  }
  const signal = (value: NodeJS.Signals) => {
    try { process.kill(-pid, value) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  if (!groupExists(pid)) return
  signal('SIGTERM')
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline && groupExists(pid)) await new Promise(resolve => setTimeout(resolve, 25))
  if (groupExists(pid)) signal('SIGKILL')
  // Wait for pipes and the leader to be reaped by Node. Zombies cannot perform further writes.
}
