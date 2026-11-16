import { expect, test } from 'claude-code/testing'

import type { AgentRun } from '../types'

import { FOLD_ID, SESSION_BYTES, STORE_BYTES, fitSnapshot, jsonBytes, reviveSnapshot, touchIndex } from './keep'
import type { Snapshot } from './keep'

const NOW = Date.parse('2026-10-24T12:00:00Z')
const near = (got: number, want: number): boolean => Math.abs(got - want) <= Math.abs(want) * 1e-9

// A session of `n` subagents that spent `tokens` prompt-side tokens between them; the last `running` still run.
const session = (n: number, tokens: number, running = 0): Snapshot => ({
  shape: 2,
  savedAt: NOW,
  flow: null,
  root: null,
  panel: { isCompact: false, isDoneCollapsed: true, viewing: '' },
  agents: Array.from({ length: n }, (_, i): AgentRun => ({
    id: `g${i}`, agentId: `a${i}`, type: 'general-purpose', role: 'implementer', description: `Task number ${i} of a very long session`,
    model: 'claude-sonnet-5-5', status: i >= n - running ? 'running' : i % 50 === 0 ? 'failed' : 'done',
    startedAt: NOW - (n - i) * 60_000, endedAt: i >= n - running ? undefined : NOW - (n - i) * 60_000 + 30_000,
    contextTokens: 120_000, contextMax: 200_000, inputTokens: tokens / n, outputTokens: 2_000_000, costUsd: 4.25, steps: 40, round: 1,
  })),
})

const sum = (s: Snapshot, k: 'inputTokens' | 'outputTokens' | 'costUsd' | 'steps'): number => s.agents.reduce((n, a) => n + a[k], 0)
const count = (s: Snapshot): number => s.agents.reduce((n, a) => n + (a.id === FOLD_ID ? a.folded ?? 0 : 1), 0)

test('scale: 20,000 subagents and 1T+ tokens fit one copy, with the totals exact', () => {
  const big = session(20_000, 1.2e12, 30)
  expect(jsonBytes(big)).toBeGreaterThan(SESSION_BYTES)
  const fitted = fitSnapshot(big)
  expect(jsonBytes(fitted)).toBeLessThanOrEqual(SESSION_BYTES)
  const back = reviveSnapshot(JSON.parse(JSON.stringify(fitted)))!
  expect(count(back)).toBe(20_000)
  expect(near(sum(back, 'inputTokens'), 1.2e12)).toBe(true)
  expect(sum(back, 'outputTokens')).toBe(sum(big, 'outputTokens'))
  expect(near(sum(back, 'costUsd'), sum(big, 'costUsd'))).toBe(true)
  expect(back.agents[0]?.id).toBe(FOLD_ID)
  // Failures folded and those kept as rows add up to every failure of the session.
  const keptFailed = back.agents.filter(a => a.id !== FOLD_ID && a.status === 'failed' && a.endedAt !== NOW).length
  expect((back.agents[0]?.foldedFailed ?? 0) + keptFailed).toBe(big.agents.filter(a => a.status === 'failed').length)
  // Every running row and the newest finished ones stay as rows of their own.
  expect(fitted.agents.filter(a => a.status === 'running')).toHaveLength(30)
  expect(fitted.agents.at(-1)?.id).toBe('g19999')
})

test('scale: folding again keeps the earlier fold\'s totals', () => {
  const once = fitSnapshot(session(20_000, 1e12))
  const grown = { ...once, agents: [...once.agents, ...session(5_000, 5e11).agents.map(a => ({ ...a, id: `n${a.id}` }))] }
  const twice = fitSnapshot(grown)
  expect(jsonBytes(twice)).toBeLessThanOrEqual(SESSION_BYTES)
  expect(count(twice)).toBe(25_000)
  expect(near(sum(twice, 'inputTokens'), 1.5e12)).toBe(true)
  expect(twice.agents.filter(a => a.id === FOLD_ID)).toHaveLength(1)
})

test('scale: a small session is stored as it is', () => {
  const small = session(200, 5e9)
  expect(fitSnapshot(small).agents).toEqual(small.agents)
})

test('scale: the index keeps sessions by size, not count, and always the one being saved', () => {
  const tiny = Array.from({ length: 1500 }, (_, i) => ({ id: `t${i}`, bytes: 500 }))
  expect(touchIndex(tiny, 'new', 2000).dropped).toEqual([])
  const full = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, bytes: SESSION_BYTES }))
  const { index, dropped } = touchIndex(full, 'new', SESSION_BYTES)
  expect(index.map(e => e.id)).toEqual(['new', 'b0', 'b1'])
  expect(dropped).toEqual(['b2', 'b3'])
  expect(index.reduce((n, e) => n + e.bytes, 0)).toBeLessThanOrEqual(STORE_BYTES)
  // The shape-1 index, a list of ids, still reads.
  expect(touchIndex(['x', 'y'], 'x', 10).index.map(e => e.id)).toEqual(['x', 'y'])
})
