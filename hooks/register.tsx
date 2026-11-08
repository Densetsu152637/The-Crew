import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionMessage, SessionUsage, Timer } from 'claude-code'

import type { AgentRun, Flow, Panel, Phase, PlannedTask } from '../types'

import { AGENT_CHARS, INDEX_KEY, keepThread, keepThreads, reviveSnapshot, snapshotKey, TOOL_ARG_KEYS, touchIndex } from './keep'
import type { KeptMessage, Snapshot } from './keep'
import { CLAY, COSTUMES, CRAB_BOX, CRAB_CSS, CRAB_SCALE, crab, colorOf, TIER_COLOR } from './crabs'

// the-crew: a fork of johnnyvizz's savvy-progress (MIT) that adds the main
// session's own row and a costume per workflow profile. Every namespace below
// (state keys, pane, command, tools) is its own, so both mods can load together.
const flow = atom({ plugin: 'the-crew', key: 'flow' } as const, null)
const agents = atom({ plugin: 'the-crew', key: 'agents' } as const, [])
const panel = atom({ plugin: 'the-crew', key: 'panel' } as const, {
  isCompact: false,
  isDoneCollapsed: false,
  autoOpenedFor: '',
  viewing: '',
})
const now = atom({ plugin: 'the-crew', key: 'now' } as const, 0)
// The main session's own usage, drawn as the panel's pinned first row.
const root = atom({ plugin: 'the-crew', key: 'root' } as const, null)
// Counts the rows the viewed subagent's conversation has kept: the open thread reads it, so a new row redraws the pane.
const threadRows = atom({ plugin: 'the-crew', key: 'threadRows' } as const, 0)

const TOOL = 'mcp__the-crew__progress'
const STEP_TOOL = 'mcp__the-crew__step'
const COMMAND = 'crew'
const ROOT_ID = 'root'
// Added to the end of each savvy worker's brief. Their system prompt words step
// reporting as a condition ("if the step tool appears among your tools") and they
// skip it even with the tool listed; the same request in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`
const PANE = 'crew-agents'
const PHASES: readonly Phase[] = ['plan', 'design', 'delegate', 'review', 'close']
const TIERS: readonly string[] = ['fable', 'heavy', 'careful', 'medium', 'light']
// Workflow profiles a dispatched agent can carry; `root` is the main session's row alone.
const PROFILES: readonly string[] = [
  'explorer', 'implementer', 'validator', 'critic', 'documenter', 'tester', 'manager',
  'researcher', 'debugger', 'analyst', 'architect', 'auditor', 'navigator', 'inspector',
]
// Claude Code's built-in subagent types, drawn as the profile costume they overlap with,
// or as a costume of their own (`generalist`, `guide`, `statusline`).
const BUILTIN_ROLE: Readonly<Record<string, string>> = {
  Explore: 'explorer', explore: 'explorer', Plan: 'architect', plan: 'architect', 'web-fetch': 'researcher',
  'general-purpose': 'generalist', claude: 'generalist', 'claude-code-guide': 'guide', 'statusline-setup': 'statusline',
}
// The brief's tag line, e.g. `Role: leaf; Profile: implementer`: the first match counts.
const PROFILE_TAG = /\bProfile:\s*([a-z-]+)/i
// The tools' schemas are advice to the model, not a check: what a call may ask
// the band and the panel to draw is bounded here.
const MAX_TASKS = 200
const MAX_AFTER = 20
const MAX_TITLE = 120
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'

type ProgressInput = {
  title?: string
  total?: number
  done?: number
  phase?: Phase
  finished?: boolean
  tasks?: { title?: string; tier?: string; after?: number[] }[]
}

// ---------------------------------------------------------------------------
// The panel's words, English only (Russian and Hebrew were removed in 0.14.1).

const STRINGS = {
  en: {
    pane: 'Agents',
    cost: 'Cost',
    input: 'Input',
    output: 'Output',
    time: 'Time',
    collapse: 'Collapse',
    expand: 'Expand',
    running: 'Running',
    finished: 'Finished',
    planned: 'Planned',
    empty: 'No subagents yet.',
    round: 'round',
    failed: 'error',
    after: 'after',
    inWord: 'in',
    outWord: 'out',
    agentsCount: 'agents',
    isRunning: 'running',
    isFinished: 'finished',
    isPlanned: 'planned',
    opened: 'Agents panel opened.',
    closed: 'Agents panel closed.',
    done: 'Done',
    plan: 'Plan',
    design: 'Design',
    tasks: 'Tasks',
    review: 'Review',
    busy: 'running',
    ctx: 'ctx',
    main: 'Main session',
    isIdle: 'idle',
    backToAgents: 'Agents',
    noThread: 'No messages yet.',
    tier: {
      light: 'light', medium: 'medium', careful: 'careful', heavy: 'heavy', fable: 'fable', other: 'other',
      root: 'root', manager: 'manager', explorer: 'explorer', implementer: 'implementer', validator: 'validator',
      critic: 'critic', documenter: 'documenter', tester: 'tester', researcher: 'researcher', debugger: 'debugger',
      analyst: 'analyst', architect: 'architect', auditor: 'auditor', navigator: 'navigator', inspector: 'inspector',
      generalist: 'generalist', guide: 'guide', statusline: 'statusline',
    },
    effort: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  },
} as const

const tr = () => STRINGS.en

// Tier and effort words as shown; anything unknown shows as it came.
const tierWord = (tier: string): string => (tr().tier as Record<string, string>)[tier] ?? tier
const effortWord = (effort: string): string => (tr().effort as Record<string, string>)[effort] ?? effort

const blank = (): Flow => ({
  title: 'savvy-flow',
  total: 0,
  done: 0,
  running: 0,
  phase: 'plan',
  isFinished: false,
  tasks: [],
})

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
  !prev || prev.isFinished || (input.title !== undefined && clip(input.title.trim(), MAX_TITLE) !== prev.title)

// Only a known tier is kept: the name is later a key into the tier tables.
const tierName = (v: string): string => {
  const t = v.replace(/^savvy-/, '').trim().toLowerCase()
  return TIERS.includes(t) ? t : ''
}

const cleanTasks = (tasks: ProgressInput['tasks']): PlannedTask[] | undefined =>
  tasks
    ?.filter(t => t.title?.trim())
    .slice(0, MAX_TASKS)
    .map(t => ({
      title: (t.title ?? '').trim(),
      tier: tierName(t.tier ?? ''),
      after: (t.after ?? []).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_AFTER),
    }))

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
  // A new title means a new flow: never carry counters over from an earlier one.
  const base = isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev }
  const tasks = cleanTasks(input.tasks) ?? base.tasks
  const total = Math.min(MAX_TASKS, Math.max(0, Math.round(input.total ?? (input.tasks ? tasks.length : base.total))))
  const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)))
  const phase = input.phase && PHASES.includes(input.phase) ? input.phase : base.phase
  return {
    ...base,
    title: clip(input.title?.trim() || base.title, MAX_TITLE),
    total,
    done,
    phase: input.finished ? 'close' : phase,
    isFinished: input.finished === true,
    tasks,
  }
}

