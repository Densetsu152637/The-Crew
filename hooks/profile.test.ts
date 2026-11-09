import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PLUGIN = 'the-crew'
const pane = { title: '', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

// Each costume's own prop group: present only when that costume drew.
const PROP: Record<string, string> = {
  root: 'gem',
  manager: 'baton',
  explorer: 'lan',
  implementer: 'ham',
  validator: 'ck',
  critic: 'mono',
  documenter: 'quill',
  tester: 'bub',
  researcher: 'pg',
  debugger: 'net',
  analyst: 'bars',
  architect: 'sq',
  auditor: 'glint',
  navigator: 'cur',
  inspector: 'flash',
  generalist: 'blade',
  guide: 'flag',
  statusline: 'roller',
}

const engine = (on: On) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: `a-${e.tool_use_id}` }))
}

let n = 0
const spawn = ($: Engine, description: string, subagentType: string, prompt: string) =>
  $.agent.spawn({
    tool_use_id: `t${++n}`,
    prompt,
    description,
    subagentType,
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as never)

// The desktop row drawn for `description`: its SVG source, the crab's included.
const rowOf = async ($: Engine, description: string): Promise<string> => {
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'crew-agents', props: pane })
  const rows = await ui.findAll({ type: 'Svg' })
  const at = rows.findIndex(el => String(el.props.alt).startsWith(`${description}:`))
  await ui.unmount()
  // The row's text between its crab and its status mark.
  return [rows[at - 1], rows[at], rows[at + 1]].map(el => String(el?.props.source ?? '')).join('')
}

// Drawn as `role`: its costume, that costume's prop, and the role word under the title.
const expectRole = (source: string, role: string, word = role) => {
  expect(source).toContain(`class="c-${role} run"`)
  if (PROP[role]) expect(source).toContain(`<g class="${PROP[role]}">`)
  expect(source).toContain(`>${word}</tspan>`)
}

test('profile (a): a subagent type that names a profile', async ($, on) => {
  engine(on)
  await spawn($, 'Build the parser', 'implementer', 'Write the parser.')
  await spawn($, 'Run the suite', 'my-plugin:tester', 'Run the tests.')
  expectRole(await rowOf($, 'Build the parser'), 'implementer')
  expectRole(await rowOf($, 'Run the suite'), 'tester')
})

test('profile (a) wins over a brief tag', async ($, on) => {
  engine(on)
  await spawn($, 'Check the build', 'validator', 'Role: leaf; Profile: tester\nCheck it.')
  expectRole(await rowOf($, 'Check the build'), 'validator')
})

test('profile (b): the brief tag, exactly as the workflow writes it', async ($, on) => {
  engine(on)
  await spawn($, 'Write the docs', 'general-purpose', 'Role: leaf; Profile: documenter\nDocument the new flag.')
  expectRole(await rowOf($, 'Write the docs'), 'documenter')
})

test('profile (b): the first Profile tag counts, wherever it sits', async ($, on) => {
  engine(on)
  await spawn($, 'Review it', 'general-purpose', 'Task: review.\n  Role: leaf; Profile: CRITIC\nLater: Profile: tester')
  expectRole(await rowOf($, 'Review it'), 'critic')
})

test('profile (b) wins over a savvy tier', async ($, on) => {
  engine(on)
  await spawn($, 'Map the repo', 'savvy-careful', 'Role: leaf; Profile: explorer\nLook around.')
  expectRole(await rowOf($, 'Map the repo'), 'explorer')
})

test('profile (c): a savvy tier with no tag is the plain crab, labelled by its tier', async ($, on) => {
  engine(on)
  await spawn($, 'Heavy lifting', 'savvy-heavy', 'Do the hard part.')
  await spawn($, 'Careful work', 'savvy-careful', 'Take care.')
  for (const [description, tier] of [['Heavy lifting', 'heavy'], ['Careful work', 'careful']] as const) {
    const source = await rowOf($, description)
    expect(source).toContain('class="c-other run"')
    expect(source).not.toContain(`class="c-${tier}`)
    expect(source).toContain(`>${tier}</tspan>`)
  }
})

test('profile fallback: an unknown tag or no tag is the generalist for general-purpose, else other', async ($, on) => {
  engine(on)
  await spawn($, 'Odd tag', 'general-purpose', 'Role: leaf; Profile: wizard\nDo magic.')
  await spawn($, 'Plain one', 'general-purpose', 'No tag here.')
  for (const description of ['Odd tag', 'Plain one']) {
    const source = await rowOf($, description)
    expect(source).toContain('class="c-generalist run"')
    expect(source).toContain('>general-purpose</tspan>')
  }
  await spawn($, 'Mystery', 'mystery-agent', 'Go.')
  const mystery = await rowOf($, 'Mystery')
  expect(mystery).toContain('class="c-other run"')
  expect(mystery).toContain('>mystery-agent</tspan>')
})

test('profile (c): built-in agent types', async ($, on) => {
  engine(on)
  const cases: [string, string, string][] = [
    ['Explore', 'explorer', 'Explore'], ['explore', 'explorer', 'explore'], ['Plan', 'architect', 'Plan'],
    ['web-fetch', 'researcher', 'web-fetch'], ['general-purpose', 'generalist', 'general-purpose'],
    ['claude', 'generalist', 'claude'], ['claude-code-guide', 'guide', 'claude-code-guide'],
    ['statusline-setup', 'statusline', 'statusline-setup'],
  ]
  for (const [type] of cases) await spawn($, `Built-in ${type}`, type, 'Go.')
  for (const [type, role, word] of cases) expectRole(await rowOf($, `Built-in ${type}`), role, word)
  await spawn($, 'Tag wins', 'general-purpose', 'Role: leaf; Profile: debugger\nWhy?')
  expectRole(await rowOf($, 'Tag wins'), 'debugger')
})

test('profile (b): the domain profiles, from the brief tag', async ($, on) => {
  engine(on)
  await spawn($, 'Dig up sources', 'general-purpose', 'Role: leaf; Profile: researcher\nFind the papers.')
  await spawn($, 'Chase the crash', 'Explore', 'Role: leaf; Profile: debugger\nWhy does it crash?')
  expectRole(await rowOf($, 'Dig up sources'), 'researcher')
  expectRole(await rowOf($, 'Chase the crash'), 'debugger')
})

test('every profile has its own costume', async ($, on) => {
  engine(on)
  const profiles = [
    'manager', 'explorer', 'implementer', 'validator', 'critic', 'documenter', 'tester',
    'researcher', 'debugger', 'analyst', 'architect', 'auditor', 'navigator', 'inspector',
  ]
  // Each is checked as it starts: the newest running row, which is always drawn whole.
  for (const p of profiles) {
    await spawn($, `As ${p}`, 'general-purpose', `Role: leaf; Profile: ${p}\nGo.`)
    expectRole(await rowOf($, `As ${p}`), p)
  }
})

test('savvy workers still get the step line; a tagged brief is left as written', async ($, on) => {
  const prompts: string[] = []
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: `a-${e.tool_use_id}` }
  })
  await spawn($, 'Tagged', 'general-purpose', 'Role: leaf; Profile: implementer')
  await spawn($, 'Savvy', 'savvy-light', 'Go.')
  expect(prompts[0]).toBe('Role: leaf; Profile: implementer')
  expect(prompts[1]).toContain('mcp__the-crew__step')
})
