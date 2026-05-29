import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider, App as AntApp, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { router } from './router'
import './index.css'

const antTheme = {
  token: {
    colorPrimary: '#6366f1',
    borderRadius: 8,
    colorBgContainer: '#ffffff',
    colorBgLayout: '#f5f6fa',
    colorBorder: '#e5e7eb',
    colorBorderSecondary: '#f3f4f6',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    controlHeight: 34,
    controlHeightSM: 28,
    paddingLG: 24,
    marginLG: 24,
  },
  algorithm: theme.defaultAlgorithm,
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={antTheme}>
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
