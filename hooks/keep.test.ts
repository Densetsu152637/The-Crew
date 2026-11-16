import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'the-crew'
const NOW = Date.parse('2026-10-24T12:00:00Z')
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const USAGE = { model: 'claude-haiku-4-5', input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const SPAWN = {
  tool_use_id: 't1',
  prompt: 'Role: leaf; Profile: tester',
  description: 'Side work',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
}

const THREAD = [
  { role: 'user', text: 'Check the build.', toolUses: [] },
  { role: 'assistant', text: 'Looking at the config.', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: '/repo/build.json', offset: 3 } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: '{}' }] },
  { role: 'assistant', text: 'The build is fine.', toolUses: [] },
]

// A process of the session `sessionId`: subagent `a1` runs one turn and finishes. `messages` answers its thread.
const process = async ($: Engine, on: On, sessionId: string, messages: unknown) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__the-crew__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('session.id', () => ({ value: sessionId }) as never)
  on('session.messages', () => ({ value: messages }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
  await $.session.start({ source: 'resume', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  return clock
}

// The plugin's store in memory, which the test can read: what it holds is JSON, as the engine keeps it.
// `cap` refuses a write that would take the store past that many characters, as the engine's 4 MiB does.
const memoryStore = (on: On, seed: Record<string, unknown> = {}, cap = Infinity): Map<string, unknown> => {
  const held = new Map<string, unknown>(Object.entries(seed))
  on('store.get', (_$, e) => ({ value: held.get(e.key) }) as never)
  on('store.set', (_$, e) => {
    const next = new Map(held).set(e.key, e.value)
    if (JSON.stringify(Object.fromEntries(next)).length > cap) throw new Error('store over its cap')
    held.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    held.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...held.keys()] }) as never)
  return held
}

const runSubagent = async ($: Engine) => {
  await $.agent.spawn(SPAWN as never)
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ index: 0, messageCount: 1, turnId: 's1', model: 'claude-haiku-4-5', agentId: 'a1' })
  for await (const _ of stream) void _
  await $.turn.complete({ turnId: 's1', agentId: 'a1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
}

const mount = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })

// The copy a first process wrote for session `sess-1`: subagent a1 was still running when it ended.
const COPY = {
  shape: 1,
  savedAt: NOW - 3_600_000,
  flow: null,
  agents: [
    {
      id: 'g1', agentId: 'a1', type: 'general-purpose', role: 'tester', description: 'Side work', model: 'claude-haiku-4-5', status: 'running',
      startedAt: NOW - 3_700_000, contextTokens: 0, contextMax: 0, inputTokens: 1000, outputTokens: 1000, costUsd: 0.01, steps: 1, round: 1,
    },
  ],
  root: null,
  panel: { isCompact: false, isDoneCollapsed: false, viewing: 'g1' },
  threads: {
    a1: [
      { role: 'user', text: 'Check the build.', toolUses: [] },
      { role: 'assistant', text: 'The build is fine.', toolUses: [] },
    ],
  },
}

type Copy = { agents: { id: string; agentId?: string; status: string; inputTokens: number; costUsd: number; folded?: number }[]; threads?: unknown }
const ids = (held: Map<string, unknown>): string[] => (held.get('sessions') as { id: string }[]).map(e => e.id)

