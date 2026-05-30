import { LoadingOutlined } from '@ant-design/icons'

/**
 * 路由级 Loading 占位组件
 * 在 React.lazy 动态加载页面 chunk 时显示
 */
export function RouteLoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <LoadingOutlined className="text-2xl text-indigo-400 mb-3" />
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    </div>
  )
}
