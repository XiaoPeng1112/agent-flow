import { useState, useEffect, useCallback, useRef } from 'react'

export type ServerStatus = 'connecting' | 'online' | 'offline'

interface ServerHealth {
  status: ServerStatus
  /** 最后一次成功心跳时间 */
  lastHeartbeat: number | null
  /** 服务版本号 */
  version: string | null
  /** 连续失败次数 */
  failCount: number
  /** 手动重试 */
  retry: () => void
}

const HEALTH_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace('/api', '/health')
const HEARTBEAT_INTERVAL = 10_000 // 10s 心跳
const OFFLINE_THRESHOLD = 2 // 连续失败 2 次判定离线

/**
 * 后端服务状态监测 Hook
 *
 * 功能：
 *   1. 启动时立即检测后端是否在线
 *   2. 每 10s 心跳轮询 /health 接口
 *   3. 连续失败 2 次判定为离线
 *   4. 恢复在线时自动更新状态
 *   5. 提供手动重试方法
 */
export function useServerStatus(): ServerHealth {
  const [status, setStatus] = useState<ServerStatus>('connecting')
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [failCount, setFailCount] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const checkHealth = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const res = await fetch(HEALTH_URL, { signal: controller.signal })
      clearTimeout(timeout)

      if (res.ok) {
        const data = await res.json()
        setStatus('online')
        setLastHeartbeat(Date.now())
        setVersion(data.version || null)
        setFailCount(0)
      } else {
        throw new Error(`HTTP ${res.status}`)
      }
    } catch {
      setFailCount((prev) => {
        const next = prev + 1
        if (next >= OFFLINE_THRESHOLD) {
          setStatus('offline')
        }
        return next
      })
    }
  }, [])

  const retry = useCallback(() => {
    setStatus('connecting')
    setFailCount(0)
    checkHealth()
  }, [checkHealth])

  useEffect(() => {
    // 立即检测
    checkHealth()

    // 定时心跳
    timerRef.current = setInterval(checkHealth, HEARTBEAT_INTERVAL)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [checkHealth])

  return { status, lastHeartbeat, version, failCount, retry }
}
