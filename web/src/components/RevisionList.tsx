import { useState, useRef, useLayoutEffect } from 'react'
import type { Revision, VCSBackend } from '../types/diff'
import CopyButton from './CopyButton'
import { formatRelativeTime } from '../utils/time'
import { computeGraph, maxGraphCols, getLaneColor, type GraphRow } from '../utils/graphUtils'

interface RevisionListProps {
  revisions: Revision[]
  loading: boolean
  selectedRevision: string | null
  onSelectRevision: (revisionId: string | null) => void
  backend: VCSBackend
  reviewedRevisions?: Set<string>
}

const COL_W = 12
const NODE_R = 3

function GraphCell({ row, totalCols, rowHeight, additions, deletions }: {
  row: GraphRow; totalCols: number; rowHeight: number
  additions?: number; deletions?: number
}): React.ReactElement {
  const W = COL_W
  const H = rowHeight
  const nx = row.col * W + W / 2
  const ny = H / 2
  const graphW = Math.max(totalCols * W, W)
  const hasStats = additions !== undefined || deletions !== undefined
  const width = graphW + (hasStats ? 50 : 0)

  const getColor = (col: number): string => getLaneColor(row.laneColors.get(col) ?? 0)

  return (
    <svg
      width={width}
      height={H}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Pass-through lanes (straight vertical lines) */}
      {row.prevActiveCols
        .filter(
          c =>
            c !== row.col &&
            !row.mergeLanes.includes(c) &&
            row.nextActiveCols.includes(c)
        )
        .map(c => (
          <line
            key={`pt-${c}`}
            x1={c * W + W / 2}
            y1={0}
            x2={c * W + W / 2}
            y2={H}
            stroke={getColor(c)}
            strokeWidth={1.5}
          />
        ))}

      {/* Incoming line from above to node */}
      {row.prevActiveCols.includes(row.col) && (
        <line
          x1={nx}
          y1={0}
          x2={nx}
          y2={ny}
          stroke={getColor(row.col)}
          strokeWidth={1.5}
        />
      )}

      {/* Merge lines: other lanes converging into this node */}
      {row.mergeLanes.map(mc => {
        const mx = mc * W + W / 2
        return (
          <path
            key={`merge-${mc}`}
            d={`M ${mx} 0 C ${mx} ${ny} ${nx} 0 ${nx} ${ny}`}
            stroke={getColor(mc)}
            strokeWidth={1.5}
            fill="none"
          />
        )
      })}

      {/* Outgoing lines from node to parent columns */}
      {row.parentCols.map((pc, i) => {
        const px = pc * W + W / 2
        if (pc === row.col) {
          return (
            <line
              key={`out-${i}`}
              x1={nx}
              y1={ny}
              x2={px}
              y2={H}
              stroke={getColor(pc)}
              strokeWidth={1.5}
            />
          )
        }
        return (
          <path
            key={`out-${i}`}
            d={`M ${nx} ${ny} C ${nx} ${H} ${px} ${ny} ${px} ${H}`}
            stroke={getColor(pc)}
            strokeWidth={1.5}
            fill="none"
          />
        )
      })}

      {/* Node circle */}
      <circle cx={nx} cy={ny} r={NODE_R} fill={getLaneColor(row.colorIndex)} />

      {/* Diff stats */}
      {hasStats && (
        <text x={graphW + 3} y={H - 4} fontSize="8" fontFamily="monospace">
          <tspan fill="var(--color-diff-add-fg, #16a34a)">+{additions ?? 0}</tspan>
          <tspan dx="2" fill="var(--color-diff-del-fg, #dc2626)">-{deletions ?? 0}</tspan>
        </text>
      )}
    </svg>
  )
}

const ROW_HEIGHT = 44

