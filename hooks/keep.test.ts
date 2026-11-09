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
const memoryStore = (on: On, seed: Record<string, unknown> = {}): Map<string, unknown> => {
  const held = new Map<string, unknown>(Object.entries(seed))
  on('store.get', (_$, e) => ({ value: held.get(e.key) }) as never)
  on('store.set', (_$, e) => {
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

test('keep: a finished subagent is copied to the store, its conversation only once its thread was open', async ($, on) => {
  const held = memoryStore(on)
  await process($, on, 'sess-1', THREAD)
  await runSubagent($)
  const copy = held.get('session:sess-1') as typeof COPY
  expect(copy.agents.map(a => a.agentId)).toEqual(['a1'])
  // Nothing keeps a subagent's conversation while no thread is open.
  expect(copy.threads).toEqual({})
  const ui = await mount($)
  await ui.press({ key: 'view-a1' })
  await $.turn.complete({ turnId: 'm1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  const viewed = held.get('session:sess-1') as typeof COPY
  expect(viewed.threads.a1?.map(m => m.text)).toEqual(['Check the build.', 'Looking at the config.', 'The build is fine.'])
  // A tool call keeps only the arguments its line shows.
  expect((viewed.threads.a1?.[1] as { toolUses: { input: unknown }[] }).toolUses[0]?.input).toEqual({ file_path: '/repo/build.json' })
  expect(held.get('sessions')).toEqual(['sess-1'])
})

test('keep: a resumed session shows its subagents again, the run it ended in as failed, and the open thread from the copy', async ($, on) => {
  memoryStore(on, { 'session:sess-1': COPY, sessions: ['sess-1'] })
  // The new process cannot read the old conversation.
  await process($, on, 'sess-1', { deny: 'no agent a1' })
  const ui = await mount($)
  expect((await ui.findAll({ type: 'Markdown' })).map(el => String(el.props.text))).toEqual(['Check the build.', 'The build is fine.'])
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

test('keep: copies of the oldest sessions are dropped past the limit', async ($, on) => {
  const old = Array.from({ length: 10 }, (_, i) => `old-${i}`)
  const held = memoryStore(on, { sessions: old, ...Object.fromEntries(old.map(id => [`session:${id}`, COPY])) })
  await process($, on, 'sess-new', THREAD)
  await runSubagent($)
  const index = held.get('sessions') as string[]
  expect(index).toHaveLength(10)
  expect(index[0]).toBe('sess-new')
  expect(held.has('session:old-9')).toBe(false)
  expect(held.has('session:old-0')).toBe(true)
})

test('keep: a change to the panel is copied a moment later, before any turn ends', async ($, on) => {
  const held = memoryStore(on)
  const clock = await process($, on, 'sess-1', THREAD)
  await $.agent.spawn(SPAWN as never)
  expect(held.has('session:sess-1')).toBe(false)
  await clock.advance(2500)
  expect((held.get('session:sess-1') as typeof COPY).agents.map(a => a.status)).toEqual(['running'])
})
