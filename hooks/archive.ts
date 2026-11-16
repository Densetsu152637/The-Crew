import type { EngineInterface } from 'claude-code'

// Archived sessions' copies are let go as soon as the panel learns of the archive. The engine raises no
// event for it: the Claude desktop app archives a session by marking its own record of it
// (`claude-code-sessions/**/local_<id>.json`, `isArchived: true`), which names the engine's session id as
// `cliSessionId` (and `lastAssistantCliSessionId`). The panel reads those records; a record unchanged since
// the last scan is not read again. Everything here is best effort: no desktop app, an unreadable record or
// a format that moved on means nothing is discarded, never that anything else is.

/** Where the desktop app may keep its session records, by platform, from the environment. */
export function recordRoots(env: { LOCALAPPDATA?: string; APPDATA?: string; HOME?: string; USERPROFILE?: string }): string[] {
  const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const home = slash(env.HOME || env.USERPROFILE || '')
  const roots: string[] = []
  if (env.LOCALAPPDATA) roots.push(`${slash(env.LOCALAPPDATA)}/Claude-Data`)
  if (env.APPDATA) roots.push(`${slash(env.APPDATA)}/Claude`)
  if (home) roots.push(`${home}/Library/Application Support/Claude`, `${home}/.config/Claude`)
  return roots
}

/** The engine session ids an archived record names; none for a record that is not archived. */
export function archivedIds(record: unknown): string[] {
  if (typeof record !== 'object' || record === null) return []
  const r = record as Record<string, unknown>
  if (r.isArchived !== true) return []
  return [r.cliSessionId, r.lastAssistantCliSessionId].filter((x, i, all): x is string => typeof x === 'string' && x !== '' && all.indexOf(x) === i)
}

const MAX_DEPTH = 4

/** Every `local_*.json` under `dir`, a few levels deep. */
async function records($: EngineInterface, dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const path = `${dir}/${e.name}`
    if (e.kind === 'dir') out.push(...(await records($, path, depth + 1)))
    else if (e.kind === 'file' && /^local_.*\.json$/.test(e.name)) out.push(path)
  }
  return out
}

/** The `claude-code-sessions` folders the desktop app keeps, under any of its data folders. */
async function sessionFolders($: EngineInterface, roots: readonly string[]): Promise<string[]> {
  const out: string[] = []
  for (const root of roots) {
    let entries
    try {
      entries = await $.fs.list(root)
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.kind !== 'dir') continue
      if (e.name === 'claude-code-sessions') out.push(`${root}/${e.name}`)
      else {
        // The Windows store build nests its data one folder down (`Claude-Data/<package>/`).
        try {
          if ((await $.fs.list(`${root}/${e.name}`)).some(x => x.kind === 'dir' && x.name === 'claude-code-sessions')) out.push(`${root}/${e.name}/claude-code-sessions`)
        } catch {
          // Not a data folder.
        }
      }
    }
  }
  return out
}

/** Per record: its last-seen change time, so an unchanged one is not read again in this process. */
const seen = new Map<string, number>()

export const resetArchiveScan = (): void => seen.clear()

/** The engine session ids of every session the desktop app has archived, as its records stand now. */
export async function scanArchived($: EngineInterface, roots: readonly string[]): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const folder of await sessionFolders($, roots)) {
    for (const path of await records($, folder)) {
      let mtime = 0
      try {
        mtime = (await $.fs.stat(path)).mtimeMs
      } catch {
        continue
      }
      if (seen.get(path) === mtime) continue
      try {
        for (const id of archivedIds(JSON.parse((await $.fs.read(path)) as string))) ids.add(id)
        seen.set(path, mtime)
      } catch {
        // Unreadable or mid-write: tried again next scan.
      }
    }
  }
  return ids
}
