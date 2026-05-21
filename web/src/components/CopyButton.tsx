import { useState } from 'react'

interface CopyButtonProps {
  value: string
  title?: string
  className?: string
}

export default function CopyButton({ value, title = 'Copy', className = '' }: CopyButtonProps): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    e.preventDefault()
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false); }, 1200)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={(e) => { e.stopPropagation(); }}
      title={copied ? 'Copied!' : title}
      aria-label={copied ? 'Copied' : title}
      className={`inline-flex items-center justify-center p-0.5 rounded text-fg-muted hover:text-fg hover:bg-surface-inset cursor-pointer bg-transparent border-none transition-colors flex-shrink-0 ${className}`}
    >
      {copied ? (
        <svg className="w-3 h-3 text-success" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
        </svg>
      )}
    </button>
  )
}
