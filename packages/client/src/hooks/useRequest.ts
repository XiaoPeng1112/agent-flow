import { useState, useCallback, useRef } from 'react'
import { App } from 'antd'

/**
 * API 请求配置
 */
interface UseRequestOptions<T> {
  /** 请求成功时的 Toast 消息（可选） */
  successMessage?: string
  /** 请求失败时的 Toast 消息前缀（可选，默认 "操作失败"） */
  errorPrefix?: string
  /** 最大自动重试次数（默认 0，不自动重试） */
  maxRetries?: number
  /** 重试间隔基数（毫秒，默认 1000） */
  retryDelay?: number
  /** 成功回调 */
  onSuccess?: (data: T) => void
  /** 失败回调 */
  onError?: (error: Error) => void
}

/**
 * useRequest — 统一 API 请求 Hook
 *
 * 功能：
 * 1. Loading 状态管理：自动追踪请求进行状态
 * 2. 错误处理：自动弹出 Toast 提示，统一错误格式
 * 3. 请求重试：支持手动重试（上次请求参数缓存）和自动重试（指数退避）
 * 4. 防重复提交：loading 期间忽略重复调用
 *
 * 使用方式：
 *   const { run, loading, error, retry } = useRequest(projectApi.create, {
 *     successMessage: '项目创建成功',
 *     maxRetries: 2,
 *     onSuccess: (data) => addProject(data.project),
 *   })
 *   // 调用：run({ name: 'foo', path: '/bar' })
 *   // 重试上次调用：retry()
 */
export function useRequest<TParams extends unknown[], TResult>(
  fn: (...args: TParams) => Promise<TResult>,
  options: UseRequestOptions<TResult> = {},
) {
  const {
    successMessage,
    errorPrefix = '操作失败',
    maxRetries = 0,
    retryDelay = 1000,
    onSuccess,
    onError,
  } = options

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const lastArgsRef = useRef<TParams | null>(null)
  const retryCountRef = useRef(0)

  // 使用 antd App context 中的 message (确保在 ConfigProvider 内)
  const { message } = App.useApp()

  const execute = useCallback(
    async (...args: TParams): Promise<TResult | undefined> => {
      if (loading) return undefined // 防重复提交

      lastArgsRef.current = args
      retryCountRef.current = 0
      setLoading(true)
      setError(null)

      try {
        const result = await fn(...args)
        setLoading(false)
        if (successMessage) {
          message.success(successMessage)
        }
        onSuccess?.(result)
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        // 自动重试逻辑（指数退避）
        if (maxRetries > 0 && retryCountRef.current < maxRetries) {
          retryCountRef.current++
          const delay = retryDelay * Math.pow(2, retryCountRef.current - 1)
          await new Promise((resolve) => setTimeout(resolve, delay))
          setLoading(false)
          return execute(...args)
        }

        setError(error)
        setLoading(false)
        message.error(`${errorPrefix}：${error.message}`)
        onError?.(error)
        return undefined
      }
    },
    [fn, loading, successMessage, errorPrefix, maxRetries, retryDelay, message, onSuccess, onError],
  )

  /**
   * 使用上次参数重试请求
   */
  const retry = useCallback(() => {
    if (lastArgsRef.current) {
      return execute(...lastArgsRef.current)
    }
    return Promise.resolve(undefined)
  }, [execute])

  return {
    /** 执行请求 */
    run: execute,
    /** 是否正在请求中 */
    loading,
    /** 最近一次错误 */
    error,
    /** 使用上次参数重试 */
    retry,
  }
}

/**
 * useLoadingAction — 轻量版，仅管理 loading + error toast
 * 适用于简单的一次性操作（如删除、开关切换等）
 */
export function useLoadingAction() {
  const [loading, setLoading] = useState(false)
  const { message } = App.useApp()

  const run = useCallback(
    async <T>(
      fn: () => Promise<T>,
      options?: { successMessage?: string; errorPrefix?: string },
    ): Promise<T | undefined> => {
      if (loading) return undefined
      setLoading(true)
      try {
        const result = await fn()
        if (options?.successMessage) {
          message.success(options.successMessage)
        }
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        message.error(`${options?.errorPrefix || '操作失败'}：${error.message}`)
        return undefined
      } finally {
        setLoading(false)
      }
    },
    [loading, message],
  )

  return { run, loading }
}
