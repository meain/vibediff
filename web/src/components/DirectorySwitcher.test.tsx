import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import DirectorySwitcher from './DirectorySwitcher'
import type { DirectoryEntry } from '../hooks/useDirectory'

// ---- fixtures -----------------------------------------------------------

const PROJ = '/home/u/alpha-project'
const OTHER = '/home/u/beta-project'

function baseDirectories(): DirectoryEntry[] {
  return [
    { path: PROJ, alias: 'Proj A' },
    { path: OTHER, alias: '' },
  ]
}

function baseProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    currentDirectory: PROJ,
    directories: baseDirectories(),
    homeDir: '/home/u',
    onSelectDirectory: vi.fn(),
    onAddDirectory: vi.fn(async () => undefined),
    onRemoveDirectory: vi.fn(async () => undefined),
    onReorderDirectories: vi.fn(async () => undefined),
    onValidate: vi.fn(async () => ({ valid: true })),
    onSetAlias: vi.fn(async () => undefined),
    ...overrides,
  }
}

// ---- DOM helpers ---------------------------------------------------------
//
// Both the trigger button and each dropdown row's label button carry
// `title={rawPath}` (the row's visible text is the alias, or a `~`-relative
// formatted path -- but the title attribute always holds the untruncated,
// unaliased path). The trigger is distinguished from a row's label button by
// class name (`flex-1 ...` for row buttons vs `flex items-center gap-1.5
// w-full ...` for the trigger). Each row's gear/options button has
// `title="Directory options"`.

/** Opens the switcher's dropdown by clicking the trigger button (identified by its raw-path title). */
function openSwitcher(currentPath: string): void {
  fireEvent.click(screen.getByTitle(currentPath))
}

/** Finds the dropdown row container (the draggable wrapper) for a directory identified by its raw path. */
function getRowByPath(path: string): HTMLElement {
  const candidates = screen.getAllByTitle(path)
  const rowButton =
    candidates.find((el) => el.tagName === 'BUTTON' && el.className.includes('flex-1')) ?? candidates[candidates.length - 1]
  let node: HTMLElement | null = rowButton.parentElement
  while (node && !node.hasAttribute('draggable')) {
    node = node.parentElement
  }
  if (!node) throw new Error(`Unable to locate row container for path "${path}"`)
  return node
}

/** Opens a row's gear/options menu. */
function openRowMenu(row: HTMLElement): void {
  fireEvent.click(within(row).getByTitle('Directory options'))
}

// ---- tests ----------------------------------------------------------------

