import { useEffect } from 'react'

interface ToastProps {
  message: string
  onDismiss: () => void
  type?: 'error' | 'info'
}

export default function Toast({ message, onDismiss, type = 'error' }: ToastProps): React.ReactElement {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000)
    return () => { clearTimeout(timer) }
  }, [onDismiss])

  const colorClasses = type === 'error'
    ? 'bg-red-500 text-white'
    : 'bg-surface-raised text-fg border border-edge'

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${colorClasses}`}>
      <span className="text-sm">{message}</span>
      <button
        onClick={onDismiss}
        className="ml-1 text-current opacity-70 hover:opacity-100 transition-opacity leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
