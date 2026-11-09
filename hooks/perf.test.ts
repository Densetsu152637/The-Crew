import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'the-crew'
const PROGRESS = 'mcp__the-crew__progress'
const NOW = Date.parse('2026-10-25T12:00:00Z')
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const band = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} }
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
const THREAD = [{ role: 'assistant', text: 'Looking.', toolUses: [] }]
// What each agent's conversation holds now; a test pushes a row here, then raises the event that stored it.
const rows: Record<string, unknown[]> = {}
let current: ReturnType<typeof mock.clock> | undefined

// The engine beneath the plugin; `calls` counts what the tests watch. No agent is spawned yet.
const session = async ($: Engine, on: On) => {
  const calls = { messages: 0 }
  rows.a1 = [...THREAD]
  rows.a2 = [...THREAD]
  const clock = mock.clock(on, { now: NOW })
  current = clock
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__the-crew__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-4-5', agentId: e.tool_use_id === 't2' ? 'a2' : 'a1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
  on('session.messages', (_$, e) => {
    calls.messages++
    return { value: [...(rows[e.agentId ?? ''] ?? [])] as never }
  })
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  return { clock, calls }
}

const spawn = ($: Engine) => $.agent.spawn(SPAWN as never)
const finish = ($: Engine) =>
  $.turn.complete({ turnId: 's1', agentId: 'a1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)

const sources = async ($: Engine, component: 'Pane' | 'AbovePrompt') => {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component,
    requestId: component === 'Pane' ? 'crew-agents' : undefined,
    props: component === 'Pane' ? pane : band,
  } as never)
  const svgs = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.source))
  await ui.unmount()
  return svgs
}

test('perf: a finished or idle panel and bar draw no animation', async ($, on) => {
  await session($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 1 } as never)
  await spawn($)
  // Running: the bar and the row animate, in a few elements.
  const live = [...(await sources($, 'AbovePrompt')), ...(await sources($, 'Pane'))].join('')
  expect(live).toContain('infinite')
  const bar = (await sources($, 'AbovePrompt'))[0] ?? ''
  expect(bar.match(/<g class="t[0-3]"/g)?.length ?? 0).toBeLessThanOrEqual(8)
  expect(bar.match(/<rect class="t\d"/g)).toBeNull()

  await finish($)
  await $.tool.call({ tool: PROGRESS, done: 1, finished: true } as never)
  const still = [...(await sources($, 'AbovePrompt')), ...(await sources($, 'Pane'))].join('')
  expect(still).not.toContain('infinite')
  expect(still).not.toContain('@keyframes')
})

// The main session's row says how long it has run by the panel's `now`, which only the clock ticker and events move.
const mainTime = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const row = (await ui.findAll({ type: 'Svg' })).find(el => String(el.props.alt).startsWith('Main session:'))
  await ui.unmount()
  return timeOf(String(row?.props.source))
}

// The time a row's drawing shows: written as text, or, running on the desktop, the time its clock was drawn at.
const timeOf = (src: string) => {
  const m = /class="clk" aria-label="(\d+:\d\d)"|\s(\d+:\d\d)<\/text>/.exec(src)
  return m?.[1] ?? m?.[2]
}