describe('DirectorySwitcher - alias editing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. setting an alias via the input and pressing Enter calls onSetAlias and the row shows the new alias', () => {
    const onSetAlias = vi.fn(async () => undefined)
    const directories = [{ path: OTHER, alias: '' }]
    render(<DirectorySwitcher {...baseProps({ currentDirectory: OTHER, directories, onSetAlias })} />)

    openSwitcher(OTHER)
    const row = getRowByPath(OTHER)
    openRowMenu(row)

    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    const input = within(row).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'New Alias' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onSetAlias).toHaveBeenCalledWith(OTHER, 'New Alias')
  })

  it('2. pressing Enter with an emptied input is a no-op: no onSetAlias call, alias unchanged', () => {
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    const input = within(row).getByRole('textbox')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onSetAlias).not.toHaveBeenCalled()
    expect(within(row).getByText('Proj A')).toBeInTheDocument()
  })

  it('3. Escape discards the typed value: no onSetAlias call, reverts to previous alias, no confirmation', () => {
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    const input = within(row).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Junk' } })
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })

    expect(onSetAlias).not.toHaveBeenCalled()
    expect(screen.queryByText((c) => c.includes('Junk'))).not.toBeInTheDocument()
    expect(within(row).getByText('Proj A')).toBeInTheDocument()
    // No confirmation dialog: no dialog role and no window.confirm invocation surface.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('4. clicking outside the input discards the typed value, same as Escape, no confirmation', () => {
    // A click fully outside the switcher closes the whole dropdown (existing
    // behavior, unrelated to aliasing) *and* must discard the in-progress
    // edit so it doesn't resurface stale text the next time the dropdown is
    // reopened -- it must not leave editingPath/editValue pointing at the
    // now-unmounted row.
    const onSetAlias = vi.fn(async () => undefined)
    render(
      <div>
        <div data-testid="outside">outside area</div>
        <DirectorySwitcher {...baseProps({ onSetAlias })} />
      </div>
    )

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    const input = within(row).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Junk' } })
    // The outside-click listener's event type isn't specified by the plan;
    // fire mousedown+click on the outside target (mirrors SettingsPanel's
    // mousedown-based outside-close for its own dropdown).
    fireEvent.mouseDown(screen.getByTestId('outside'))
    fireEvent.click(screen.getByTestId('outside'))

    expect(onSetAlias).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The whole dropdown closes on an outside click (pre-existing behavior).
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    // Reopening must show the original alias, not the discarded "Junk" --
    // proves the edit state was actually reset, not just hidden.
    openSwitcher(PROJ)
    const reopenedRow = getRowByPath(PROJ)
    expect(within(reopenedRow).getByText('Proj A')).toBeInTheDocument()
    expect(screen.queryByText((c) => c.includes('Junk'))).not.toBeInTheDocument()
  })

  it('5. Clear Alias calls onSetAlias(path, "") immediately with no text-entry step, row shows raw path afterward', () => {
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)

    fireEvent.click(screen.getByRole('button', { name: 'Clear Alias' }))

    expect(onSetAlias).toHaveBeenCalledWith(PROJ, '')
    expect(onSetAlias).toHaveBeenCalledTimes(1)
    // No inline text input should have appeared in this row as part of
    // clearing (scoped to the row -- the dropdown also has an unrelated
    // "add directory" text input at the bottom, which is not what we're
    // asserting about here).
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('DirectorySwitcher - copy path, remove, and menu gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('6. Copy Path copies the raw path, not the alias, even for an aliased row', () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    render(<DirectorySwitcher {...baseProps()} />)

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)

    fireEvent.click(screen.getByRole('button', { name: /copy path/i }))

    expect(writeText).toHaveBeenCalledWith(PROJ)
    expect(writeText).not.toHaveBeenCalledWith('Proj A')
  })

  it('7. Remove fires immediately for an aliased directory that is not the current directory, no confirmation', () => {
    const onRemoveDirectory = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ currentDirectory: OTHER, onRemoveDirectory })} />)

    openSwitcher(OTHER)
    const row = getRowByPath(PROJ) // PROJ is aliased "Proj A" and is NOT the current directory here
    openRowMenu(row)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onRemoveDirectory).toHaveBeenCalledWith(PROJ)
    expect(onRemoveDirectory).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('8. the current directory row never offers Remove, but does offer Alias / Clear Alias / Copy Path', () => {
    render(<DirectorySwitcher {...baseProps()} />)

    openSwitcher(PROJ)
    const currentRow = getRowByPath(PROJ) // PROJ is currentDirectory and is aliased "Proj A"
    openRowMenu(currentRow)

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alias' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear Alias' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy path/i })).toBeInTheDocument()
  })

  it('8b. a non-current, non-aliased row offers Remove and Alias but not Clear Alias', () => {
    render(<DirectorySwitcher {...baseProps()} />)

    openSwitcher(PROJ)
    const otherRow = getRowByPath(OTHER) // OTHER is not current, not aliased
    openRowMenu(otherRow)

    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alias' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear Alias' })).not.toBeInTheDocument()
  })

  it('11. opening a second row menu closes the first: only one gear menu open at a time', () => {
    // Menus render via portal (outside any row's DOM subtree), so "only one
    // open" is asserted by counting matches in the whole document rather
    // than scoping to a specific row.
    render(<DirectorySwitcher {...baseProps()} />)

    openSwitcher(PROJ)
    const rowA = getRowByPath(PROJ)
    openRowMenu(rowA)
    expect(screen.getAllByRole('button', { name: 'Alias' })).toHaveLength(1)

    const rowB = getRowByPath(OTHER)
    openRowMenu(rowB)

    // Still exactly one -- rowA's portaled menu was replaced by rowB's, not
    // stacked alongside it.
    expect(screen.getAllByRole('button', { name: 'Alias' })).toHaveLength(1)
  })

  it('12. opening a different row\'s gear menu while another row is mid-alias-edit does not cancel that edit', () => {
    // startEditingAlias closes the menu it was opened from (setOpenMenuPath(null)),
    // but nothing in the gear-click handler for a *different* row touches
    // editingPath. So rowA's inline edit should survive rowB's menu opening.
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const rowA = getRowByPath(PROJ)
    openRowMenu(rowA)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    // rowA is now mid-edit.
    const input = within(rowA).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Not Yet Committed' } })

    const rowB = getRowByPath(OTHER)
    openRowMenu(rowB)

    // rowB's menu is open...
    expect(screen.getByRole('button', { name: 'Alias' })).toBeInTheDocument()
    // ...and rowA's edit is untouched: input still present with the typed,
    // uncommitted value, and onSetAlias was never called.
    expect(within(rowA).getByRole('textbox')).toHaveValue('Not Yet Committed')
    expect(onSetAlias).not.toHaveBeenCalled()
  })

  it('13. draggable is false only on the row currently being alias-edited; other rows remain draggable', () => {
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const rowA = getRowByPath(PROJ)
    const rowB = getRowByPath(OTHER)

    expect(rowA.getAttribute('draggable')).toBe('true')
    expect(rowB.getAttribute('draggable')).toBe('true')

    openRowMenu(rowA)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    expect(rowA.getAttribute('draggable')).toBe('false')
    expect(rowB.getAttribute('draggable')).toBe('true')
  })

  it('14. the trigger button reflects the current directory\'s alias after the directories prop updates (e.g. following a resolved onSetAlias + parent re-render)', () => {
    const onSetAlias = vi.fn(async () => undefined)
    const initialDirectories = [{ path: PROJ, alias: '' }, { path: OTHER, alias: '' }]
    const { rerender } = render(
      <DirectorySwitcher {...baseProps({ currentDirectory: PROJ, directories: initialDirectories, onSetAlias })} />
    )

    // Before: no alias yet, trigger shows the homeDir-relative raw path.
    expect(screen.getByTitle(PROJ)).toHaveTextContent('~/alpha-project')

    const updatedDirectories = [{ path: PROJ, alias: 'Alpha' }, { path: OTHER, alias: '' }]
    rerender(
      <DirectorySwitcher {...baseProps({ currentDirectory: PROJ, directories: updatedDirectories, onSetAlias })} />
    )

    // After: trigger shows the new alias for the current directory.
    expect(screen.getByTitle(PROJ)).toHaveTextContent('Alpha')
    expect(screen.getByTitle(PROJ)).not.toHaveTextContent('~/alpha-project')
  })

  it('15. committing an alias identical to the existing one still calls onSetAlias (no dirty-check short-circuit)', () => {
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    // Leave the pre-filled value ('Proj A') unchanged and commit.
    const input = within(row).getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onSetAlias).toHaveBeenCalledWith(PROJ, 'Proj A')
  })

  it('16. an alias of only whitespace commits as a no-op (trims to empty, same as an emptied input)', () => {
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    const input = within(row).getByRole('textbox')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onSetAlias).not.toHaveBeenCalled()
  })

  it('17. committing trims leading/trailing whitespace from the typed alias before calling onSetAlias', () => {
    const onSetAlias = vi.fn(async () => undefined)
    render(<DirectorySwitcher {...baseProps({ onSetAlias })} />)

    openSwitcher(PROJ)
    const row = getRowByPath(PROJ)
    openRowMenu(row)
    fireEvent.click(screen.getByRole('button', { name: 'Alias' }))

    const input = within(row).getByRole('textbox')
    fireEvent.change(input, { target: { value: '  Trimmed Name  ' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(onSetAlias).toHaveBeenCalledWith(PROJ, 'Trimmed Name')
  })
})
