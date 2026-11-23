import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// Which subagents count as at work: the engine's agent list (`$.agent.list()`, AgentInfo.status) is the
// word on it, a tool call in flight holds an agent at work, and one at work again goes first under Running.

const PLUGIN = 'the-crew'
const PROGRESS = 'mcp__the-crew__progress'
const NOW = Date.parse('2026-11-23T12:00:00Z')
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
const USAGE = { model: 'claude-haiku-4-5', input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SPAWN = {
  prompt: 'Role: leaf; Profile: tester',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
}

type Listed = { id: string; description: string; type: string; status: string }

// The engine beneath the plugin. Each spawn `tN` starts agent `aN`; `host` is what `$.agent.list()` answers,
// changed by the tests as the engine's own view moves.
const engine = async ($: Engine, on: On) => {
  const host: Listed[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__the-crew__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-4-5', agentId: e.tool_use_id.replace(/^t/, 'a') }))
  on('agent.list', () => ({ value: host.map(h => ({ ...h })) }) as never)
  on('session.append', (_$, e, next) => next(e))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  // Spawns agent aN, listed running.
  const spawn = async (n: number, description: string) => {
    host.push({ id: `a${n}`, description, type: 'general-purpose', status: 'running' })
    await $.agent.spawn({ ...SPAWN, tool_use_id: `t${n}`, description } as never)
  }
  const status = (id: string, s: string) => {
    const h = host.find(x => x.id === id)
    if (h) h.status = s
  }
  const complete = (id: string, reason = 'answer') =>
    $.turn.complete({ turnId: `end-${id}`, agentId: id, reason, answer: 'ok', durationMs: 1, isAborted: reason === 'aborted' } as never)
  return { clock, host, spawn, status, complete }
}

// The panel's subagent rows top to bottom as the desktop draws them (`title: state`), and the Running count.
const panel = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const rows = (await ui.findAll({ type: 'Svg' }))
    .map(el => String(el.props.alt))
    .filter(alt => /, (running|finished)$/.test(alt) && !alt.startsWith('Main session:'))
    .map(alt => `${alt.slice(0, alt.indexOf(': '))}: ${alt.slice(alt.lastIndexOf(', ') + 2)}`)
  const heading = (await ui.findAll({ text: /^Running · \d+$/ })).map(el => /Running · (\d+)/.exec(JSON.stringify(el))?.[1])[0]
  await ui.unmount()
  return { rows, running: Number(heading ?? 0) }
}

test('working: a subagent whose tool call waits on a permission prompt stays running, whatever the list says', async ($, on) => {
  let answer: (v: unknown) => void = () => {}
  on('tool.call', { tool: 'Bash' }, () => new Promise(resolve => (answer = resolve)) as never)
  const { clock, spawn, status } = await engine($, on)
  await spawn(1, 'Build it')
  const call = $.tool.call({ tool: 'Bash', agentId: 'a1', command: 'make' } as never)
  await clock.settle()
  // The engine's list lags or calls it idle while the prompt waits: the call in flight holds it at work.
  status('a1', 'idle')
  await clock.advance(30_000)
  expect(await panel($)).toEqual({ rows: ['Build it: running'], running: 1 })
  // The call answers and the list says the agent ended: it is finished at the next read.
  answer({ result: 'ok' })
  await call
  status('a1', 'completed')
  await clock.advance(10_000)
  expect(await panel($)).toEqual({ rows: ['Build it: finished'], running: 0 })
})

test("working: a subagent whose turn ended while the engine holds it on its background work stays running", async ($, on) => {
  const { clock, spawn, status, complete } = await engine($, on)
  await spawn(1, 'Watch the build')
  status('a1', 'waiting')
  await complete('a1')
  expect(await panel($)).toEqual({ rows: ['Watch the build: running'], running: 1 })
  await clock.advance(30_000)
  expect((await panel($)).running).toBe(1)
  // The background work is done and so is the agent.
  status('a1', 'completed')
  await clock.advance(5000)
  expect(await panel($)).toEqual({ rows: ['Watch the build: finished'], running: 0 })
})

test('working: a loop the list shows waiting only after its turn ended is running again a moment later', async ($, on) => {
  const { clock, spawn, status, complete } = await engine($, on)
  await spawn(1, 'Background job')
  await complete('a1')
  expect((await panel($)).running).toBe(0)
  status('a1', 'waiting')
  await clock.advance(3000)
  expect(await panel($)).toEqual({ rows: ['Background job: running'], running: 1 })
})

test('working: a subagent the engine stopped with no turn end is finished, and the count drops', async ($, on) => {
  const { clock, spawn, status } = await engine($, on)
  await spawn(1, 'First')
  await spawn(2, 'Second')
  expect((await panel($)).running).toBe(2)
  status('a1', 'killed')
  await clock.advance(5000)
  expect(await panel($)).toEqual({ rows: ['Second: running', 'First: finished'], running: 1 })
})

test('working: an agent the engine has at work with no row gets one, running', async ($, on) => {
  const { clock, host, spawn } = await engine($, on)
  await spawn(1, 'Seen')
  host.push({ id: 'b1', description: 'Started unseen', type: 'Explore', status: 'running' })
  await clock.advance(5000)
  expect(await panel($)).toEqual({ rows: ['Started unseen: running', 'Seen: running'], running: 2 })
})

test('working: the count on the band is the subagents at work, background ones included', async ($, on) => {
  // Background Agent calls answer as soon as their agents start; the agents work on.
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'async_launched' } }) as never)
  const { clock, spawn, status, complete } = await engine($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate' } as never)
  await $.tool.call({ tool: 'Agent', subagent_type: 'savvy-light', description: 'One', prompt: 'go' } as never)
  await spawn(1, 'One')
  await spawn(2, 'Two')
  await spawn(3, 'Three')
  const label = async () => {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: band } as never)
    const text = (await ui.findAll({ text: /^Tasks / })).map(el => /Tasks [^"]*/.exec(JSON.stringify(el))?.[0])[0]
    await ui.unmount()
    return text
  }
  expect(await label()).toBe('Tasks 3 running')
  expect((await panel($)).running).toBe(3)
  await complete('a2')
  status('a2', 'completed')
  status('a3', 'failed')
  await clock.advance(5000)
  expect(await label()).toBe('Tasks 1 running')
  expect((await panel($)).running).toBe(1)
})