test('perf: the clock ticks only while the main turn runs', async ($, on) => {
  const { clock } = await session($, on)
  await clock.advance(60_000)
  expect(await mainTime($)).toBe('0:00')

  await $.turn.start({ text: 'go', turnId: 'm1' } as never)
  await clock.advance(3000)
  expect(await mainTime($)).toBe('1:03')

  await $.turn.complete({ turnId: 'm1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  // Nothing runs: the clock is cancelled, no tick moves the panel's time on.
  await clock.advance(60_000)
  expect(await mainTime($)).toBe('1:03')

  // The next turn starts it again.
  await $.turn.start({ text: 'again', turnId: 'm2' } as never)
  await clock.advance(2000)
  expect(await mainTime($)).toBe('2:05')
})

test('perf: the clock stops when the last agent finishes and starts with the next one', async ($, on) => {
  const { clock } = await session($, on)
  await spawn($)
  await clock.advance(3000)
  expect(await mainTime($)).toBe('0:03')

  await finish($)
  await clock.advance(60_000)
  expect(await mainTime($)).toBe('0:03')

  await $.turn.start({ text: 'again', turnId: 's2', agentId: 'a1' } as never)
  await clock.advance(2000)
  expect(await mainTime($)).toBe('1:05')
})

// The desktop loads a drawing anew whenever its markup changes, and kept every one it loaded: a running
// time must count in the drawing, not by drawing it again each second.
test("perf: on the desktop a running row's drawing holds for the minute while its time counts by itself", async ($, on) => {
  const { clock } = await session($, on)
  await spawn($)
  await finish($)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', description: 'Second task' } as never)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const source = async (title: string) =>
    String((await ui.findAll({ type: 'Svg' })).find(el => String(el.props.alt).startsWith(`${title}:`))?.props.source)
  const header = async () => String((await ui.findAll({ type: 'Svg' })).find(el => String(el.props.alt).includes('in ·'))?.props.source)
  const done1 = await source('Side work')
  const run1 = await source('Second task')
  const head1 = await header()
  expect(run1).toContain('class="clk"')
  expect(head1).toContain('class="clk"')
  await clock.advance(3000)
  expect(await source('Side work')).toBe(done1)
  expect(await source('Second task')).toBe(run1)
  expect(await header()).toBe(head1)

  // Once a minute the clock redraws it, from the time then: the minute's tick came at 1:00.
  await clock.advance(60_000)
  const run2 = await source('Second task')
  expect(run2).not.toBe(run1)
  expect(timeOf(run2)).toBe('1:00')
  await ui.unmount()
})

// Per strip, the delay its animation starts at: the seconds into its cycle the time was when drawn.
const strips = (src: string) =>
  [...src.matchAll(/\.q\d\{animation:q(\d+)x\d+ (\d+)s steps\(\d+\) -([\d.]+)s infinite\}/g)].map(m => ({
    glyphs: Number(m[1]),
    period: Number(m[2]),
    delay: Number(m[3]),
  }))

test('clock: each place starts where the elapsed time is in its cycle', async ($, on) => {
  const { clock } = await session($, on)
  await $.turn.start({ text: 'go', turnId: 'm1' } as never)
  // 2:37.5 into the turn's session.
  await clock.advance(157_500)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const row = String((await ui.findAll({ type: 'Svg' })).find(el => String(el.props.alt).startsWith('Main session:'))?.props.source)
  await ui.unmount()
  expect(timeOf(row)).toBe('2:38')
  // Seconds, tens of seconds, minutes, and the minutes' tens with the hours.
  expect(strips(row)).toEqual([
    { glyphs: 10, period: 10, delay: 7.5 },
    { glyphs: 6, period: 60, delay: 37.5 },
    { glyphs: 10, period: 600, delay: 157.5 },
    { glyphs: 60, period: 36000, delay: 157.5 },
  ])
  // The slow strips carry only the glyphs the next redraw can reach: none of the second hour's yet.
  expect(row).not.toContain('>1:0</text>')
})

test('clock: a desktop panel ticks once a minute, a text panel every second', async ($, on) => {
  // Each tick moves the panel's `now`, and while the turn waits nothing else is stored.
  let ticks = 0
  on('state.set', (_$, e, next) => {
    ticks++
    return next(e)
  })
  const { clock } = await session($, on)
  await $.turn.start({ text: 'go', turnId: 'm1' } as never)
  const desk = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  await clock.advance(1000)
  ticks = 0
  await clock.advance(30_000)
  expect(ticks).toBeLessThanOrEqual(1)
  await desk.unmount()

  // A panel drawn as text as well needs its times moved each second.
  const text = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'crew-agents', props: pane })
  await clock.advance(1000)
  ticks = 0
  await clock.advance(30_000)
  expect(ticks).toBeGreaterThanOrEqual(29)
  await text.unmount()
})

// A row stored in an agent's conversation; the redraw it asks for settles on the mocked clock.
const note = async ($: Engine, agentId: string, text: string) => {
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] }, agentId } as never)
  await current?.settle()
}