test('keep: a finished subagent is copied to the store as telemetry, never its conversation', async ($, on) => {
  const held = memoryStore(on)
  await process($, on, 'sess-1', THREAD)
  await runSubagent($)
  const ui = await mount($)
  await ui.press({ key: 'view-a1' })
  await $.turn.complete({ turnId: 'm1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  const copy = held.get('session:sess-1') as Copy
  expect(copy.agents.map(a => a.agentId)).toEqual(['a1'])
  expect(copy.threads).toBeUndefined()
  expect(JSON.stringify(copy)).not.toContain('Looking at the config')
  expect(ids(held)).toEqual(['sess-1'])
})

test('keep: a resumed session shows its subagents again, the run it ended in as failed, and its thread from the engine', async ($, on) => {
  memoryStore(on, { 'session:sess-1': COPY, sessions: ['sess-1'] })
  await process($, on, 'sess-1', THREAD)
  const ui = await mount($)
  expect((await ui.findAll({ type: 'Markdown' })).map(el => String(el.props.text))).toContain('The build is fine.')
  await ui.press({ key: 'back' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt))
  // An ended run reads as finished, with the error mark.
  expect(alts).toContain('Side work: Haiku 4.5, finished')
  expect(alts).toContain('error')
})

test("keep: another session's copy is not shown", async ($, on) => {
  memoryStore(on, { 'session:sess-1': COPY, sessions: ['sess-1'] })
  await process($, on, 'sess-2', { deny: 'no agent a1' })
  const ui = await mount($)
  expect((await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt)).some(a => a.startsWith('Side work'))).toBe(false)
})

test('keep: many sessions, empty ones included, never push out a busy one', async ($, on) => {
  const old = Array.from({ length: 300 }, (_, i) => `old-${i}`)
  const seed = { sessions: ['busy', ...old], 'session:busy': COPY, ...Object.fromEntries(old.map(id => [`session:${id}`, COPY])) }
  const held = memoryStore(on, seed)
  await process($, on, 'sess-new', THREAD)
  await runSubagent($)
  expect(ids(held)[0]).toBe('sess-new')
  expect(held.has('session:busy')).toBe(true)
  expect(held.has('session:old-299')).toBe(true)
})

test('keep: a session with nothing on its panel is not stored', async ($, on) => {
  const held = memoryStore(on)
  const clock = await process($, on, 'sess-empty', THREAD)
  await $.turn.complete({ turnId: 'm1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  await clock.advance(2500)
  expect(held.has('session:sess-empty')).toBe(false)
  expect(held.has('sessions')).toBe(false)
})

test('keep: a refused write drops the oldest other copies until it lands', async ($, on) => {
  const big = { ...COPY, agents: Array.from({ length: 400 }, (_, i) => ({ ...COPY.agents[0], id: `g${i}`, agentId: `x${i}`, status: 'done' })) }
  const size = JSON.stringify(big).length
  const held = memoryStore(on, { sessions: ['o1', 'o2', 'o3'], 'session:o1': big, 'session:o2': big, 'session:o3': big }, Math.floor(size * 2.5))
  await process($, on, 'sess-new', THREAD)
  await runSubagent($)
  expect(held.has('session:sess-new')).toBe(true)
  expect(held.has('session:o3')).toBe(false)
  expect(held.has('session:o1')).toBe(true)
  expect(ids(held)).toEqual(['sess-new', 'o1', 'o2'])
})

test('keep: copies the index lost are swept at start', async ($, on) => {
  const held = memoryStore(on, { sessions: ['sess-1'], 'session:sess-1': COPY, 'session:orphan': COPY })
  await process($, on, 'sess-1', THREAD)
  expect(held.has('session:orphan')).toBe(false)
  expect(held.has('session:sess-1')).toBe(true)
})

test('keep: a damaged row is let go alone; the rest of the copy comes back', async ($, on) => {
  const damaged = { ...COPY, agents: [...COPY.agents, { id: 7 }, null, { ...COPY.agents[0], id: 'g2', agentId: 'a2', status: 'done', costUsd: 'x' }] }
  memoryStore(on, { 'session:sess-1': damaged, sessions: ['sess-1'] })
  await process($, on, 'sess-1', THREAD)
  const ui = await mount($)
  await ui.press({ key: 'back' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt))
  expect(alts.filter(a => a.startsWith('Side work')).length).toBe(2)
})

test('keep: a change to the panel is copied a moment later, before any turn ends', async ($, on) => {
  const held = memoryStore(on)
  const clock = await process($, on, 'sess-1', THREAD)
  await $.agent.spawn(SPAWN as never)
  expect(held.has('session:sess-1')).toBe(false)
  await clock.advance(2500)
  expect((held.get('session:sess-1') as typeof COPY).agents.map(a => a.status)).toEqual(['running'])
})

test('keep: a folded copy draws one row for the earlier subagents, its totals in the panel', async ($, on) => {
  const fold = {
    id: 'crew:folded', type: 'folded', role: 'other', description: '9000 earlier subagents', model: '', status: 'done',
    startedAt: NOW - 9_000_000, endedAt: NOW - 8_000_000, contextTokens: 0, contextMax: 0, inputTokens: 1.1e12, outputTokens: 5e9,
    costUsd: 41_000, steps: 90_000, round: 0, folded: 9000, foldedFailed: 12,
  }
  memoryStore(on, { 'session:sess-1': { ...COPY, shape: 2, panel: { ...COPY.panel, viewing: '' }, agents: [fold, ...COPY.agents] }, sessions: ['sess-1'] })
  await process($, on, 'sess-1', THREAD)
  const ui = await mount($)
  const alts = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt))
  expect(alts.some(a => a.startsWith('9000 earlier subagents'))).toBe(true)
  expect(alts.some(a => a.startsWith('Side work'))).toBe(true)
})
