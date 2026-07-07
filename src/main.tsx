import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { DebugTraceApp } from './DebugTraceApp.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

const isDebugTraceWindow = new URLSearchParams(window.location.search).get('debugTrace') === '1'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDebugTraceWindow ? (
      <DebugTraceApp />
    ) : (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    )}
  </React.StrictMode>,
)

// Use contextBridge when running inside Electron. The renderer can also be
// opened in a plain browser during diagnostics, where ipcRenderer is absent.
window.ipcRenderer?.on('main-process-message', (_event, message) => {
  console.log(message)
})
