/**
 * Undo/redo for landmark edits. Snapshots are whole scene graphs captured
 * before each committed edit (delete, move, relabel, place, AI merge), so
 * undo restores positions, names, and review flags exactly. Pure and
 * synchronous: restoring never touches the network.
 */
import type { SceneGraph } from './types'

/** Maximum undo depth, bounding draft storage. */
export const HISTORY_LIMIT = 50

export type GraphHistory = {
  past: SceneGraph[]
  future: SceneGraph[]
}

export function emptyHistory(): GraphHistory {
  return { past: [], future: [] }
}

/** Record the pre-edit graph. A new edit always clears the redo stack. */
export function pushHistory(history: GraphHistory, current: SceneGraph): GraphHistory {
  const past = [...history.past, current].slice(-HISTORY_LIMIT)
  return { past, future: [] }
}

export function canUndo(history: GraphHistory): boolean {
  return history.past.length > 0
}

export function canRedo(history: GraphHistory): boolean {
  return history.future.length > 0
}

/** Step back one edit. Returns null when there is nothing to undo. */
export function undoHistory(
  history: GraphHistory,
  current: SceneGraph,
): { history: GraphHistory; graph: SceneGraph } | null {
  if (history.past.length === 0) return null
  const graph = history.past[history.past.length - 1]
  return {
    history: { past: history.past.slice(0, -1), future: [current, ...history.future] },
    graph,
  }
}

/** Step forward one undone edit. Returns null when there is nothing to redo. */
export function redoHistory(
  history: GraphHistory,
  current: SceneGraph,
): { history: GraphHistory; graph: SceneGraph } | null {
  if (history.future.length === 0) return null
  const [graph, ...future] = history.future
  return {
    history: { past: [...history.past, current].slice(-HISTORY_LIMIT), future },
    graph,
  }
}
