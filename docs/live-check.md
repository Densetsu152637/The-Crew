# Live check (desktop app)

`claude plugin test` runs the hooks against the engine's test kit, which does not paint a pane, so a release is checked by eye in the desktop app. Run this before tagging. Use a session with the mod loaded (installed from the marketplace, or via `claude --plugin-dir <this folder>`) and note the Claude Code version.

## Checklist

1. **Panel opens at start.** With `openAtStart: on` (the default), a new session shows the **Agents** pane without typing anything. With `off` it does not, and opens at the first subagent (with `autoOpen: any`) or on `/crew`.
2. **`/crew`.** Closes the open panel and opens a closed one. `/crew open` opens it, or brings it forward, and never closes an open one.
3. **Main row.** The first row is the main session with its crown, model, effort, context fill, estimated cost and time. The time counts up while it works.
4. **Rows draw with crabs.** Start several subagents of different kinds (an `implementer`, an `Explore`, a `general-purpose`, and one whose brief contains `Role: leaf; Profile: critic`). Each row shows the right costume, its title, model, context and a status mark; no row is blank, overlapped or cut off.
5. **Animation follows status.** Crabs move only while their agent runs. A finished, failed or idle agent's crab is static, and the main row is static between turns. After everything finishes, nothing in the panel keeps moving (watch for a minute).
6. **Status dot pulse.** A running row's status mark pulses; a finished row's does not.
7. **Subagent thread.** Press a subagent row's name. The list is replaced by that agent's brief, replies and a line per tool call, opening at the newest message. While the agent still runs, new messages appear without reopening the thread, and the view follows them while you are at the bottom; scroll up and it stays put, scroll back to the end and it follows again.
8. **Back button.** **‹ Agents** at the top, and again below the newest message, returns to the list.
9. **Reused subagent.** Message a finished subagent again (SendMessage or a resume). It moves back to the top of Running, its title becomes the new task, its cost and tokens are kept, and its timer leaves out the time it sat finished.
10. **Running count.** With several subagents at work, Running · N (and the band's `N running`, for a flow reported without a total) equals the subagents actually working. A subagent waiting on a permission prompt, or on its own background command, stays under Running; one stopped from the tasks view leaves it within a few seconds.
11. **Band progress bar.** Have the main session call `mcp__the-crew__progress` with a title, tasks and a phase. A bar with its label and percent appears above the prompt, advances with `done`, shows finished with `finished: true`, and **✕** dismisses it. The crew button in the band opens the panel.
12. **Step reporting.** A worker that calls `mcp__the-crew__step` shows a bar of its own steps and the note; one that does not shows its context fill in grey.
13. **Light and dark theme.** Switch the app between light and dark: text, rows, bars, dividers and status marks stay legible, the crabs keep their contrast, and no drawing sits on a white or black box.
14. **Collapse.** The collapse control shrinks the rows to a strip of crabs and keeps the header tiles; expanding restores the list.
15. **Reduced motion.** With the operating system's reduce-motion setting on, no crab animates.

Record the outcome in the release notes or the PR: Claude Code version, platform, and any item that failed.

## What the other surfaces draw

From the code in `hooks/register.tsx`, not from running them:

- **Terminal.** The pane draws text rows, not SVG: the SVG branch is `e.surface === 'desktop' && 'Svg' in ui` (line 1264), and the terminal text rows follow from line 1394 ("Terminal: the same content in text rows"). The band uses its SVG row only when `e.surface !== 'terminal' && 'Svg' in ui` (line 1511) and otherwise draws a text bar (from line 1528). Text rows have no crabs and no animation.
- **Subagent thread.** Desktop only: `isThread` requires `e.surface === 'desktop' && 'Svg' in ui` (line 1227). The terminal's rows open nothing (covered by the test "the terminal panel's rows open nothing").
- **VS Code and mobile.** By the same conditions, the pane takes the text-row path (it is SVG only on `desktop`), and the band takes its SVG row if the surface's element table has `Svg`. Whether those hosts place a plugin pane or band at all, and whether their table has `Svg`, is unverified: nothing here tests it.

## If something fails

- Run the session with `claude --debug` and read the log. A hook that fails is skipped and the chain continues; the log has a line for every occurrence and every result the engine refused, prefixed `the-crew:`. A tree the engine rejects shows as `ui.render hook skipped`.
- Run `claude plugin validate .` and `claude plugin test .`; they catch manifest and hook problems without the app.
- Try `/reload-plugins`, or restart the session, to rule out a stale load.
- File an issue at <https://github.com/Densetsu152637/The-Crew/issues> with the Claude Code version, the surface (desktop, terminal, VS Code or mobile), the checklist item that failed, what you saw, and the debug lines for `the-crew`.
