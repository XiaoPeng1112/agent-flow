import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { WarningOutlined, ReloadOutlined } from '@ant-design/icons'

interface Props {
  children: ReactNode
  /** 降级 UI 标题（可选） */
  fallbackTitle?: string
  /** 是否显示错误堆栈（开发环境） */
  showStack?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * React Error Boundary — 组件级错误隔离
 *
 * 功能：
 * 1. 捕获子组件树中的 JavaScript 错误，防止单个组件崩溃导致全局白屏
 * 2. 提供友好的降级 UI 和错误信息展示
 * 3. 支持手动重试（重新渲染子组件树）
 * 4. 开发环境显示错误堆栈方便调试
 *
 * 使用方式：
 *   <ErrorBoundary fallbackTitle="页面加载失败">
 *     <SomeComponent />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo })
    // 生产环境可接入错误上报服务
    console.error('[ErrorBoundary] Caught error:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state
      const { fallbackTitle = '组件加载异常', showStack = import.meta.env.DEV } = this.props

      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center border border-red-100">
              <WarningOutlined className="text-2xl text-red-400" />
            </div>

            <h3 className="text-[16px] font-semibold text-gray-800 mb-2">{fallbackTitle}</h3>
            <p className="text-[13px] text-gray-500 mb-4">
              遇到了意外错误，请尝试重新加载。如果问题持续，请联系开发团队。
            </p>

            {/* 错误信息摘要 */}
            {error && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-left">
                <p className="text-[12px] text-red-700 font-mono break-all">
                  {error.message}
                </p>
              </div>
            )}

            {/* 开发环境：堆栈信息 */}
            {showStack && errorInfo?.componentStack && (
              <details className="mb-4 text-left">
                <summary className="text-[12px] text-gray-400 cursor-pointer hover:text-gray-600 mb-2">
                  展开错误堆栈
                </summary>
                <pre className="px-3 py-2 bg-gray-900 rounded-lg text-[11px] text-green-300 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed">
                  {errorInfo.componentStack}
                </pre>
              </details>
            )}

            {/* 重试按钮 */}
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-medium rounded-lg transition-colors shadow-sm"
            >
              <ReloadOutlined className="text-[12px]" />
              重新加载
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
