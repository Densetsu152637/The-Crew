import type { AgentRun, AgentStatus, Flow, Panel } from '../types'

// What the panel keeps between runs of one session. The engine holds a plugin's state only for the
// process, so a session resumed later would start with an empty panel; this is the copy that outlives
// the process, stored under the session's id (`$.store`).
//
// Only the telemetry the servers do not keep is stored: the rows (status, model, tokens, cost, times,
// steps), the flow and the panel's settings. Subagent conversations stay with the engine, which fetches
// them from the transcript when a thread is opened.
//
// The engine caps a plugin's whole store at 4 MiB of JSON. So the copy is sized, not counted: each
// session's copy stays under SESSION_BYTES however many subagents it ran (the oldest finished ones are
// folded into one row that carries their totals), and sessions are dropped, least recently saved first,
// only once the copies together pass STORE_BYTES. A session with nothing on its panel is not stored.

export type Snapshot = {
  /** Which idea of the panel wrote it; another one is let go, as a stored value of another shape. */
  shape: 1 | 2
  savedAt: number
  flow: Flow | null
  agents: AgentRun[]
  root: AgentRun | null
  panel: Pick<Panel, 'isCompact' | 'isDoneCollapsed' | 'viewing'>
}

/** One stored session in the index, most recently saved first: its id and its copy's size. */
export type IndexEntry = { id: string; bytes: number }

/** The most one session's copy may take, as JSON text. */
export const SESSION_BYTES = 1024 * 1024
/** The most the copies may take together, leaving room under the engine's 4 MiB for the index. */
export const STORE_BYTES = 3 * 1024 * 1024
/** Index entries kept at most, whatever their size, so the index itself stays small. */
export const INDEX_MAX = 2000
/** The id of the row that carries the totals of the folded subagents. */
export const FOLD_ID = 'crew:folded'

export const snapshotKey = (sessionId: string): string => `session:${sessionId}`
export const INDEX_KEY = 'sessions'

/** The length of `value` as stored: JSON text, its non-ASCII characters at their UTF-8 width. */
export function jsonBytes(value: unknown): number {
  const s = JSON.stringify(value) ?? ''
  let n = s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0x80) n += c >= 0x800 && (c < 0xd800 || c > 0xdfff) ? 2 : c < 0x800 ? 1 : 0
  }
  return n
}

/** Whether a panel holds anything worth keeping. */
export const hasTelemetry = (s: Pick<Snapshot, 'flow' | 'agents' | 'root'>): boolean =>
  s.agents.length > 0 || s.flow !== null || (s.root !== null && (s.root.inputTokens > 0 || s.root.costUsd > 0 || s.root.steps > 0))

const elapsedOf = (a: AgentRun): number =>
  a.endedAt !== undefined ? Math.max(0, a.endedAt - a.startedAt - (a.idleMs ?? 0)) : 0

/** The rows `folded` summed into one: their tokens, cost, steps and time, and how many they were. */
export function foldRows(folded: readonly AgentRun[]): AgentRun {
  let count = 0
  let input = 0
  let output = 0
  let cost = 0
  let steps = 0
  let time = 0
  let failed = 0
  let start = Infinity
  for (const a of folded) {
    const n = a.id === FOLD_ID ? a.folded ?? 0 : 1
    count += n
    input += a.inputTokens || 0
    output += a.outputTokens || 0
    cost += a.costUsd || 0
    steps += a.steps || 0
    time += elapsedOf(a)
    failed += a.id === FOLD_ID ? a.foldedFailed ?? 0 : a.status === 'failed' ? 1 : 0
    if (a.startedAt < start) start = a.startedAt
  }
  if (!Number.isFinite(start)) start = 0
  return {
    id: FOLD_ID,
    type: 'folded',
    role: 'other',
    description: `${count} earlier subagents`,
    model: '',
    status: 'done',
    startedAt: start,
    endedAt: start + time,
    contextTokens: 0,
    contextMax: 0,
    inputTokens: input,
    outputTokens: output,
    costUsd: cost,
    steps,
    round: 0,
    folded: count,
    foldedFailed: failed,
  }
}

/**
 * The rows as a copy keeps them within `budget` bytes: when they are too many, the oldest finished ones
 * (and any earlier fold) become one row carrying their totals, so the panel's totals stay exact. Running
 * rows are never folded, nor the newest ones.
 */
