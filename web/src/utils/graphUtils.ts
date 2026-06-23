import type { Revision } from '../types/diff'

export interface GraphRow {
  col: number
  colorIndex: number
  parentCols: number[]
  mergeLanes: number[]
  prevActiveCols: number[]
  nextActiveCols: number[]
  laneColors: Map<number, number>
}

const LANE_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
]

export function getLaneColor(colorIndex: number): string {
  return LANE_COLORS[colorIndex % LANE_COLORS.length]
}

export function computeGraph(revisions: Revision[]): GraphRow[] {
  const revIds = new Set(revisions.map(r => r.id))
  const lanes: (string | null)[] = []
  const laneColorArr: number[] = []
  let nextColor = 0

  return revisions.map(rev => {
    // Snapshot of active cols before processing this row
    const prevActiveCols: number[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) prevActiveCols.push(i)
    }

    // Find all lanes that are waiting for this revision
    const myLanes: number[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === rev.id) myLanes.push(i)
    }

    let myCol: number
    let myColorIndex: number

    if (myLanes.length > 0) {
      myCol = myLanes[0]
      myColorIndex = laneColorArr[myCol] ?? nextColor++
      // Free additional lanes that were also waiting for this revision (merge)
      for (let i = 1; i < myLanes.length; i++) {
        lanes[myLanes[i]] = null
      }
    } else {
      // New branch — find first free slot or extend
      myCol = lanes.indexOf(null)
      if (myCol === -1) {
        myCol = lanes.length
        lanes.push(null)
      }
      myColorIndex = nextColor++
      laneColorArr[myCol] = myColorIndex
    }

    // Only include parents that are in the displayed revision set
    const parents = (rev.parents ?? []).filter(p => revIds.has(p))
    const parentCols: number[] = []

    if (parents.length === 0) {
      lanes[myCol] = null
    } else {
      // First parent continues in the same column
      lanes[myCol] = parents[0]
      parentCols.push(myCol)

      // Additional parents get their own lanes
      for (let i = 1; i < parents.length; i++) {
        // Check if this parent is already tracked
        let pCol = lanes.indexOf(parents[i])
        if (pCol === -1) {
          pCol = lanes.indexOf(null)
          if (pCol === -1) {
            pCol = lanes.length
            lanes.push(null)
          }
          lanes[pCol] = parents[i]
          laneColorArr[pCol] = nextColor++
        }
        parentCols.push(pCol)
      }
    }

    // Snapshot of active cols after processing this row
    const nextActiveCols: number[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) nextActiveCols.push(i)
    }

    // Build the color map for this row's rendering (includes all relevant cols)
    const laneColors = new Map<number, number>()
    for (const c of prevActiveCols) laneColors.set(c, laneColorArr[c] ?? 0)
    laneColors.set(myCol, myColorIndex)
    for (const c of parentCols) {
      if (laneColorArr[c] !== undefined) laneColors.set(c, laneColorArr[c])
    }
    // Preserve merge lane colors before they were freed
    for (const mc of myLanes.slice(1)) {
      laneColors.set(mc, laneColorArr[mc] ?? 0)
    }

    return {
      col: myCol,
      colorIndex: myColorIndex,
      parentCols,
      mergeLanes: myLanes.slice(1),
      prevActiveCols,
      nextActiveCols,
      laneColors,
    }
  })
}

export function maxGraphCols(rows: GraphRow[]): number {
  return rows.reduce((m, r) => {
    const cols = [r.col, ...r.parentCols, ...r.prevActiveCols, ...r.nextActiveCols]
    return Math.max(m, cols.length > 0 ? Math.max(...cols) + 1 : 1)
  }, 1)
}