const label = (f: Flow): string => {
  const s = tr()
  if (f.isFinished) return s.done
  if (f.phase === 'plan') return s.plan
  if (f.phase === 'design') return s.design
  const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${s.busy}`
  return `${f.phase === 'review' ? s.review : s.tasks} ${count}`
}

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the crab live in one drawing; only the count and
// the dismiss are Buttons beside it.
const H = 22
const BAR_H = 16
const CRAB_W = 26
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

// CJK, fullwidth forms and emoji advance about 1em; at 0.56em a Chinese title was sized at half its width and the bar drew over it.
// 中日韩文字、全角标点和 emoji 约占 1em；按 0.56em 算时中文标题宽度被低估近一半，进度条会压到标题上。
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF01-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

// Rough advance of system UI text, in em; good enough to size the title's slot.
const charEm = (ch: string): number =>
  WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56

const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// Cuts `s` to fit `maxW` pixels, with an ellipsis when it had to cut.
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

// Pixels twinkle in four out-of-phase groups while the bar's work runs. A drawing that is loaded again
// starts its animations over, so each group's delay is set from the clock at the time of drawing: the
// restart then lands where the cycle would have been, and the twinkle does not jump. Per group: its
// period and its offset, in seconds.
const BAR_GROUPS: [period: number, offset: number][] = [[2.2, 0], [2.8, 0.7], [1.9, 1.3], [3.3, 0.4]]
const barMotionCss = (at: number): string =>
  `${BAR_GROUPS.map(([period, offset], i) => `.t${i}{animation:tw ${period}s ease-in-out -${(((at / 1000 + offset) % period)).toFixed(2)}s infinite}`).join('')}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
`

const rowSvg = (f: Flow, W: number, isWorking: boolean, at: number): string => {
  // The title takes what it needs, up to 40% of the row; the bar takes the rest.
  const title = fitText(f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const runW = f.total ? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total) : 0
  // Only a bar with work under way moves; a finished or waiting one is still, with no animation at all.
  const isMoving = isWorking && !f.isFinished
  // The pixels twinkle in four out-of-phase groups, so four elements animate, not hundreds of rects.
  const dots: string[][] = [[], [], [], []]
  const faint: string[][] = [[], [], [], []]
  const group = (rects: string[][], fill: string, extra = ''): string =>
    rects
      .map((r, i) => (r.length ? `<g${isMoving ? ` class="t${i}"` : ''} fill="${fill}"${extra}>${r.join('')}</g>` : ''))
      .join('')

  // Dithered fill: sparse at the start, dense toward the head.
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots[Math.floor(noise(r, c) * 4)]?.push(`<rect x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // Handed to workers, not yet accepted: a faint second layer.
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint[Math.floor(noise(r + 5, c) * 4)]?.push(`<rect x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }

  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }

  const text = label(f)
  const pillW = Math.round(18 + text.length * 6.6)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const percent = `${Math.round(ratio(f) * 100)}%`
  const titleAt = 'x="16"'
  const percentAt = `x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end"`
  const crabW = CRAB_BOX * 0.8

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
${isMoving ? barMotionCss(at) : ''}</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" ${titleAt} y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
${group(dots, color)}
${group(faint, color, ' opacity="0.45"')}
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" ${percentAt} font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${isWorking ? CRAB_CSS : ''}${crab(W - CRAB_W + 1, 0, 'other', false, isWorking, 0.8)}
</svg>`
}

const barText = (f: Flow, width: number): string => {
  const filled = Math.round(width * ratio(f))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// ---------------------------------------------------------------------------
// Agents panel: every subagent of the session, plus the tasks the flow planned.

const TIER_MODEL: Record<string, [model: string, effort: string]> = {
  fable: ['Fable', 'high'],
  heavy: ['Opus', 'xhigh'],
  careful: ['Opus', 'high'],
  medium: ['Opus', 'medium'],
  light: ['Opus', 'low'],
}

// "Opus · xhigh", with the effort word; '' for an unknown tier.
const tierModel = (tier: string): string => {
  const m = TIER_MODEL[tier]
  return m ? `${m[0]} · ${effortWord(m[1])}` : ''
}

// "Opus 5.5 · low" for a run, or just the model when no effort was seen.
const runModel = (a: AgentRun): string => (a.effort ? `${modelName(a.model)} · ${effortWord(a.effort)}` : modelName(a.model))

// USD per million tokens: input, output, cache read, cache write. The first row that
// matches a model id wins, so a release sits above its family.
// The engine reports tokens, not money, so the panel's cost is an estimate. It reports
// one cache-write count with no split by lifetime; writes are priced at the 1-hour
// rate (2x input), which is what Claude Code writes on a subscription.
type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]

// Haiku 5.5 is priced by prompt length: a request whose prompt (input, cache reads and
// cache writes together) is over 100,000 tokens pays these prices instead.
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const priceOf = (model: string, prompt: number): Price => {
  const id = model.toLowerCase()
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG
  return PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8]
}

// `isRequest` says the usage is one model request, which is what a prompt-length price
// is set by; a turn's sum is priced at the model's ordinary prices.
const costOf = (model: string, u: Usage, isRequest: boolean): number => {
  const prompt = isRequest ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0
  const [i, o, r, w] = priceOf(model, prompt)
  return (
    ((u.input_tokens || 0) * i +
      (u.output_tokens || 0) * o +
      (u.cache_read_input_tokens || 0) * r +
      (u.cache_creation_input_tokens || 0) * w) /
    1e6
  )
}

// Haiku 4.5 and the Claude 3 models have a 200K window; the rest, Haiku 5.5 included, 1M.
const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

// `savvy-careful`, or `savvy-flow:savvy-careful` when the agents ship in a plugin.
const tierOf = (type: string): string => {
  const bare = type.replace(/^[^:]*:/, '')
  const t = bare.replace(/^savvy-/, '').toLowerCase()
  return Object.hasOwn(TIER_COLOR, t) && bare.startsWith('savvy-') ? t : 'other'
}

// The role a dispatched agent is drawn as, first match wins: (a) its type names a
// profile (`implementer`, or `plugin:implementer`); (b) its brief carries a tag line
// such as `Role: leaf; Profile: implementer`, the first `Profile:` counting; (c) a
// built-in type (`Explore`, `general-purpose`, ...); (d) a `savvy-*` tier; else `other`. A tag naming no known profile falls through to (c).
const roleOfSpawn = (type: string, prompt: string): string => {
  const bare = type.replace(/^[^:]*:/, '').trim().toLowerCase()
  if (PROFILES.includes(bare)) return bare
  const tag = PROFILE_TAG.exec(prompt)?.[1]?.toLowerCase() ?? ''
  if (PROFILES.includes(tag)) return tag
  const builtin = Object.hasOwn(BUILTIN_ROLE, type.replace(/^[^:]*:/, '').trim()) ? BUILTIN_ROLE[type.replace(/^[^:]*:/, '').trim()] : undefined
  return builtin ?? tierOf(type)
}

// A run's role: what the spawn detected, else (runs stored before roles were) its tier.
const roleOf = (a: AgentRun): string => a.role ?? tierOf(a.type)

// A run's costume: its role's, else the plain crab (savvy tiers have none since 0.4.0).
const costumeOf = (a: AgentRun): string => {
  const role = roleOf(a)
  return Object.hasOwn(COSTUMES, role) ? role : 'other'
}

// The word under a run's title: its role, or its type when it has none.
const roleLabel = (a: AgentRun): string => {
  const role = roleOf(a)
  const bare = a.type.replace(/^[^:]*:/, '').trim()
  // A built-in type shows its own name, so it is not mistaken for the profile it borrows.
  if (role === 'other' || (Object.hasOwn(BUILTIN_ROLE, bare) && BUILTIN_ROLE[bare] === role)) return a.type
  return tierWord(role)
}

const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const fmtTokens = (n: number): string =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

// "12.34M in · 45k out".
const fmtInOut = (t: { input: number; output: number }): string => `${fmtTokens(t.input)} ${tr().inWord} · ${fmtTokens(t.output)} ${tr().outWord}`

const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const elapsed = (a: AgentRun, at: number): number => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt - (a.idleMs ?? 0)

// A finished run reused (resumed by a message, a turn started in its loop) is running
// again: its totals stay, and the time it sat finished is left out of its elapsed time.
const reactivated = (a: AgentRun, at: number): AgentRun =>
  a.status === 'running'
    ? a
    : { ...a, status: 'running', endedAt: undefined, idleMs: (a.idleMs ?? 0) + (a.endedAt === undefined ? 0 : Math.max(0, at - a.endedAt)) }

// What a reused agent is handed: SendMessage's `summary` and its message, or the
// message alone a resume or a waking turn carries.
type Task = { summary?: string; prompt?: string }

// A task's title: its summary, else its message's first line.
const taskTitle = (t: Task): string =>
  clip((t.summary?.trim() || (t.prompt ?? '').split('\n').find(l => l.trim()) || '').trim().replace(/\s+/g, ' '), 80)

// A finished row given a new task is running again under the task's title: its role
// follows a new brief's `Profile:` tag and its reported steps start over. A running
// row is left as it is: a message to a busy agent waits behind its task.
const reused = (a: AgentRun, at: number, task: Task = {}): AgentRun => {
  if (a.status === 'running') return a
  const title = taskTitle(task)
  if (!title) return reactivated(a, at)
  const tag = PROFILE_TAG.exec(task.prompt ?? '')?.[1]?.toLowerCase() ?? ''
  return {
    ...reactivated(a, at),
    description: title,
    role: PROFILES.includes(tag) ? roleOfSpawn(a.type, task.prompt ?? '') : a.role,
    stepDone: undefined,
    stepTotal: undefined,
    stepNote: undefined,
  }
}

// The list with one agent's row renewed and moved last, the newest under Running.
const renew = (list: AgentRun[], agentId: string, at: number, task?: Task): AgentRun[] => {
  const row = list.find(a => a.agentId === agentId)
  if (!row || row.status === 'running') return list
  return [...list.filter(a => a !== row), reused(row, at, task)]
}

type Planned = PlannedTask & { n: number }

const plannedOf = (f: Flow | null, list: AgentRun[]): Planned[] => {
  if (!f || f.isFinished) return []
  const started = new Set(list.map(a => norm(a.description)))
  return (f.tasks ?? []).map((t, i) => ({ ...t, n: i + 1 })).filter(t => !started.has(norm(t.title)))
}

const totals = (list: AgentRun[], at: number) => {
  const cost = list.reduce((s, a) => s + a.costUsd, 0)
  // `|| 0`: a row kept from before the split has neither count.
  const input = list.reduce((s, a) => s + (a.inputTokens || 0), 0)
  const output = list.reduce((s, a) => s + (a.outputTokens || 0), 0)
  const start = Math.min(...list.map(a => a.startedAt))
  const end = Math.max(...list.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return { cost, input, output, time: list.length ? end - start : 0 }
}

// --- desktop drawings: each row is one SVG, as the band above the prompt is.

// The pane's backdrop: a dotted grid as tall as the content laid over it; the
// row SVGs are transparent, so it shows through between their marks.
const GRID_STEP = 16
// A Text or Button row on the desktop is about 20px; the grid errs taller.
const LINE_H = 24
// The engine refuses an Svg taller than 4096px, so a long grid is stacked from
// tiles of at most this height; a multiple of GRID_STEP keeps the dots aligned.
const GRID_TILE = 4096
const gridTiles = (H: number) => Array.from({ length: Math.ceil(H / GRID_TILE) }, (_, i) => Math.min(GRID_TILE, H - i * GRID_TILE))
const gridSvg = (W: number, H: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>.d{fill:#d9d8d4}@media (prefers-color-scheme: dark){.d{fill:#3a3a38}}</style>
<defs><pattern id="g" width="${GRID_STEP}" height="${GRID_STEP}" patternUnits="userSpaceOnUse"><circle class="d" cx="${GRID_STEP / 2}" cy="${GRID_STEP / 2}" r="1"/></pattern></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
</style>`

// Only a drawing with a running mark carries this; finished and idle drawings hold no animation.
const LIVE_CSS = `<style>.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}</style>`

const statusMark = (x: number, y: number, status: string, color: string): string => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  // The main session between turns: a quiet ring in its own colour.
  if (status === 'idle') return `<circle cx="${x}" cy="${y}" r="3.5" fill="none" stroke="${color}" stroke-width="1.4"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

// Text that starts at x, and text that ends at x (right-aligned).
const startText = (x: number, y: number): string => `x="${x}" y="${y}"`
const endText = (x: number, y: number): string => `x="${x}" y="${y}" text-anchor="end"`

// A running time that counts by itself. The desktop loads a drawing anew whenever its markup changes, and
// a time written as text changed it every second: a new image a second per running row, which the app
// kept. Each place of the time is instead a strip of glyphs moved by a stepped CSS animation whose delay is
// set from the elapsed time at drawing, so the markup holds while the run goes on and is redrawn once a
// minute (DESKTOP_MS) to correct a strip that was loaded again. Per strip: its glyphs, and the seconds
// each shows for.
type Strip = { glyphs: string[]; unit: number }
const DIGITS = [...'0123456789']
// The minutes' tens with the hours before them, over ten hours: nothing under ten minutes, then 1–5, then 1:0 on.
const HEAD = Array.from({ length: 60 }, (_, i) => {
  const h = Math.floor(i / 6)
  const t = i % 6
  return h ? `${h}:${t}` : t ? String(t) : ''
})
// The head strip turns over at ten hours; a longer run is written as text.
const CLOCK_MAX = 10 * 3600_000 - 120_000
const SECONDS: Strip = { glyphs: DIGITS, unit: 1 }
const TENS: Strip = { glyphs: DIGITS.slice(0, 6), unit: 10 }
const MINUTES: Strip = { glyphs: DIGITS, unit: 60 }
const HEADS: Strip = { glyphs: HEAD, unit: 600 }

const digitW = (size: number): number => size * 0.6
const colonW = (size: number): number => size * 0.32

// The time's width as it will be by the next redraw, so it does not grow into the text before it.
const clockWidth = (ms: number, size: number): number => {
  const s = Math.floor((ms + 2 * DESKTOP_MS) / 1000)
  const dw = digitW(size)
  return 3 * dw + colonW(size) + (s >= 3600 ? 2 * dw + colonW(size) : s >= 600 ? dw : 0)
}

// The time `ms` ending at x, on the baseline y; `attrs` styles its glyphs as the text around it.
const clock = (x: number, y: number, size: number, ms: number, attrs: string): string => {
  const dw = digitW(size)
  const lh = Math.ceil(size * 1.4)
  const base = Math.ceil(size)
  const rules: string[] = []
  const cell = (right: number, w: number, s: Strip): string => {
    const n = s.glyphs.length
    const period = n * s.unit
    rules.push(`.q${rules.length}{animation:q${n}x${lh} ${period}s steps(${n}) -${((ms / 1000) % period).toFixed(2)}s infinite}`)
    const glyphs = s.glyphs.map((g, i) => (g ? `<text ${endText(w, base + i * lh)}${attrs}>${g}</text>` : '')).join('')
    return `<svg x="${right - w}" y="${y - base}" width="${w}" height="${lh}" overflow="hidden"><g class="q${rules.length - 1}">${glyphs}</g></svg>`
  }
  const colon = x - 2 * dw - colonW(size) / 2
  const cells = [
    cell(x, dw, SECONDS),
    cell(x - dw, dw, TENS),
    `<text x="${colon}" y="${y}" text-anchor="middle"${attrs}>:</text>`,
    cell(x - 2 * dw - colonW(size), dw, MINUTES),
    cell(x - 3 * dw - colonW(size), 2 * dw + colonW(size), HEADS),
  ].join('')
  const frames = [10, 6, 60].map(n => `@keyframes q${n}x${lh}{to{transform:translateY(-${n * lh}px)}}`).join('')
  return `<g class="clk" aria-label="${fmtTime(ms)}"><style>${rules.join('')}${frames}</style>${cells}</g>`
}

const crabWidth = (scale: number): number => Math.round(CRAB_BOX * scale * 100) / 100

// A panel crab at x.
const rowCrab = (x: number, y: number, costume: string, dim = false, isWalking = false): string =>
  crab(x, y, costume, dim, isWalking, CRAB_SCALE)

// A thread in the pane: its newest messages, each cut to THREAD_TEXT, as many as fit
// THREAD_CHARS. A drawing holds 100000 characters and cuts from the end, which is
// where the newest messages are, so the budget is spent newest first.
const THREAD_TEXT = 4000
const THREAD_CHARS = 90000

// One line per tool call in a thread: the tool, and the argument that says most about it.
const toolLine = (use: { tool: string; input: Record<string, unknown> }): string => {
  const arg = TOOL_ARG_KEYS.map(k => use.input[k]).find(v => typeof v === 'string' && v)
  const name = use.tool.startsWith('mcp__') ? use.tool.split('__').slice(2).join('__') || use.tool : use.tool
  return typeof arg === 'string' ? `${name} · ${arg.replace(/\s+/g, ' ')}` : name
}

// Each row is its own SVG, so each carries the motion CSS only when its body uses it:
// a pulsing mark (`live`) or a walking crab (`run`).
const svg = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${body.includes('class="live"') ? LIVE_CSS : ''}${body.includes(' run"') ? CRAB_CSS : ''}${body}</svg>`

// The pane's own title already says "Agents": the header names the flow, if any.
// `isTicking`: the time runs on, and counts by itself (see `clock`).
const headerSvg = (W: number, title: string, t: ReturnType<typeof totals>, isTicking = false): string => {
  const s = tr()
  const gap = 6
  const tw = (W - gap * 3) / 4
  // A narrow pane shrinks the figures so "≈$12.3" still fits its tile.
  const size = tw >= 80 ? 15 : 13
  const top = title ? 28 : 0
  const figure = `font-family="${FONT}" font-size="${size}" font-weight="600" font-variant-numeric="tabular-nums"`
  const figureAt = (i: number) => i * (tw + gap) + 9
  // `drawn`: the figure's own markup, in place of `v` written as text.
  const tile = (i: number, k: string, v: string, drawn = '') =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" ${startText(figureAt(i), top + 16)} font-family="${FONT}" font-size="11">${k}</text>
${drawn || `<text class="t" ${startText(figureAt(i), top + 33)} ${figure}>${v}</text>`}`
  const time =
    isTicking && t.time < CLOCK_MAX ? clock(figureAt(3) + clockWidth(t.time, size), top + 33, size, t.time, ` class="t" ${figure}`) : ''
  return svg(
    W,
    headerHeight(title),
    `${title ? `<text class="t" ${startText(0, 15)} font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}
${tile(0, s.cost, '≈' + fmtCost(t.cost))}${tile(1, s.input, fmtTokens(t.input))}${tile(2, s.output, fmtTokens(t.output))}${tile(3, s.time, fmtTime(t.time), time)}`,
  )
}

const headerHeight = (title: string): number => (title ? 72 : 44)

// The task's own progress when the worker reports steps; a finished run is full.
const progressOf = (a: AgentRun): number | null => {
  if (a.status === 'done') return 1
  if (a.stepTotal) return Math.min(1, (a.stepDone ?? 0) / a.stepTotal)
  return null
}

const ctxOf = (a: AgentRun): number => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)

// `titled: false` leaves the title out, for a row whose title is drawn as a pressable over it.
// A row is three images side by side, in flow: the crab, the text, the status mark. Only the text
// changes every second (the elapsed time); the other two depend on the row's costume and state alone,
// so their markup holds while it runs and their CSS animations are not started over.
const CRAB_COL = 40
const MARK_COL = 22
const rowTextW = (W: number): number => W - CRAB_COL - MARK_COL

const agentSvg = (W: number, a: AgentRun, at: number, titled = true, isTicking = false): string => {
  const TW = rowTextW(W)
  const s = tr()
  const color = colorOf(roleOf(a))
  const ctx = ctxOf(a)
  const textW = TW - 2
  const meta = [runModel(a)]
  if (a.round > 1) meta.push(`${s.round} ${a.round}`)
  if (a.status === 'failed') meta.push(s.failed)
  const barW = textW
  const progress = progressOf(a)
  const time = elapsed(a, at)
  const usage = `${s.ctx} ${ctx}% · ${fmtTokens(a.contextTokens)}  ≈${fmtCost(a.costUsd)}`
  const stats = `${usage}  ${fmtTime(time)}`
  const statsFont = `font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums"`
  // A running time counts by itself, after the usage; the two spaces before it are kept as a gap.
  const ticks = isTicking && time < CLOCK_MAX
  const clockW = ticks ? clockWidth(time, 11) + textWidth('  ', 11) : 0
  const statsSvg = ticks
    ? `<text class="s" ${endText(2 + barW - clockW, 49)} ${statsFont}>${usage}</text>${clock(2 + barW, 49, 11, time, ` class="s" ${statsFont}`)}`
    : `<text class="s" ${endText(2 + barW, 49)} ${statsFont}>${stats}</text>`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, barW - (ticks ? textWidth(usage, 11) + clockW : textWidth(stats, 11)) - 12)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(barW * (progress ?? ctx / 100))
  return svg(
    TW,
    66,
    `${titled ? `<text class="t" ${startText(2, 18)} font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>` : ''}
<text ${startText(2, 34)} font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(roleLabel(a))}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" ${startText(2, 49)} font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
${statsSvg}
<rect class="k" x="2" y="55" width="${barW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="2" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
<line class="ln" x1="0" y1="65.5" x2="${TW}" y2="65.5"/>`,
  )
}