const thread = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  await ui.press({ key: 'view-a1' })
  return ui
}
const texts = async (ui: Awaited<ReturnType<typeof thread>>) => (await ui.findAll({ type: 'Markdown' })).map(el => String(el.props.text))

test('perf: a thread is fetched once, not on every clock tick', async ($, on) => {
  const { clock, calls } = await session($, on)
  await spawn($)
  const ui = await thread($)
  expect(calls.messages).toBe(1)
  await clock.advance(5000)
  expect(calls.messages).toBe(1)
  await ui.unmount()
})

test('thread: a row stored for the viewed agent is fetched once and shown', async ($, on) => {
  const { calls } = await session($, on)
  await spawn($)
  const ui = await thread($)
  expect(await texts(ui)).toEqual(['Looking.'])
  rows.a1?.push({ role: 'assistant', text: 'Found it.', toolUses: [] })
  await note($, 'a1', 'Found it.')
  expect(calls.messages).toBe(2)
  expect(await texts(ui)).toEqual(['Looking.', 'Found it.'])
  await ui.unmount()
})

test("thread: another agent's rows fetch nothing", async ($, on) => {
  const { calls } = await session($, on)
  await spawn($)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', description: 'Other work' } as never)
  const ui = await thread($)
  await note($, 'a2', 'Elsewhere.')
  expect(calls.messages).toBe(1)
  await ui.unmount()
})

test('thread: a step whose row is stored later still shows once it is stored', async ($, on) => {
  const { calls } = await session($, on)
  await spawn($)
  const ui = await thread($)
  const stepped = $.turn.step as (e: unknown) => AsyncIterable<unknown>
  for await (const _ of stepped({ index: 0, messageCount: 1, turnId: 's1', model: 'claude-haiku-4-5', agentId: 'a1' })) void _
  // The step's reply is not stored yet: the thread is as it was.
  expect(await texts(ui)).toEqual(['Looking.'])
  rows.a1?.push({ role: 'assistant', text: 'Late reply.', toolUses: [] })
  await note($, 'a1', 'Late reply.')
  expect(await texts(ui)).toEqual(['Looking.', 'Late reply.'])
  expect(calls.messages).toBeLessThanOrEqual(3)
  await ui.unmount()
})

test('thread: closing the thread stops the fetches', async ($, on) => {
  const { calls } = await session($, on)
  await spawn($)
  const ui = await thread($)
  await ui.press({ key: 'back' })
  const before = calls.messages
  await note($, 'a1', 'After close.')
  expect(calls.messages).toBe(before)
  // Its turn ending reads nothing either: a conversation is read only while its thread is open.
  await finish($)
  expect(calls.messages).toBe(before)
  await ui.unmount()
})

// Animations run on the compositor, from the moment an image loads: a drawing whose markup changes is
// loaded again and every animation in it starts over. So what moves must not change while it runs.
// A running time's drawing is left out: its clock starts where the time is (see the clock tests).
const moving = async ($: Engine, component: 'Pane' | 'AbovePrompt') =>
  (await sources($, component)).filter(src => src.includes('infinite') && !src.includes('class="clk"'))

test('anim: a running row and the running band keep their markup across ticks and redraws', async ($, on) => {
  const { clock } = await session($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2 } as never)
  await spawn($)
  const first = { pane: await moving($, 'Pane'), band: await moving($, 'AbovePrompt') }
  // The main row is idle: the agent's crab and its pulse, and in the band the twinkle and the crab.
  expect(first.pane.length).toBeGreaterThan(0)
  expect(first.band).toHaveLength(1)
  const stepped = $.turn.step as (e: unknown) => AsyncIterable<unknown>
  for (const gap of [1000, 300, 700, 1000]) {
    await clock.advance(gap)
    if (gap === 300) {
      for await (const _ of stepped({ index: 0, messageCount: 1, turnId: 's1', model: 'claude-haiku-4-5', agentId: 'a1' })) void _
      await note($, 'a1', 'More.')
    }
    expect(await moving($, 'Pane')).toEqual(first.pane)
    expect(await moving($, 'AbovePrompt')).toEqual(first.band)
  }
})

