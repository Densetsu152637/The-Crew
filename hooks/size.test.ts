import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'the-crew'
const NOW = Date.parse('2026-11-09T12:00:00Z')
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
// The engine refuses a tree past 100,000 characters serialized, and the desktop then shows the pane empty.
const TREE_BOUND = 100_000
const PROFILES = ['implementer', 'explorer', 'tester', 'critic', 'researcher', 'debugger', 'auditor', 'navigator']

const session = async ($: Engine, on: On, messages: unknown = []) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { LANG: 'en_US.UTF-8' })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__the-crew__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${e.tool_use_id}` }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.messages', () => ({ value: messages }) as never)
  await $.session.start({ source: 'startup', cwd: '/repo', surface: 'desktop', isInteractive: true } as never)
  await $.turn.start({ turnId: 'm1', text: 'go' } as never)
}

// `count` subagents of mixed profiles, the first `done` of them finished.
const crowd = async ($: Engine, count: number, done: number) => {
  for (let i = 0; i < count; i++) {
    await $.agent.spawn({
      tool_use_id: `t${i}`,
      prompt: `Role: leaf; Profile: ${PROFILES[i % PROFILES.length]}`,
      description: `Task ${i}: a description of the work as long as the workflow writes them`,
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    } as never)
  }
  for (let i = 0; i < done; i++) {
    await $.turn.complete({ turnId: `s${i}`, agentId: `a-t${i}`, reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)
  }
}

const mount = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })

test('size: a session with many subagents stays within the tree bound and lists every agent', async ($, on) => {
  await session($, on)
  await crowd($, 40, 30)
  const ui = await mount($)
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(TREE_BOUND)
  // Every agent can still open its thread: drawn whole while the budget lasts, as one line after.
  expect((await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('view-'))).toHaveLength(40)
  // The running ones come first and are drawn whole.
  const alts = (await ui.findAll({ type: 'Svg' })).map(el => String(el.props.alt))
  expect(alts).toContain('Task 39: a description of the work as long as the workflow writes them: Opus 5.5, running')
  await ui.unmount()
})

test('size: past even one-line rows, the rest are counted', async ($, on) => {
  await session($, on)
  await crowd($, 200, 190)
  const ui = await mount($)
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(TREE_BOUND)
  expect(await ui.find({ type: 'Text', text: /^\+\d+ more not shown$/ })).toBeDefined()
  await ui.unmount()
})

test('size: a long thread with many tool calls stays within the tree bound', async ($, on) => {
  const thread = Array.from({ length: 300 }, (_, i) => ({
    role: 'assistant',
    text: `Step ${i}: "quoted" ${'words '.repeat(600)}`,
    toolUses: [{ tool_use_id: `u${i}`, tool: 'Bash', input: { command: 'ls' } }],
  }))
  await session($, on, thread)
  await crowd($, 1, 0)
  const ui = await mount($)
  await ui.press({ key: 'view-a-t0' })
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(TREE_BOUND)
  const texts = (await ui.findAll({ type: 'Markdown' })).map(el => String(el.props.text))
  expect(texts.at(-1)?.startsWith('Step 299: ')).toBe(true)
  await ui.unmount()
})