// The status word a row's mark is read as.
const statusWord = (status: string): string => {
  const s = tr()
  return status === 'running' ? s.isRunning : status === 'failed' ? s.failed : status === 'idle' ? s.isIdle : s.isFinished
}

const rowLine = (w: number): string => `<line class="ln" x1="0" y1="65.5" x2="${w}" y2="65.5"/>`

const agentCrabSvg = (a: AgentRun): string =>
  svg(CRAB_COL, 66, `${rowCrab(0, 14, costumeOf(a), false, a.status === 'running')}${rowLine(CRAB_COL)}`)

const agentMarkSvg = (a: AgentRun): string =>
  svg(MARK_COL, 66, `${statusMark(MARK_COL - 8, 16, a.status, colorOf(roleOf(a)))}${rowLine(MARK_COL)}`)

const plannedSvg = (W: number, p: Planned): string => {
  const tier = p.tier in TIER_COLOR ? p.tier : 'other'
  const color = colorOf(tier)
  const textW = W - 42 - 22
  const meta = [tierModel(tier)]
  if (p.after.length) meta.push(`${tr().after} ${p.after.join(', ')}`)
  return svg(
    W,
    46,
    `${rowCrab(0, 6, 'other', true)}
<text class="s" ${startText(42, 18)} font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${p.n}. ${p.title}`, 13, textW))}</text>
<text ${startText(42, 34)} font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(tierWord(tier))}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="45.5" x2="${W}" y2="45.5"/>`,
  )
}

// Collapsed, the header's tiles stay and the rows shrink to one strip of crabs.
const compactSvg = (W: number, list: AgentRun[], planned: Planned[]): string => {
  const icons = [
    ...list.filter(a => a.status === 'running').map(a => ({ k: costumeOf(a), c: colorOf(roleOf(a)), s: 'running', dim: false })),
    ...list.filter(a => a.status !== 'running').map(a => ({ k: costumeOf(a), c: colorOf(roleOf(a)), s: a.status, dim: false })),
    ...planned.map(p => ({ k: 'other', c: colorOf(p.tier), s: 'planned', dim: true })),
  ]
  // Room is kept for the "+N" overflow count.
  const fit = Math.max(1, Math.floor((W - 36) / 36))
  const shown = icons.slice(0, fit)
  const more = icons.length - shown.length
  const body = shown
    .map((ic, i) => rowCrab(i * 36, 0, ic.k, ic.dim, ic.s === 'running') + (ic.s === 'running' ? `<circle class="live" cx="${i * 36 + 32}" cy="4" r="3" fill="${ic.c}"/>` : ''))
    .join('')
  const x = shown.length * 36 + (more ? 4 : 0)
  return svg(
    W,
    32,
    `${body}${more ? `<text class="s" ${startText(x, 21)} font-family="${FONT}" font-size="12">+${more}</text>` : ''}`,
  )
}

// --- terminal drawing: the same rows in text.

const ctxBar = (pct: number, width: number): string => {
  const filled = Math.round((width * pct) / 100)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const STATUS_GLYPH: Record<string, string> = { running: '●', done: '✓', failed: '✗', planned: '◷', idle: '○' }

// --- the main session's row: one AgentRun kept apart from the subagents.

// A fresh row for the main session, counted from `startedAt` (SessionUsage.startedAt).
const newRoot = (startedAt: number): AgentRun => ({
  id: `crew-${ROOT_ID}`,
  type: ROOT_ID,
  role: ROOT_ID,
  description: '',
  model: '',
  status: 'idle',
  startedAt,
  contextTokens: 0,
  contextMax: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  steps: 0,
  round: 1,
})

// The live window as the engine measures it (SessionContextUsage): its fill and its size.
const withContext = (r: AgentRun, c: SessionContextUsage): AgentRun => ({
  ...r,
  contextTokens: c.tokens ?? r.contextTokens,
  contextMax: c.window || r.contextMax,
})

// The prompt side, cache reads and writes included, as the status line counts the window.
const inputOf = (u: Usage): number => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)

// The row as drawn: its title.
const rootRow = (r: AgentRun | null): AgentRun | null => (r ? { ...r, description: tr().main } : null)

// Drawings kept between redraws, keyed by everything a drawing depends on, so a row
// that did not change is not built again. Two generations: a redraw reuses either, and
// keeps only what it used, so rows no longer shown drop out.
type Memo = { begin: () => void; reset: () => void; get: (key: string, build: () => string) => string }

const makeMemo = (): Memo => {
  let prev = new Map<string, string>()
  let next = new Map<string, string>()
  return {
    begin: () => {
      prev = next
      next = new Map()
    },
    reset: () => {
      prev = new Map()
      next = new Map()
    },
    get: (key, build) => {
      const hit = next.get(key) ?? prev.get(key) ?? build()
      next.set(key, hit)
      return hit
    },
  }
}

// A subagent's thread as last fetched; `version` says which events it was fetched after.
type Thread = { version: number; found: SessionMessage[] | { deny: string } }

// Opens the agents pane, or closes it when it is up; true when it ends up open.
// Moves the pane's window; a pane that cannot be scrolled (no surface, a test)
// still shows what it holds, so a refusal or a throw is let go.
async function scrollPane($: EngineInterface, to: 'start' | 'end'): Promise<void> {
  try {
    await $.ui.scroll({ in: PANE, to })
  } catch {
    // Nothing to move.
  }
}

// A thread opens on its newest message and keeps up with the ones that follow,
// as the pane's end does until the person scrolls away from it.
// The agent whose thread is open ('' for none), kept apart from the panel's state so a row stored for
// any other agent is let go without a read.
let viewingAgent = ''
// Finished subagents (by agent id): a row stored in the conversation of one of these means it was reused.
const finishedAgents = new Set<string>()
// A reused subagent always starts from a new input: a brief (`prompt`) or a message sent to it (`delivery`).
// Its replies and tool results after it finished are not reuse.
const REUSE_DOORS = new Set(['prompt', 'delivery'])

async function openThread($: EngineInterface, id: string, agentId: string, refresh: () => void): Promise<void> {
  viewingAgent = agentId
  refresh()
  await update($, panel, prev => ({ ...prev, viewing: id }))
  await scrollPane($, 'end')
}

async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: tr().pane })
  return true
}

async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  void $.ui.open({ id: PANE, title: tr().pane })
}

const memo = makeMemo()
// Per agent: how many events changed its thread, and the thread as fetched at some count.
const threadVersion = new Map<string, number>()
const threads = new Map<string, Thread>()
const touchThread = (agentId: string | undefined): void => {
  if (agentId) threadVersion.set(agentId, (threadVersion.get(agentId) ?? 0) + 1)
}

// --- keeping the panel between runs of a session. The engine holds a plugin's state for the process
// only, so a session resumed later would start with an empty panel and lose its threads. A copy goes to
// the plugin's store under the session's id, written a moment after the panel's state changes.
const SAVE_MS = 2000
const SAVED_KEYS = new Set(['flow', 'agents', 'root', 'panel'])
let sessionId = ''
// Per agent: its conversation as last read, cut to what a thread draws, for when the engine no longer answers for it.
const keptThreads = new Map<string, KeptMessage[]>()
let saveTimer: Timer | undefined

async function saveSnapshot($: EngineInterface): Promise<void> {
  saveTimer = undefined
  if (!sessionId) return
  try {
    const list = await read($, agents)
    const p: Panel = await read($, panel)
    const snapshot: Snapshot = {
      shape: 1,
      savedAt: await $.clock.now(),
      flow: await read($, flow),
      agents: list,
      root: await read($, root),
      panel: { isCompact: p.isCompact, isDoneCollapsed: p.isDoneCollapsed, viewing: p.viewing ?? '' },
      threads: keepThreads(keptThreads, list),
    }
    await $.store.set(snapshotKey(sessionId), snapshot)
    const { index, dropped } = touchIndex(await $.store.get(INDEX_KEY), sessionId)
    await $.store.set(INDEX_KEY, index)
    for (const id of dropped) await $.store.delete(snapshotKey(id))
  } catch {
    // The store is a convenience: a refusal (too large, no store) leaves the panel as it is.
  }
}

const scheduleSave = ($: EngineInterface): void => {
  if (sessionId && !saveTimer) saveTimer = $.clock.after(SAVE_MS, () => void saveSnapshot($))
}

// A conversation as the thread draws it, kept in memory for the next save.
const keepConversation = (agentId: string, found: SessionMessage[] | { deny: string }): void => {
  if (Array.isArray(found) && found.length > 0) keptThreads.set(agentId, keepThread(found, THREAD_TEXT, AGENT_CHARS))
}

// The stored copy of this session, if any. Its threads are always loaded; its panel only into an empty one
// (a hot reload keeps the live state, which is newer than the copy).
async function loadSnapshot($: EngineInterface): Promise<void> {
  if (!sessionId) return
  let snapshot: Snapshot | undefined
  try {
    snapshot = reviveSnapshot(await $.store.get(snapshotKey(sessionId)))
  } catch {
    return
  }
  if (!snapshot) return
  for (const [id, thread] of Object.entries(snapshot.threads)) keptThreads.set(id, thread)
  const isEmpty = (await read($, agents)).length === 0 && (await read($, flow)) === null && (await read($, root)) === null
  if (!isEmpty) return
  await update($, flow, () => snapshot.flow)
  await update($, agents, () => snapshot.agents)
  await update($, root, () => snapshot.root)
  await update($, panel, prev => ({ ...prev, ...snapshot.panel }))
}

// The clock ticks only while something runs, for the elapsed times. It is cancelled when nothing does
// and started again by the event that starts work. A subagent reused after it finished is noticed by
// the rows its conversation then stores (`session.append`) and by its turn, spawn and message events,
// not by polling.
const FAST_MS = 1000
// The desktop's drawings count the seconds themselves (see `clock`): there the clock only redraws them once a minute.
const DESKTOP_MS = 60_000
let ticker: { ms: number; timer: Timer } | undefined
// The surfaces that drew the panel this session; any but the desktop writes its times as text.
const paneSurfaces = new Set<string>()

const isBusy = async ($: EngineInterface): Promise<boolean> =>
  (await read($, agents)).some(a => a.status === 'running') || (await read($, root))?.status === 'running'

async function syncTicker($: EngineInterface): Promise<void> {
  const isDesktop = paneSurfaces.size > 0 && [...paneSurfaces].every(s => s === 'desktop')
  const ms = (await isBusy($)) ? (isDesktop ? DESKTOP_MS : FAST_MS) : 0
  if (ticker?.ms === ms) return
  ticker?.timer.cancel()
  ticker = ms ? { ms, timer: $.clock.every(ms, () => void tick($)) } : undefined
}

// Ticks the running clocks (agents', and the main session's mid-turn).
async function tick($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  if (await isBusy($)) await update($, now, () => at)
  await syncTicker($)
}

// The band's drawing as last made. While its inputs stand it is the same string, so the engine does not
// load it again; a changed input draws it anew, from the clock at that time (see `barMotionCss`).
let band: { key: string; source: string } | undefined
const bandDrawing = (f: Flow, width: number, isWorking: boolean, at: number): string => {
  const key = JSON.stringify([f, width, isWorking])
  if (band?.key !== key) band = { key, source: rowSvg(f, width, isWorking, at) }
  return band.source
}

// The time for the band's phase; a host with no clock answers with the process's.
const bandClock = async ($: EngineInterface): Promise<number> => {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // A reload starts from nothing: no timer of the old module, no drawing kept.
    ticker?.timer.cancel()
    ticker = undefined
    memo.reset()
    threads.clear()
    paneSurfaces.clear()
    band = undefined
    saveTimer?.cancel()
    saveTimer = undefined
    keptThreads.clear()
    try {
      sessionId = await $.session.id()
    } catch {
      sessionId = ''
    }
    await loadSnapshot($)
    // What the panel's state says now: finished subagents and the open thread, for the hooks that mirror them.
    const kept = await read($, agents)
    finishedAgents.clear()
    for (const a of kept) if (a.agentId && a.status !== 'running') finishedAgents.add(a.agentId)
    const open = (await read($, panel)).viewing
    viewingAgent = kept.find(a => a.id === open)?.agentId ?? ''
    await $.tool.register({
      name: 'progress',
      description:
        'Report multi-agent flow progress (a /savvy-flow run or any orchestrated plan) to the progress bar above the prompt and the agents panel. ' +
        'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
        'when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. ' +
        'For the main session only: a call from a subagent is ignored (workers report with `step`).',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the overall task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned worker tasks.' },
          done: { type: 'integer', minimum: 0, description: 'Number of tasks accepted after review.' },
          phase: { type: 'string', enum: [...PHASES] },
          finished: { type: 'boolean', description: 'True once the flow is closed.' },
          tasks: {
            type: 'array',
            description:
              'The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'A few words; reused verbatim as the Agent description.' },
                tier: { type: 'string', enum: [...TIERS] },
                after: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the tasks this one waits for.' },
              },
              required: ['title', 'tier'],
            },
          },
        },
      },
    })
    await $.tool.register({
      name: 'step',
      description:
        'For subagents: report progress on your own task to the agents panel. ' +
        'Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; ' +
        'call it again as each step finishes. Cheap and silent: it only draws a bar.',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          total: { type: 'integer', minimum: 1, description: 'Steps planned; may change if the plan changes.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
        },
        required: ['done'],
      },
      // In every agent's tool list, not behind ToolSearch: workers do not go looking for it.
      isDeferred: false,
    })
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the crew panel: the main session plus running, finished and planned subagents, with model, context, cost and time',
      argumentHint: 'open',
    })

    // The main session's row: when the session began, and its live window, as the
    // status line has them (SessionUsage). A reload keeps the counts already made.
    const at = await $.clock.now()
    let usage: SessionUsage | undefined
    try {
      usage = await $.session.usage()
    } catch {
      // No figures from this host: count from now, the window filled in by the first measure or step.
    }
    await update($, root, prev => {
      const base = prev ?? newRoot(usage?.startedAt ?? at)
      const dated = usage ? { ...base, startedAt: usage.startedAt } : base
      return usage ? withContext(dated, usage.context) : dated
    })

    await syncTicker($)
    // Once per session: a hot reload after the person closed the panel does not reopen it.
    if (options.openAtStart !== 'off') await autoOpen($, 'session-start')
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    // `/crew open` opens the panel, or brings it forward from behind another tab, without toggling it.
    if ((e.args ?? '').trim() === 'open') {
      const at = await $.clock.now()
      await update($, now, () => at)
      await $.ui.open({ id: PANE, title: tr().pane })
      return { text: tr().opened }
    }
    const isOpen = await togglePane($)
    return { text: isOpen ? tr().opened : tr().closed }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    // The flow is the main session's: a call from a worker's loop carries its agentId
    // and changes nothing, or any subagent could rename, finish or reset the flow.
    if (e.agentId) return { result: 'ignored: only the main session reports the flow' }
    const input = e as unknown as ProgressInput
    const prev = await read($, flow)
    if (isNewFlow(prev, input) && input.title !== undefined) {
      // A new flow starts with a clean list; agents still running stay.
      await update($, agents, list => list.filter(a => a.status === 'running'))
      await syncTicker($)
    }
    const next = await update($, flow, p => merge(p, input))
    if (next && input.tasks?.length) await autoOpen($, next.title)
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // A worker's own progress: the call runs in the worker's loop, so agentId names it.
  on('tool.call', { tool: STEP_TOOL }, async ($, e) => {
    const input = e as unknown as { done?: number; total?: number; note?: string }
    const agentId = e.agentId
    if (!agentId) return { result: 'ignored: only subagents report steps' }
    let matched = false
    await update($, agents, list =>
      list.map(a => {
        if (a.agentId !== agentId) return a
        matched = true
        const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0))
        const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0))
        return { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: input.note?.trim() || undefined }
      }),
    )
    return { result: matched ? 'ok' : `ignored: no panel row for agent ${agentId}` }
  })

  // Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = String(e.subagent_type ?? '')
    if (!type.startsWith('savvy-')) return next(e)

    await update($, flow, prev => {
      const base = prev && !prev.isFinished ? { ...blank(), ...prev } : blank()
      return { ...base, running: base.running + 1, phase: base.phase === 'plan' ? 'delegate' : base.phase }
    })
    try {
      return await next(e)
    } finally {
      await update($, flow, prev => (prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev))
    }
  })

  // A message to a finished subagent resumes it with a new task: its row is renewed
  // before the send, as a resumed run may end before the call answers.
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const input = e as unknown as { to?: unknown; summary?: string; message?: string }
    const to = typeof input.to === 'string' ? input.to.replace(/\s*\[[^\]]*\]$/, '').trim() : ''
    const list = await read($, agents)
    if (!to || !list.some(a => a.agentId && a.status !== 'running')) return next(e)
    let id = list.some(a => a.agentId === to) ? to : undefined
    if (!id) {
      try {
        id = (await $.agent.list()).find(l => l.id === to || l.name === to)?.id
      } catch {
        // No agent list from this host: the resume's own spawn renews the row.
      }
    }
    const row = id ? list.find(a => a.agentId === id) : undefined
    if (!row || row.status === 'running') return next(e)
    const at = await $.clock.now()
    finishedAgents.delete(row.agentId as string)
    await update($, agents, rows => renew(rows, row.agentId as string, at, { summary: input.summary, prompt: input.message }))
    await update($, now, () => at)
    await syncTicker($)
    const sent = await next(e)
    // Refused, nothing resumed: the row is as it was.
    if (sent.deny !== undefined) {
      await update($, agents, rows => rows.map(a => (a.id === row.id && a.status === 'running' ? row : a)))
      await syncTicker($)
    }
    return sent
  })

  on('agent.spawn', async ($, e, next) => {
    // A resume renews its row before the run starts, as the run may end before the
    // spawn answers; a refused resume leaves it as it was.
    const resumed = e.resume?.agentId
    const before = resumed ? (await read($, agents)).find(a => a.agentId === resumed) : undefined
    if (resumed && before) {
      const at = await $.clock.now()
      finishedAgents.delete(resumed)
      await update($, agents, list => renew(list, resumed, at, { prompt: e.prompt }))
      await update($, now, () => at)
      await syncTicker($)
      const started = await next(e)
      if (started.deny !== undefined) {
        await update($, agents, list => list.map(a => (a.id === before.id && a.status === 'running' && before.status !== 'running' ? before : a)))
        await syncTicker($)
      }
      return started
    }

    const isUnbriefed = e.subagentType.startsWith('savvy-') && !e.prompt.includes(STEP_TOOL)
    const started = await next(isUnbriefed ? { ...e, prompt: e.prompt + STEP_BRIEF } : e)
    if (started.deny !== undefined) return started

    const at = await $.clock.now()
    await update($, agents, list => {
      const round = 1 + list.filter(a => norm(a.description) === norm(e.description) && e.description).length
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        type: e.subagentType,
        role: roleOfSpawn(e.subagentType, e.prompt),
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        contextTokens: 0,
        contextMax: windowOf(started.model),
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        steps: 0,
        round,
      }
      return [...list.filter(a => a.id !== run.id), run].slice(-200)
    })
    await update($, now, () => at)
    await syncTicker($)
    if (e.subagentType.startsWith('savvy-')) {
      const f = await read($, flow)
      await autoOpen($, f && !f.isFinished ? f.title : 'savvy-flow')
    } else if (options.autoOpen === 'any') {
      await autoOpen($, 'any-agent')
    }
    return started
  })

  // A turn starts: the main loop's row walks while it runs, and a subagent's finished
  // row, its agent reused, is running again.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const agentId = e.agentId
    const at = await $.clock.now()
    if (agentId === undefined) {
      await update($, root, (prev): AgentRun => ({ ...(prev ?? newRoot(at)), status: 'running' }))
      await update($, now, () => at)
      await syncTicker($)
    } else if ((await read($, agents)).some(a => a.agentId === agentId && a.status !== 'running')) {
      finishedAgents.delete(agentId)
      await update($, agents, list => renew(list, agentId, at, { prompt: e.text }))
      await update($, now, () => at)
      await syncTicker($)
    }
    return started
  })

  // Each model request: live context, tokens and cost, of a subagent or of the main loop.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!usage) return result

    if (!agentId) {
      const model = usage.model || e.model
      const at = await $.clock.now()
      await update($, root, prev => {
        const r = prev ?? newRoot(at)
        return {
          ...r,
          model,
          effort: typeof e.effort === 'string' ? e.effort : r.effort,
          // The input side, as the status line counts the window (SessionContextUsage.tokens).
          contextTokens: inputOf(usage),
          contextMax: r.contextMax || windowOf(model),
          inputTokens: (r.inputTokens || 0) + inputOf(usage),
          outputTokens: (r.outputTokens || 0) + (usage.output_tokens || 0),
          costUsd: r.costUsd + costOf(model, usage, true),
          steps: r.steps + 1,
        }
      })
      return result
    }

    const model = usage.model || e.model
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running',
              endedAt: undefined,
              contextTokens: inputOf(usage) + (usage.output_tokens || 0),
              contextMax: windowOf(model),
              inputTokens: (a.inputTokens || 0) + inputOf(usage),
              outputTokens: (a.outputTokens || 0) + (usage.output_tokens || 0),
              costUsd: a.costUsd + costOf(model, usage, true),
              steps: a.steps + 1,
            },
      ),
    )
    await syncTicker($)
    return result
  })

  // Each row a subagent's conversation keeps (its reply, a tool call's result, a message sent to it):
  // `next` answers once the row is stored, so the refetch then sees it. A row of a finished subagent
  // means it was reused: its row is running again. Only the thread being viewed redraws; any other
  // agent's rows are let go without a state read.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const agentId = e.agentId
    if (!agentId || stored.deny !== undefined) return stored
    if (finishedAgents.has(agentId) && REUSE_DOORS.has(e.door)) {
      finishedAgents.delete(agentId)
      const at = await $.clock.now()
      // The row carries the new task's brief.
      const content = e.message.content as unknown
      const text = Array.isArray(content) ? content.map(b => (b as { text?: unknown }).text).find(t => typeof t === 'string') : content
      const prompt = typeof text === 'string' ? text : undefined
      await update($, agents, list => renew(list, agentId, at, { prompt }))
      await update($, now, () => at)
      await syncTicker($)
    }
    if (agentId === viewingAgent) {
      touchThread(agentId)
      await update($, threadRows, n => n + 1)
    }
    return stored
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      const at = await $.clock.now()
      touchThread(agentId)
      finishedAgents.add(agentId)
      // Its conversation is whole now: keep it for a session resumed later.
      try {
        keepConversation(agentId, await $.session.messages({ agentId }))
      } catch {
        // Nothing to keep from this host.
      }
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          // A run whose steps went unseen still gets the turn's own sum, added to the
          // turns before it when the agent was reused.
          const fallback = a.steps === 0 && e.usage
          return {
            ...a,
            status: e.reason === 'answer' ? 'done' : 'failed',
            endedAt: at,
            ...(fallback && e.usage
              ? {
                  model: e.usage.model || a.model,
                  inputTokens: (a.inputTokens || 0) + inputOf(e.usage),
                  outputTokens: (a.outputTokens || 0) + (e.usage.output_tokens || 0),
                  costUsd: a.costUsd + costOf(e.usage.model || a.model, e.usage, false),
                }
              : {}),
          }
        }),
      )
      await update($, now, () => at)
      await syncTicker($)
    } else {
      // The main loop's turn ended: its row rests until the next prompt.
      const at = await $.clock.now()
      await update($, root, (prev): AgentRun => ({ ...(prev ?? newRoot(at)), status: 'idle' }))
      await update($, now, () => at)
      await syncTicker($)
    }
    // A turn is over: write the copy now rather than after the usual wait, as the process may end next.
    saveTimer?.cancel()
    await saveSnapshot($)
    return next(e)
  })

  // Every change to the panel's state is copied to the store a moment later.
  on('state.set', { plugin: 'the-crew' }, async ($, e, next) => {
    const set = await next(e)
    if (SAVED_KEYS.has(e.key)) scheduleSave($)
    return set
  })

  // The engine's own measure of the main session after each main-thread turn
  // (SessionMeasureInput): its live window's fill and size replace the step's estimate.
  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    const at = await $.clock.now()
    await update($, root, prev => withContext(prev ?? newRoot(at), e.context))
    return measured
  })

  // Scrolled back down to a thread's end, the pane follows it again.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    const isAtEnd = e.offset >= e.contentRows - e.bodyRows
    if (!moved.deny && e.origin.kind === 'person' && e.by > 0 && isAtEnd && (await read($, panel)).viewing) {
      void scrollPane($, 'end')
    }
    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = tr()
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const f = await read($, flow)
    const p: Panel = await read($, panel)
    // The main session's row, pinned first; absent only before the session started.
    const main = rootRow(await read($, root))
    // A thread is not redrawn by the clock: it reads the time off the clock once, and not from the ticking `now`.
    const isDesktop = e.surface === 'desktop' && 'Svg' in ui
    if (!paneSurfaces.has(e.surface)) {
      paneSurfaces.add(e.surface)
      await syncTicker($)
    }
    const isThread = isDesktop && Boolean(p.viewing && list.find(a => a.id === p.viewing)?.agentId)
    const at = Math.max(isThread ? await $.clock.now() : await read($, now), ...list.map(a => a.startedAt), main?.startedAt ?? 0, 0)
    // While anything runs, the desktop draws each running time from the clock now, to count on by itself;
    // such a drawing is kept for the minute, as the panel's `now` moves only once a minute there.
    const isBusyNow = list.some(a => a.status === 'running') || main?.status === 'running'
    const clockAt = isDesktop && isBusyNow ? Math.max(at, await $.clock.now()) : at
    const minute = Math.floor(clockAt / DESKTOP_MS)
    const isTicking = (a: AgentRun) => isDesktop && isBusyNow && a.endedAt === undefined
    memo.begin()
    if (!isThread) threads.clear()
    // A drawing is rebuilt only when what it shows changed: a run that ended no longer depends on the time.
    const rowKey = (W: number, a: AgentRun, titled: boolean) =>
      JSON.stringify([W, titled, a, isTicking(a) ? `m${minute}` : a.endedAt === undefined ? at : 0])
    const agentDrawing = (W: number, a: AgentRun, titled = true) =>
      memo.get(`a${rowKey(W, a, titled)}`, () => agentSvg(W, a, isTicking(a) ? clockAt : at, titled, isTicking(a)))
    const crabDrawing = (a: AgentRun) => memo.get(`c${JSON.stringify([costumeOf(a), a.status])}`, () => agentCrabSvg(a))
    const markDrawing = (a: AgentRun) => memo.get(`k${JSON.stringify([roleOf(a), a.status])}`, () => agentMarkSvg(a))

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const planned = plannedOf(f, list)
    const everyone = main ? [main, ...list] : list
    const t = totals(everyone, at)
    // The pane's title says "Agents"; inside, only the flow's own name.
    const title = f && !f.isFinished ? f.title : ''

    const toggleCompact = (
      <Button
        key="compact"
        label={p.isCompact ? s.expand : s.collapse}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))}
      />
    )
    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} ${s.finished} · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const isEmpty = list.length === 0 && planned.length === 0
    const summary = `≈${fmtCost(t.cost)}, ${fmtInOut(t)}, ${fmtTime(t.time)}`

    if (e.surface === 'desktop' && 'Svg' in ui) {
      const { Svg, Markdown } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const tc = isBusyNow ? totals(everyone, clockAt) : t
      const header = memo.get(`h${JSON.stringify([W, title, tc.cost, tc.input, tc.output, isBusyNow ? minute : tc.time])}`, () =>
        headerSvg(W, title, tc, isBusyNow),
      )
      const section = (key: string, text: string) => (
        <Text key={key} dimColor>
          {text}
        </Text>
      )

      // A row's drawing: crab, text and status mark side by side each its own
      // image so the text changing each second does not load the other two again. With `view`, the
      // title is a Button laid over the text.
      const drawn = (a: AgentRun, alt: string, view = false) => (
        <Box key={view ? `row-${a.id}` : a.id} flexDirection="row">
          <Svg source={crabDrawing(a)} alt={`${costumeOf(a)} crab`} width={CRAB_COL} height={66} />
          <Svg source={agentDrawing(W, a, !view)} alt={alt} width={rowTextW(W)} height={66} />
          <Svg source={markDrawing(a)} alt={statusWord(a.status)} width={MARK_COL} height={66} />
          {view && (
            <Box position="absolute" top={0} left={5} right={0} alignItems="flex-start">
              <Button
                key={`view-${a.id}`}
                label={fitText(a.description || a.type, 13, W - 42 - 22)}
                plain
                onPress={() => openThread($, a.id, a.agentId ?? '', () => touchThread(a.agentId))}
              />
            </Box>
          )}
        </Box>
      )

      // A subagent's row: pressing its title opens its thread in the pane, in place
      // of the agents (the desktop app keeps its main view to itself). Neither an
      // Svg nor a Box takes a press, so the title is a Button laid over the row.
      const agentRow = (a: AgentRun, state: string) => {
        const alt = `${a.description}: ${modelName(a.model)}, ${state}`
        return drawn(a, alt, Boolean(a.agentId))
      }

      // A subagent's thread in place of the agents, its row on top and a way back above
      // and below it: the one below is in view while the pane follows the newest message.
      const viewing = p.viewing ? list.find(a => a.id === p.viewing) : undefined
      if (viewing?.agentId) {
        const back = (key: string) => (
          <Button
            key={key}
            label={`‹ ${s.backToAgents}`}
            plain
            onPress={async () => {
              viewingAgent = ''
              await update($, panel, prev => ({ ...prev, viewing: '' }))
              await scrollPane($, 'start')
            }}
          />
        )
        // The thread is fetched again when an event of this agent changed it, not on the clock.
        await read($, threadRows)
        const version = threadVersion.get(viewing.agentId) ?? 0
        let cached = threads.get(viewing.agentId)
        if (!cached || cached.version !== version) {
          let found = await $.session.messages({ agentId: viewing.agentId })
          // The engine may no longer hold the conversation (a session resumed in a new process): draw the kept copy.
          const copy = keptThreads.get(viewing.agentId)
          if (copy && (!Array.isArray(found) || found.length === 0)) found = copy as SessionMessage[]
          else keepConversation(viewing.agentId, found)
          cached = { version, found }
          threads.set(viewing.agentId, cached)
        }
        const found = cached.found
        let budget = THREAD_CHARS
        let first = 'deny' in found ? 0 : found.length
        while (!('deny' in found) && first > 0) {
          const m = found[first - 1]
          const cost = Math.min(m?.text.length ?? 0, THREAD_TEXT) + (m?.toolUses.length ?? 0) * 120
          if (cost > budget && first < found.length) break
          budget -= cost
          first--
        }
        const thread =
          'deny' in found
            ? [<Text key="deny" dimColor>{found.deny}</Text>]
            : found.slice(first).flatMap((m, i) => [
                ...(m.text ? [<Markdown key={`m-${i}`} text={clip(m.text, THREAD_TEXT)} dimColor={m.role === 'user'} />] : []),
                ...m.toolUses.map((u, j) => (
                  <Text key={`t-${i}-${j}`} dimColor wrap="truncate-end">
                    {`→ ${toolLine(u)}`}
                  </Text>
                )),
              ])
        return (
          <Box flexDirection="column" gap={1}>
            {back('back')}
            {drawn(viewing, `${viewing.description}: ${modelName(viewing.model)}`)}
            {thread.length > 0 ? thread : <Text dimColor>{s.noThread}</Text>}
            {back('back-end')}
          </Box>
        )
      }

      if (p.isCompact) {
        return (
          <Box flexDirection="column">
            <Svg source={header} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
            {toggleCompact}
            <Svg source={compactSvg(W, everyone, planned)} alt={`${list.length} ${s.agentsCount}`} width={W} height={32} />
          </Box>
        )
      }
      const shownDone = p.isDoneCollapsed ? 0 : finished.length
      const lines = 1 + (isEmpty ? 1 : 0) + (running.length > 0 ? 1 : 0) + (finished.length > 0 ? 1 : 0) + (planned.length > 0 ? 1 : 0)
      const gridH = headerHeight(title) + lines * LINE_H + ((main ? 1 : 0) + running.length + shownDone) * 66 + planned.length * 46
      return (
        <Box flexDirection="column">
          {/* The grid sizes the pane; the content is placed over it, as an
              absolute Box paints over the siblings before it. */}
          {gridTiles(gridH).map((tileH, i) => (
            <Svg key={`grid-${i}`} source={memo.get(`g${W}x${tileH}`, () => gridSvg(W, tileH))} alt="dotted grid" width={W} height={tileH} />
          ))}
          <Box flexDirection="column" position="absolute" top={0} left={0} right={0}>
            <Svg source={header} alt={title ? `${title}: ${summary}` : summary} width={W} height={headerHeight(title)} />
            {toggleCompact}
            {main && drawn(main, `${main.description}: ${modelName(main.model)}, ${main.status === 'running' ? s.isRunning : s.isIdle}`)}
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && section('h-run', `${s.running} · ${running.length}`)}
            {running.map(a => agentRow(a, s.isRunning))}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed &&
              finished.map(a => agentRow(a, s.isFinished))}
            {planned.length > 0 && section('h-plan', `${s.planned} · ${planned.length}`)}
            {planned.map(pl => (
              <Svg key={`plan-${pl.n}`} source={memo.get(`p${JSON.stringify([W, pl])}`, () => plannedSvg(W, pl))} alt={`${pl.n}. ${pl.title}: ${s.isPlanned}`} width={W} height={46} />
            ))}
          </Box>
        </Box>
      )
    }

    // Terminal: the same content in text rows.
    const cols = Math.max(24, e.props.bodyColumns || 40)
    const barW = Math.max(6, Math.min(20, cols - 34))
    const row = (a: AgentRun) => {
      const color = colorOf(roleOf(a))
      const ctx = ctxOf(a)
      const progress = progressOf(a)
      const model = runModel(a)
      const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' ' + a.stepNote : ''} · ` : ''
      return (
        <Box key={a.id} flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={color}>▣</Text>
            <Text bold wrap="truncate-end">
              {a.description || a.type}
            </Text>
            <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {'  '}
            {roleLabel(a)} · {model}
            {a.round > 1 ? ` · ${s.round} ${a.round}` : ''}
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            {progress === null ? <Text dimColor>{ctxBar(ctx, barW)}</Text> : <Text color={color}>{ctxBar(progress * 100, barW)}</Text>}
            <Text dimColor>
              {' '}
              {steps}{s.ctx} {ctx}% · {fmtTokens(a.contextTokens)} ≈{fmtCost(a.costUsd)} {fmtTime(elapsed(a, at))}
            </Text>
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {title}
          </Text>
          {toggleCompact}
        </Box>
        <Text dimColor>
          ≈{fmtCost(t.cost)} · {fmtInOut(t)} · {fmtTime(t.time)}
        </Text>
        {p.isCompact ? (
          <Text wrap="truncate-end">
            {[...(main ? [main] : []), ...running, ...finished].map(a => (
              <Text key={a.id} color={colorOf(roleOf(a))}>
                {STATUS_GLYPH[a.status]}{' '}
              </Text>
            ))}
            {planned.map(pl => (
              <Text key={`plan-${pl.n}`} dimColor>
                ◷{' '}
              </Text>
            ))}
          </Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {main && row(main)}
            {isEmpty && <Text dimColor>{s.empty}</Text>}
            {running.length > 0 && <Text dimColor>{s.running} · {running.length}</Text>}
            {running.map(row)}
            {finished.length > 0 && toggleDone}
            {!p.isDoneCollapsed && finished.map(row)}
            {planned.length > 0 && <Text dimColor>{s.planned} · {planned.length}</Text>}
            {planned.map(pl => {
              const tier = pl.tier in TIER_COLOR ? pl.tier : 'other'
              return (
                <Box key={`plan-${pl.n}`} flexDirection="column" marginBottom={1}>
                  <Text dimColor wrap="truncate-end">
                    <Text color={colorOf(tier)}>▢</Text> {pl.n}. {pl.title} ◷
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {tierWord(tier)} · {tierModel(tier)}
                    {pl.after.length ? ` · ${s.after} ${pl.after.join(', ')}` : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flow)
    if (f === null || e.props.hasSurvey) return next(e)
    // Draw this row with the other mods' bands beneath it. Claude Code's own placeholder ({ type: 'engine' }) is
    // never nested: the desktop drops a band that nests it.
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const crew = list.length + plannedOf(f, list).length
    const isWorking = list.some(a => a.status === 'running')
    const crewButton = (
      <Button key="crew-agents" label={`×${crew}`} plain onPress={() => void togglePane($)} />
    )
    const percent = `${Math.round(ratio(f) * 100)}%`
    const dismiss = (
      <Button
        key="crew-dismiss"
        label="✕"
        plain
        role="dismiss"
        onPress={() => update($, flow, () => null)}
      />
    )

    // The terminal's element table is completed with an `Svg` that draws nothing: test the surface too.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      // About 8 CSS px per reported column; the rest is the count, the dismiss
      // and their gaps. No floor above the slot: a row wider than it would wrap.
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={bandDrawing(f, width, isWorking, await bandClock($))} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
            {crewButton}
            {dismiss}
          </Box>
          {below}
        </Box>
      )
    }

    const cols = e.props.bodyColumns
    const titleW = Math.max(8, Math.min(30, f.title.length + 2, Math.floor(cols / 3)))
    const width = Math.max(6, Math.min(40, cols - titleW - 32))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={f.isFinished ? DONE : ACCENT}>● </Text>
            <Text wrap="truncate-end">{f.title}</Text>
          </Box>
          <Text color={f.isFinished ? DONE : ACCENT}>{barText(f, width)}</Text>
          <Text bold>{label(f)}</Text>
          <Text dimColor>{percent}</Text>
          <Text color={CLAY}>▣</Text>
          {crewButton}
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })
}