test('order: a finished subagent at work again goes first under Running, however it is noticed', async ($, on) => {
  const { clock, spawn, status, complete } = await engine($, on)
  await spawn(1, 'Alpha')
  await spawn(2, 'Beta')
  await spawn(3, 'Gamma')
  await complete('a1')
  status('a1', 'completed')
  await complete('a2')
  status('a2', 'completed')
  expect((await panel($)).rows).toEqual(['Gamma: running', 'Beta: finished', 'Alpha: finished'])

  // A model request of its loop whose turn's start went unheard.
  const stream = ($.turn.step as (e: unknown) => AsyncIterable<unknown>)({ index: 0, messageCount: 1, turnId: 'again', model: 'claude-haiku-4-5', agentId: 'a1' })
  for await (const _ of stream) void _
  status('a1', 'running')
  expect((await panel($)).rows).toEqual(['Alpha: running', 'Gamma: running', 'Beta: finished'])

  // A tool call of its loop.
  await $.tool.call({ tool: 'mcp__the-crew__step', agentId: 'a2', done: 0, total: 3 } as never)
  status('a2', 'running')
  expect((await panel($)).rows).toEqual(['Beta: running', 'Alpha: running', 'Gamma: running'])

  // The engine's list alone: Alpha finished again, then woken with no event heard.
  status('a1', 'completed')
  await complete('a1')
  await clock.advance(5000)
  expect((await panel($)).rows[0]).toBe('Beta: running')
  status('a1', 'running')
  await clock.advance(5000)
  expect(await panel($)).toEqual({ rows: ['Alpha: running', 'Beta: running', 'Gamma: running'], running: 3 })
})