function RevisionRow({
  rev,
  graphRow,
  totalCols,
  isSelected,
  onSelect,
  reviewedRevisions,
  backend,
}: {
  rev: Revision
  graphRow: GraphRow
  totalCols: number
  isSelected: boolean
  onSelect: () => void
  reviewedRevisions?: Set<string>
  backend: VCSBackend
}): React.ReactElement {
  const contentRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (contentRef.current) setRowHeight(contentRef.current.offsetHeight)
    })
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={`w-full text-left text-xs border-b border-edge-subtle transition-colors cursor-pointer ${
        isSelected
          ? 'bg-accent-muted text-accent-emphasis'
          : 'text-fg hover:bg-surface-raised'
      }`}
      style={{ minHeight: ROW_HEIGHT, display: 'flex', alignItems: 'stretch' }}
    >
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'stretch' }}>
        <GraphCell row={graphRow} totalCols={totalCols} rowHeight={rowHeight} additions={rev.additions} deletions={rev.deletions} />
      </div>

      <div ref={contentRef} className="flex flex-col justify-center py-1.5 pr-2 min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="font-mono text-[10px] px-1 py-0.5 rounded bg-surface-inset text-fg-muted shrink-0 select-text cursor-text"
            onClick={(e) => { e.stopPropagation(); }}
            onMouseDown={(e) => { e.stopPropagation(); }}
            title={rev.id}
          >
            {rev.shortId}
          </span>
          <CopyButton value={rev.id} title="Copy commit ID" />
          {reviewedRevisions?.has(rev.isWorkingCopy && backend === 'jj' ? 'working-copy' : rev.id) && (
            <span className="text-[10px] text-success shrink-0" title="All files reviewed">✓</span>
          )}
          <span className="truncate">
            {rev.description || '(no description)'}
          </span>
          {rev.isWorkingCopy && (
            <span className="shrink-0 text-[10px] px-1 py-0.5 rounded bg-accent-muted text-accent-emphasis">
              @
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-fg-muted flex-wrap">
          <span className="truncate">{rev.author}</span>
          <span>·</span>
          <span className="shrink-0">{formatRelativeTime(rev.timestamp)}</span>
          {rev.bookmarks && rev.bookmarks.map((b) => (
            <span
              key={b}
              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-mono leading-none"
              style={{ background: 'var(--color-bookmark-bg)', color: 'var(--color-bookmark-fg)' }}
            >
              {b}
              <CopyButton value={b} title={`Copy bookmark "${b}"`} />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function RevisionList({
  revisions,
  loading,
  selectedRevision,
  onSelectRevision,
  backend,
  reviewedRevisions,
}: RevisionListProps): React.ReactElement {
  const [filter, setFilter] = useState('')

  const query = filter.trim().toLowerCase()
  const filteredRevisions = query
    ? revisions.filter(rev =>
        rev.id.toLowerCase().includes(query) ||
        rev.shortId.toLowerCase().includes(query) ||
        rev.description.toLowerCase().includes(query)
      )
    : revisions

  const graphRows = computeGraph(filteredRevisions)
  const totalCols = maxGraphCols(graphRows)

  if (loading) {
    return (
      <div className="text-xs text-fg-subtle p-2">
        Loading revisions...
      </div>
    )
  }

  return (
    <div className="overflow-y-auto">
      {/* Filter input */}
      <div className="px-2 py-1.5 border-b border-edge">
        <input
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); }}
          placeholder="Filter by ID or message…"
          className="w-full px-2 py-1 text-xs bg-surface border border-edge rounded text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Working copy option — only for git, since in jj the first revision IS the working copy */}
      {backend === 'git' && !query && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => { onSelectRevision(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRevision(null); } }}
          className={`w-full text-left px-2 py-1.5 text-xs border-b border-edge-subtle transition-colors cursor-pointer ${
            selectedRevision === null
              ? 'bg-accent-muted text-accent-emphasis'
              : 'text-fg hover:bg-surface-raised'
          }`}
        >
          <div className="flex items-center gap-1">
            {reviewedRevisions?.has('working-copy') && (
              <span className="text-[10px] text-success shrink-0" title="All files reviewed">✓</span>
            )}
            <span className="font-medium">Working copy changes</span>
          </div>
        </div>
      )}

      {filteredRevisions.length === 0 && query && (
        <div className="px-2 py-3 text-xs text-fg-subtle text-center">No revisions match</div>
      )}

      {filteredRevisions.map((rev, idx) => {
        const isSelected = rev.isWorkingCopy && backend === 'jj'
          ? selectedRevision === null
          : selectedRevision === rev.id

        return (
          <RevisionRow
            key={rev.id}
            rev={rev}
            graphRow={graphRows[idx]}
            totalCols={totalCols}
            isSelected={isSelected}
            onSelect={() => {
              if (rev.isWorkingCopy && backend === 'jj') {
                onSelectRevision(null)
              } else {
                onSelectRevision(rev.id)
              }
            }}
            reviewedRevisions={reviewedRevisions}
            backend={backend}
          />
        )
      })}
    </div>
  )
}
