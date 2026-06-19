import { createContext, useContext, useState, useCallback } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'

interface WebSocketContextType {
  lastUpdate: number
  lastUpdateDir: string
  lastCommentUpdate: number
  lastCommentUpdateDir: string
}

// Exported so consumers that need to tolerate a missing provider can
// call useContext(WebSocketContext) directly. Most consumers should
// prefer useWebSocketUpdates below, which throws on misuse.
export const WebSocketContext = createContext<WebSocketContextType | null>(null)

export function WebSocketProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [lastUpdate, setLastUpdate] = useState(Date.now())
  const [lastUpdateDir, setLastUpdateDir] = useState('')
  const [lastCommentUpdate, setLastCommentUpdate] = useState(Date.now())
  const [lastCommentUpdateDir, setLastCommentUpdateDir] = useState('')

  const triggerUpdate = useCallback((dir: string) => {
    setLastUpdate(Date.now())
    setLastUpdateDir(dir)
  }, [])

  const triggerCommentUpdate = useCallback((dir: string) => {
    setLastCommentUpdate(Date.now())
    setLastCommentUpdateDir(dir)
  }, [])

  // Set up WebSocket connection at root level
  useWebSocket(triggerUpdate, triggerCommentUpdate)

  return (
    <WebSocketContext.Provider value={{ lastUpdate, lastUpdateDir, lastCommentUpdate, lastCommentUpdateDir }}>
      {children}
    </WebSocketContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWebSocketUpdates(): WebSocketContextType {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketUpdates must be used within WebSocketProvider')
  }
  return context
}
