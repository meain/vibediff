import { useEffect, useRef } from 'react'

interface WSMessage {
  type: string
  timestamp: number
  directory?: string
}

export function useWebSocket(onUpdate: (dir: string) => void, onCommentUpdate?: (dir: string) => void): void {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isConnectingRef = useRef(false)
  const reconnectAttemptsRef = useRef(0)

  // Store callbacks in refs to avoid reconnecting when they change.
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const onCommentUpdateRef = useRef(onCommentUpdate)
  useEffect(() => {
    onCommentUpdateRef.current = onCommentUpdate
  }, [onCommentUpdate])

  useEffect(() => {
    const connectWebSocket = (): void => {
      // Prevent multiple simultaneous connections
      if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
        return
      }

      isConnectingRef.current = true

      // Clean up any existing connection
      if (wsRef.current) {
        wsRef.current.close()
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        // WebSocket connected
        isConnectingRef.current = false
        reconnectAttemptsRef.current = 0

        // Clear any pending reconnect
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as WSMessage

          const dir = data.directory ?? ''
          if (data.type === 'connected') {
            // Connected to live updates
          } else if (data.type === 'file_changed' || data.type === 'file_added' || data.type === 'file_deleted') {
            // Trigger update after a short delay to ensure git has finished processing
            if (pendingUpdateTimerRef.current) {
              clearTimeout(pendingUpdateTimerRef.current)
            }
            pendingUpdateTimerRef.current = setTimeout(() => {
              pendingUpdateTimerRef.current = null
              onUpdateRef.current(dir)
            }, 300)
          } else if (data.type === 'comment_changed') {
            // Agent reply (or any server-side AddComment) — re-fetch
            // comments without paying for a diff refresh.
            onCommentUpdateRef.current?.(dir)
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        isConnectingRef.current = false
      }

      ws.onclose = () => {
        // WebSocket disconnected
        isConnectingRef.current = false
        wsRef.current = null

        // Exponential backoff for reconnection
        const baseDelay = 1000
        const maxDelay = 30000
        const delay = Math.min(baseDelay * Math.pow(2, reconnectAttemptsRef.current), maxDelay)
        reconnectAttemptsRef.current++

        // Reconnecting with exponential backoff
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay)
      }
    }

    // Initial connection
    connectWebSocket()

    // Cleanup
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (pendingUpdateTimerRef.current) {
        clearTimeout(pendingUpdateTimerRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, []) // Empty dependency array - only connect once
}