test('anim: every running drawing carries the CSS that moves it', async ($, on) => {
  const { clock } = await session($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 2 } as never)
  await $.turn.start({ text: 'go', turnId: 'm1' } as never)
  await spawn($)
  for (let i = 0; i < 3; i++) {
    for (const src of [...(await sources($, 'Pane')), ...(await sources($, 'AbovePrompt'))]) {
      if (src.includes(' run"')) expect(src).toContain('.run .la{animation')
      if (src.includes('class="live"')) expect(src).toContain('.live{animation')
      if (/class="t[0-3]"/.test(src)) expect(src).toContain('@keyframes tw')
      if (src.includes('class="clk"')) expect(src).toMatch(/@keyframes q10x\d+/)
    }
    await clock.advance(1000)
  }
})

// A pane row's images sit in flow, side by side: an image laid over another by an absolute Box was
// not painted by the desktop. The pane's content as a whole sits in one absolute Box over its grid;
// no Svg may be in a second one inside it, and each says what it shows.
test('rows: every image is in flow and has an alt', async ($, on) => {
  await session($, on)
  await $.turn.start({ text: 'go', turnId: 'm1' } as never)
  await spawn($)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 't2', description: 'Other work' } as never)
  await finish($)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const found: { alt: string; absolute: number }[] = []
  const walk = (node: unknown, absolute: number): void => {
    if (Array.isArray(node)) return node.forEach(n => walk(n, absolute))
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown }
    const here = absolute + (n.props?.position === 'absolute' ? 1 : 0)
    if (n.type === 'Svg') found.push({ alt: String(n.props?.alt ?? ''), absolute })
    walk(n.children ?? n.props?.children, here)
  }
  walk(await ui.drawn(), 0)
  await ui.unmount()
  expect(found.length).toBeGreaterThanOrEqual(10)
  expect(found.filter(f => f.absolute > 1)).toHaveLength(0)
  expect(found.filter(f => !f.alt)).toHaveLength(0)
})

test('reuse: no timer is left once the agents finish, and the engine list is never polled', async ($, on) => {
  let listed = 0
  on('agent.list', () => {
    listed++
    return { value: [] } as never
  })
  const { clock } = await session($, on)
  await spawn($)
  await finish($)
  await clock.advance(600_000)
  expect(listed).toBe(0)
  expect(await mainTime($)).toBe('0:00')
})

// The band's twinkle delays are set from the clock when it is drawn: a restart lands in phase.
const delays = (src: string): number[] => [...src.matchAll(/\.t\d\{animation:tw [\d.]+s ease-in-out -([\d.]+)s infinite\}/g)].map(m => Number(m[1]))

test('band: the twinkle restarts in phase when its progress changes, and stays still when nothing runs', async ($, on) => {
  const { clock } = await session($, on)
  await $.tool.call({ tool: PROGRESS, title: 'Ship it', phase: 'delegate', total: 4 } as never)
  await spawn($)
  const first = (await sources($, 'AbovePrompt'))[0] ?? ''
  const periods = [2.2, 2.8, 1.9, 3.3]
  const offsets = [0, 0.7, 1.3, 0.4]
  const expected = (ms: number) => periods.map((p, i) => Number((((ms / 1000 + (offsets[i] ?? 0)) % p)).toFixed(2)))
  expect(delays(first)).toEqual(expected(NOW))
  await clock.advance(1234)
  // Nothing about the bar changed: the same drawing, not loaded again.
  expect((await sources($, 'AbovePrompt'))[0]).toBe(first)
  await clock.advance(4321)
  await $.tool.call({ tool: PROGRESS, done: 1 } as never)
  const later = (await sources($, 'AbovePrompt'))[0] ?? ''
  expect(later).not.toBe(first)
  expect(delays(later)).toEqual(expected(NOW + 1234 + 4321))
  await finish($)
  expect((await sources($, 'AbovePrompt')).join('')).not.toContain('infinite')
})

test("session.append: a row of an agent whose thread is not open reads no state", async ($, on) => {
  let reads = 0
  on('state.get', (_$, e, next) => {
    reads++
    return next(e)
  })
  await session($, on)
  await spawn($)
  reads = 0
  await note($, 'a1', 'Elsewhere.')
  expect(reads).toBe(0)
})
