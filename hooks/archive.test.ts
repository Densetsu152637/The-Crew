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

const COPY = (id: string) => ({
  shape: 2, savedAt: NOW, flow: null, root: null, panel: { isCompact: false, isDoneCollapsed: false, viewing: '' },
  agents: [{ id: `g-${id}`, agentId: `a-${id}`, type: 'general-purpose', role: 'tester', description: `Work of ${id}`, model: 'claude-haiku-4-5', status: 'done',
    startedAt: NOW - 60_000, endedAt: NOW, contextTokens: 0, contextMax: 0, inputTokens: 10, outputTokens: 10, costUsd: 0.01, steps: 1, round: 1 }],
})
const ROOT = 'C:/Users/me/AppData/Local/Claude-Data'
const SESSIONS = `${ROOT}/pkg/claude-code-sessions`

// A process of session `sessionId` over a desktop app whose records are `records` (file name to JSON), each at `mtime`.
const process = async ($: Engine, on: On, sessionId: string, records: Record<string, unknown>, store: Record<string, unknown>) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { LANG: 'en_US.UTF-8', LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local` })
  const files = new Map(Object.entries(records).map(([name, v]) => [`${SESSIONS}/acct/org/${name}`, { text: JSON.stringify(v), mtime: 1 }]))
  const reads: string[] = []
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('fs.list', (_$, e) => {
    const dir = norm(e.path)
    const kids = new Map<string, 'file' | 'dir'>()
    for (const f of files.keys()) {
      if (!f.startsWith(`${dir}/`)) continue
      const [first, ...rest] = f.slice(dir.length + 1).split('/')
      if (first) kids.set(first, rest.length > 0 ? 'dir' : 'file')
    }
    if (kids.size === 0) throw new Error(`ENOENT ${dir}`)
    return { value: [...kids].map(([name, kind]) => ({ name, kind, size: 1 })) } as never
  })
  on('fs.stat', (_$, e) => {
    const f = files.get(norm(e.path))
    if (!f) throw new Error('ENOENT')
    return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtime, isLink: false } } as never
  })
  on('fs.read', (_$, e) => {
    const f = files.get(norm(e.path))
    if (!f) throw new Error('ENOENT')
    reads.push(norm(e.path))
    return { value: f.text } as never
  })
  on('settings.read', async () => ({ value: {} }) as never)
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__the-crew__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', async () => ({ cwd: '/repo' }) as never)
  on('session.id', () => ({ value: sessionId }) as never)
  const held = new Map<string, unknown>(Object.entries(store))
  on('store.get', (_$, e) => ({ value: held.get(e.key) }) as never)
  on('store.set', (_$, e) => { held.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined } as never })
  on('store.delete', (_$, e) => { held.delete(e.key); return { value: undefined } as never })
  on('store.keys', () => ({ value: [...held.keys()] }) as never)
  await $.session.start({ source: 'resume', cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(10)
  return { clock, held, files, reads }
}

const ids = (held: Map<string, unknown>): string[] => (held.get('sessions') as { id: string }[]).map(e => e.id)

test('archive: copies of sessions the desktop app archived are discarded at start, the rest kept', async ($, on) => {
  const { held } = await process($, on, 'live', {
    'local_1.json': { isArchived: true, cliSessionId: 'old-a', lastAssistantCliSessionId: 'old-b' },
    'local_2.json': { isArchived: false, cliSessionId: 'kept' },
    'local_3.json': { isArchived: true, cliSessionId: 'live' },
    'local_4.json': 'not a record',
  }, {
    sessions: ['live', 'old-a', 'kept', 'old-b'],
    'session:live': COPY('live'), 'session:old-a': COPY('old-a'), 'session:old-b': COPY('old-b'), 'session:kept': COPY('kept'),
  })
  expect(held.has('session:old-a')).toBe(false)
  expect(held.has('session:old-b')).toBe(false)
  // The open session's own copy stays even if its record says archived.
  expect(held.has('session:live')).toBe(true)
  expect(held.has('session:kept')).toBe(true)
  expect(ids(held)).toEqual(['live', 'kept'])
})

test('archive: a session archived later is discarded at the next scan; unchanged records are not read again', async ($, on) => {
  const { held, clock, files, reads } = await process($, on, 'live', { 'local_1.json': { isArchived: false, cliSessionId: 'later' } }, {
    sessions: ['live', 'later'], 'session:live': COPY('live'), 'session:later': COPY('later'),
  })
  expect(held.has('session:later')).toBe(true)
  const before = reads.length
  await clock.advance(5 * 60_000 + 10)
  expect(reads.length).toBe(before)
  files.set(`${SESSIONS}/acct/org/local_1.json`, { text: JSON.stringify({ isArchived: true, cliSessionId: 'later' }), mtime: 2 })
  await clock.advance(5 * 60_000 + 10)
  expect(held.has('session:later')).toBe(false)
})

test('archive: no desktop app records changes nothing', async ($, on) => {
  const { held } = await process($, on, 'live', {}, { sessions: ['live', 'x'], 'session:live': COPY('live'), 'session:x': COPY('x') })
  expect(held.has('session:x')).toBe(true)
})

test('keep: a resumed session moves first in the index, so it is the last dropped however old', async ($, on) => {
  const old = Array.from({ length: 5 }, (_, i) => `s${i}`)
  const { held } = await process($, on, 's4', {}, { sessions: old.map(id => ({ id, bytes: 100 })), ...Object.fromEntries(old.map(id => [`session:${id}`, COPY(id)])) })
  expect(ids(held)).toEqual(['s4', 's0', 's1', 's2', 's3'])
})
