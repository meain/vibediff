/**
 * Utility functions for consistent button styling across the app
 */

type ButtonVariant = 'left' | 'right' | 'middle' | 'single'

/**
 * Get button class names based on active state and variant
 */
export function getButtonClassName(isActive: boolean, variant: ButtonVariant = 'single', danger = false): string {
  const baseClasses = 'px-3 py-1 text-xs font-medium border cursor-pointer leading-5 transition-colors'

  const roundedClasses: Record<ButtonVariant, string> = {
    left: 'rounded-l-md',
    right: 'rounded-r-md border-l-0',
    middle: 'border-l-0',
    single: 'rounded-md'
  }

  const stateClasses = (() => {
    if (isActive) return 'bg-accent/15 text-accent-emphasis border-accent/40'
    if (danger) return 'bg-transparent text-fg-muted border-edge/60 hover:bg-danger/10 hover:text-danger hover:border-danger/40'
    return 'bg-transparent text-fg-muted border-edge/60 hover:bg-surface-inset hover:text-fg hover:border-edge'
  })()

  return `${baseClasses} ${roundedClasses[variant]} ${stateClasses}`
}

/**
 * Get icon button class names (for buttons with only icons, no text label)
 */
export function getIconButtonClassName(isActive: boolean, danger = false): string {
  const baseClasses = 'flex items-center justify-center p-1.5 border rounded-md cursor-pointer transition-colors'

  const stateClasses = (() => {
    if (isActive) return 'bg-accent/15 text-accent-emphasis border-accent/40'
    if (danger) return 'bg-transparent text-fg-muted border-edge/60 hover:bg-danger/10 hover:text-danger hover:border-danger/40'
    return 'bg-transparent text-fg-muted border-edge/60 hover:bg-surface-inset hover:text-fg hover:border-edge'
  })()

  return `${baseClasses} ${stateClasses}`
}
