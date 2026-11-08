import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'the-crew'
const NOW = Date.parse('2026-10-23T12:00:00Z')
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// What each model request reports: the main loop's on Opus 5.5 (200K of prompt, 5K
// out), a subagent's on Haiku 4.5.
const MAIN_USAGE = { model: 'claude-opus-5-5', input_tokens: 10_000, output_tokens: 5_000, cache_read_input_tokens: 190_000, cache_creation_input_tokens: 0 }
const SUB_USAGE = { model: 'claude-haiku-4-5', input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// The engine beneath the plugin, every hook registered before the first call on $:
// a session that began 65 s ago, as $.session.usage() reports it before any response.
const session = async ($: Engine, on: On) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__the-crew__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: { startedAt: NOW - 65_000, context: { window: 1_000_000 }, rateLimits: [] } }) as never)
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.step', async function* (_$, e) {
    const usage = (e as { usage?: unknown }).usage ?? (e.agentId ? SUB_USAGE : MAIN_USAGE)
    return { turnId: e.turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
}

const step = async ($: Engine, e: Record<string, unknown>) => {
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ index: 0, messageCount: 1, ...e })
  for await (const _ of stream) void _
}

// One main-loop turn, left running: its request at high effort.
const mainTurn = async ($: Engine) => {
  await $.turn.start({ text: 'hi', turnId: 'm1' } as never)
  await step($, { turnId: 'm1', model: 'claude-opus-5-5', effort: 'high' })
}

const endTurn = ($: Engine) => $.turn.complete({ turnId: 'm1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)

const terminal = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'crew-agents', props: pane })

test('root: the main session is the first row from the start, with no subagents', async ($, on) => {
  await session($, on)
  const ui = await terminal($)
  expect(await ui.find({ type: 'Text', text: /Main session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /root · —/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
})

test('root: model, effort, context, estimated cost and time of the main loop', async ($, on) => {
  await session($, on)
  await mainTurn($)
  const ui = await terminal($)
  expect(await ui.find({ type: 'Text', text: /root · Opus 5\.5 · high/ })).toBeDefined()
  // Context is the request's input side, 200K of the 1M window; cost (10K × 4 + 5K × 20 + 190K × 0.20) / 1M = 0.178.
  expect(await ui.find({ type: 'Text', text: /ctx 20% · 200k ≈\$0\.18 1:05/ })).toBeDefined()
})

test('root: the totals keep input and output tokens apart', async ($, on) => {
  await session($, on)
  await mainTurn($)
  const ui = await terminal($)
  // Input is the prompt side with cache reads (10K + 190K); output is the 5K written.
  expect(await ui.find({ type: 'Text', text: /≈\$0\.18 · 200k in · 5k out · 1:05/ })).toBeDefined()
})

test('root: billions of tokens read as B, not thousands of M', async ($, on) => {
  await session($, on)
  await $.turn.start({ text: 'hi', turnId: 'm1' } as never)
  const usage = { ...MAIN_USAGE, cache_read_input_tokens: 2_340_000_000 }
  await step($, { turnId: 'm1', model: 'claude-opus-5-5', effort: 'high', usage })
  const ui = await terminal($)
  expect(await ui.find({ type: 'Text', text: /· 2\.3B in · 5k out ·/ })).toBeDefined()
})

test("root: the engine's measure replaces the window figures", async ($, on) => {
  await session($, on)
  await mainTurn($)
  await endTurn($)
  await $.session.measure({ context: { tokens: 150_000, window: 200_000, percent: 75 }, rateLimits: [], changed: ['context'] } as never)
  const ui = await terminal($)
  expect(await ui.find({ type: 'Text', text: /ctx 75% · 150k ≈\$0\.18/ })).toBeDefined()
})

test('root: desktop draws a crowned row that walks while the turn runs and rests after', async ($, on) => {
  await session($, on)
  await mainTurn($)
  const rootRow = async () => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
    const svgs = await ui.findAll({ type: 'Svg' })
    const at = svgs.findIndex(el => String(el.props.alt).startsWith('Main session:'))
    const row = svgs[at]
    // The crab and the status mark are drawings of their own, either side of the row's text.
    const crab = String(svgs[at - 1]?.props.source) + String(svgs[at + 1]?.props.source)
    await ui.unmount()
    return { alt: String(row?.props.alt), source: String(row?.props.source) + crab }
  }

  const working = await rootRow()
  expect(working.alt).toBe('Main session: Opus 5.5, running')
  expect(working.source).toContain('class="c-root run"')
  expect(working.source).toContain('<g class="gem">')
  expect(working.source).toContain('>root</tspan>')

  await endTurn($)
  const resting = await rootRow()
  expect(resting.alt).toBe('Main session: Opus 5.5, idle')
  expect(resting.source).toContain('class="c-root"')
})

test("root: a subagent's turn does not touch the main row", async ($, on) => {
  await session($, on)
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'Role: leaf; Profile: tester',
    description: 'Side work',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as never)
  await step($, { turnId: 's', model: 'claude-haiku-4-5', agentId: 'a1' })
  const ui = await terminal($)
  expect(await ui.find({ type: 'Text', text: /root · —/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tester · Haiku 4\.5/ })).toBeDefined()
})