export function fitAgents(agents: readonly AgentRun[], budget: number): AgentRun[] {
  if (jsonBytes(agents) <= budget) return [...agents]
  const sizes = agents.map(a => jsonBytes(a) + 1)
  const foldRowBytes = jsonBytes(foldRows(agents)) + 64
  // Keep rows from the newest back while they fit; every finished row older than that is folded.
  let room = budget - foldRowBytes - 2
  const keep = new Array<boolean>(agents.length).fill(false)
  agents.forEach((a, i) => {
    if (a.status === 'running' && a.id !== FOLD_ID) {
      keep[i] = true
      room -= sizes[i] ?? 0
    }
  })
  for (let i = agents.length - 1; i >= 0; i--) {
    const size = sizes[i] ?? 0
    if (keep[i] || agents[i]?.id === FOLD_ID) continue
    if (size > room) break
    keep[i] = true
    room -= size
  }
  const folded = agents.filter((_, i) => !keep[i])
  const kept = agents.filter((_, i) => keep[i])
  return folded.length > 0 ? [foldRows(folded), ...kept] : kept
}

/** The snapshot within SESSION_BYTES. */
export function fitSnapshot(s: Snapshot, budget = SESSION_BYTES): Snapshot {
  const rest = jsonBytes({ ...s, agents: [] })
  return { ...s, agents: fitAgents(s.agents, budget - rest) }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const STATUSES = new Set<AgentStatus>(['running', 'done', 'failed', 'idle'])
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** A stored row as the panel takes it back: undefined for one that is not a row; a bad count reads 0. */
function reviveRow(v: unknown): AgentRun | undefined {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.startedAt !== 'number') return undefined
  const a = v as unknown as AgentRun
  return {
    ...a,
    type: typeof a.type === 'string' ? a.type : 'other',
    description: typeof a.description === 'string' ? a.description : '',
    model: typeof a.model === 'string' ? a.model : '',
    status: STATUSES.has(a.status) ? a.status : 'done',
    contextTokens: num(a.contextTokens),
    contextMax: num(a.contextMax),
    inputTokens: num(a.inputTokens),
    outputTokens: num(a.outputTokens),
    costUsd: num(a.costUsd),
    steps: num(a.steps),
    round: num(a.round),
  }
}

/**
 * A stored snapshot as the panel resumes it: nothing runs in a process that has just started, so a run
 * that was running is failed at the time it was saved, and the main session rests. A row that cannot be
 * read is let go alone; undefined only for a value that is not a snapshot at all. Copies of shape 1 also
 * held thread text, which is ignored.
 */
export function reviveSnapshot(stored: unknown): Snapshot | undefined {
  if (!isObject(stored) || (stored.shape !== 1 && stored.shape !== 2) || !Array.isArray(stored.agents)) return undefined
  const savedAt = num(stored.savedAt)
  const rest = (a: AgentRun): AgentRun => (a.status === 'running' ? { ...a, status: 'failed', endedAt: savedAt } : a)
  const agents = stored.agents.map(reviveRow).filter((a): a is AgentRun => a !== undefined).map(rest)
  const root = reviveRow(stored.root)
  const panel = isObject(stored.panel) ? stored.panel : {}
  const flow = isObject(stored.flow) ? (stored.flow as unknown as Flow) : null
  return {
    shape: 2,
    savedAt,
    flow: flow ? { ...flow, running: 0 } : null,
    agents,
    root: root ? { ...root, status: root.status === 'running' ? 'idle' : root.status } : null,
    panel: {
      isCompact: panel.isCompact === true,
      isDoneCollapsed: panel.isDoneCollapsed === true,
      viewing: typeof panel.viewing === 'string' ? panel.viewing : '',
    },
  }
}

/** A stored index as entries; the shape-1 index (a list of ids) reads with unknown sizes. */
export function readIndex(index: unknown): IndexEntry[] {
  if (!Array.isArray(index)) return []
  const seen = new Set<string>()
  const out: IndexEntry[] = []
  for (const x of index) {
    const e = typeof x === 'string' ? { id: x, bytes: 0 } : isObject(x) && typeof x.id === 'string' ? { id: x.id, bytes: num(x.bytes) } : undefined
    if (!e || seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

/**
 * The index with `id` first at `bytes`, and the ids it no longer holds: the least recently saved go once
 * the copies together pass `budget` or the index passes INDEX_MAX. The session being saved always stays.
 */
export function touchIndex(index: unknown, id: string, bytes: number, budget = STORE_BYTES): { index: IndexEntry[]; dropped: string[] } {
  const all = [{ id, bytes }, ...readIndex(index).filter(e => e.id !== id)]
  let total = 0
  const kept: IndexEntry[] = []
  const dropped: string[] = []
  for (const [i, e] of all.entries()) {
    if (i === 0 || (total + e.bytes <= budget && kept.length < INDEX_MAX)) {
      kept.push(e)
      total += e.bytes
    } else {
      dropped.push(e.id)
    }
  }
  return { index: kept, dropped }
}

/** The index with `id` moved first, its size kept; unchanged when it holds no `id`. A session in use again is kept longest. */
export function promote(index: unknown, id: string): IndexEntry[] | undefined {
  const all = readIndex(index)
  const at = all.findIndex(e => e.id === id)
  if (at <= 0) return undefined
  const [entry] = all.splice(at, 1)
  return entry ? [entry, ...all] : undefined
}
