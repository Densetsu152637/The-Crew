# Changelog

All notable changes to the-crew. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/) from 1.0.0 on; the surface that policy covers is listed in [docs/public-surface.md](docs/public-surface.md).

Version bumps before 0.13.0 were not committed one by one, so entries before 0.13.0 are grouped by the commits and README notes that survive and may not match each release boundary exactly.

## [Unreleased]

### Fixed
- The number of working subagents is right again. Which subagents are running now follows Claude Code's own agent list (`$.agent.list()` and each agent's `status`), read at start, at a subagent's turn end and a moment after it, and every 5 seconds while a subagent runs (never while nothing does). Before, the panel inferred it from spawn and turn-end events alone.
  - A subagent whose turn ended while the engine holds it on background work it owns (`waiting`: a background command, an Agent call, a plan's approval) stays running instead of reading finished until it woke.
  - A subagent with a tool call in flight (a permission prompt, a long command) stays running whatever the list says.
  - A subagent the engine stopped without a turn end (`killed`, `failed`) is finished instead of running for good, and one the engine has at work with no row gets one.
  - The band's `N running` counts the subagents at work, as the panel's Running section does. It counted only `savvy-*` Agent calls in flight, and a background call answers as soon as its agent starts, so it read 0 while agents worked.
  - A loop the engine's list does not name (its own forks for compaction or memory) no longer gets a row of its own.
  - A teammate's listed status is not followed: in a terminal pane of its own it is the last word it wrote in its team's roster, which a closed or dead pane leaves standing as `running`. It no longer puts up a row, wakes one, holds one running or keeps the list polled; a teammate's row follows its own events.
  - A read of the list asked for while one is under way runs once more after it instead of being dropped, so a change between the two is not missed until the next poll.
  - A tool call its turn left unanswered (a cancelled permission prompt) no longer holds the agent's row running after the turn ended.
  - A subagent whose turn was interrupted is not put back to running by a list that has not caught up yet; an event of its own (a turn, a step, a tool call, a message or a resume) wakes it.
- A subagent at work again goes first under Running however it is noticed. A model request or a tool call of a finished agent whose turn's start went unheard put it back to running where it stood, at the bottom of Running, under its old title; it is now renewed and moved first, as a resume or a message does. The collapsed strip orders its crabs the same way.

### Changed
- A session opened again moves to the front of the store's index, so a session in use is the last one dropped, however long ago it was first saved.
- Copies of sessions the Claude desktop app has archived are discarded at once: at start and every five minutes the panel reads the app's session records (`claude-code-sessions/**/local_*.json`), only those changed since the last scan, and drops the copies of those marked archived. The open session's copy is never dropped. Without the desktop app, nothing changes.

## [1.3.0] - 2026-11-17

### Fixed
- A busy session's panel no longer resets after a reload or resume. The store kept the ten most recently saved sessions whatever their size, so a run of short or empty sessions pushed a 200-subagent session's copy out. Copies are now kept by size: empty sessions are not stored, and older ones are dropped only once all copies together pass 3 MiB.
- A subagent reused after more than 200 others ran now shows as running again. The panel kept only the newest 200 rows, so an older agent's row (and its tokens and cost in the totals) was dropped and its reuse had no row to show. Every row is kept now, and a subagent that turns up at work with no row (a turn, a model request, a resume or a message to it) gets one, named from the engine's agent list.
- A save the store refuses no longer fails silently. The oldest other copies are dropped one at a time until it lands, and copies an index lost are swept at start.

### Changed
- The stored copy holds telemetry only (rows, tokens, cost, times, steps, the flow, the panel's settings). Subagent conversations are no longer copied; a thread is read from the session's transcript when opened.
- A copy stays under 1 MiB at any scale: past that, the oldest finished subagents are folded into one `N earlier subagents` row that carries their tokens, cost, steps and failures, so the panel's totals stay exact. Tested at 20,000 subagents and 1.2T tokens.
- A damaged row in a stored copy is skipped on its own instead of discarding the whole copy.
- Token counts of a trillion or more read as T (`1.20T`).

## [1.2.0] - 2026-11-09

### Fixed
- The panel no longer goes blank ("Nothing to show yet") in a long session with many subagents. The engine refuses a pane whose tree passes 100,000 characters serialized, and a 20-subagent session drew about 255,000. Every pane drawing is now spent from an 80,000-character budget: the newest rows are drawn in full while it lasts, keeping room for up to 40 more agents as one-line rows (title, which still opens the thread, and state), and any past those are counted on a `+N more not shown` line. The same session now draws about 79,000.

### Changed
- Crab drawings are paths, one per run of a colour, instead of a rect per pixel (about a quarter of the size), and a walking crab carries only its own costume's motion rules.
- A running time's glyphs inherit their styling from their strip, and the slow strips carry only the glyphs the next redraw can reach (a running row's text drawing went from about 18,000 to 3,000 characters).
- Each drawing carries the colour rules of the classes it uses, not all of them.
- A subagent's thread reads like the main transcript: its brief (cut to 1,200 characters), its replies, and each run of tool calls between them as one summary line (`Read 3 files, ran 2 commands`) instead of a line per call. Tool results are left out. The thread's size is spent from the same tree budget, newest first.
- A subagent's conversation is read only while its thread is open. Ending a subagent's turn no longer reads it, so the copy kept for a resumed session holds the conversations of threads that were opened.

## [1.1.2] - 2026-11-08

### Changed
- Token counts in M and B show two decimals (`12.35M`, `2.34B`) instead of one.

## [1.1.1] - 2026-11-08

### Fixed
- Token counts of a billion or more read as B (`2.3B`) instead of thousands of M (`2340.0M`).

## [1.1.0] - 2026-11-01

### Added
- A session resumed in a new process keeps its panel. The engine holds a plugin's state only for the process, so a session that sat inactive and was resumed came back with an empty panel and lost the open thread. The panel's flow, rows, main-session row and open thread are now copied to the plugin's store under the session's id a moment after they change (and at the end of every turn), together with each subagent's conversation, cut to what a thread draws. A resumed session restores them: runs that were still running when the old process ended read as finished with the error mark, and a thread the engine can no longer read is drawn from the kept copy. The copies of the ten most recent sessions are kept.

### Changed
- When a subagent's turn ends, the panel reads its conversation once to keep it.

## [1.0.1] - 2026-10-27

### Added
- `CONTRIBUTING.md` and agent instructions (`AGENTS.md`, loaded by `.claude/CLAUDE.md`): changes target the `experimental` branch, and a release into `main` needs the maintainer's explicit confirmation. CI also runs on pushes to `experimental`.

### Fixed
- On the desktop, a running time no longer redraws its drawing every second. The main session's row, each running subagent's row and the header's time tile wrote the time into their SVG, so the app loaded a new image per running row each second while anything ran; its renderer's handle count rose by about 300 a minute with the panel open. A running time is now drawn as digit strips moved by stepped CSS animations: the drawing counts by itself and changes only when its row does, or once a minute to correct a strip that was loaded again. On the desktop the panel's clock ticks once a minute; a panel drawn as text still ticks every second.

## [1.0.0] - 2026-10-26

First stable release. The [public surface](docs/public-surface.md) now follows semantic versioning: a breaking change to it needs a new major version.

### Changed
- No code changes from 0.15.0. The [live check](docs/live-check.md) passed in the Claude Code desktop app (2.1.308, Windows).

## [0.15.0] - 2026-10-26

### Added
- `tsc -p .` now passes from a clean clone: the engine's API declarations are vendored at `types/vendor/claude-code.d.ts` (pinned to Claude Code 2.1.308) and `tsconfig.json` is self-contained.
- A `CI` GitHub Actions workflow runs `claude plugin validate .`, `claude plugin test .`, `tsc -p .` and the costume check on every push to `main` and every pull request.
- A plugin icon (`.claude-plugin/icon.png`, the root crab), so `claude plugin validate .` reports no warnings.
- [docs/public-surface.md](docs/public-surface.md), the surface frozen for 1.0, and [docs/live-check.md](docs/live-check.md), a manual checklist for the desktop app.

### Changed
- A reused subagent is detected from its own events (a new prompt or delivered message in its conversation) instead of a 5-second poll, so no timer runs once every agent has finished.
- The progress bar's twinkle restarts in phase when its inputs change, and its drawing is reused while they don't.
- The hook that keeps an open thread current does no state reads unless the stored row belongs to the viewed or a finished agent.

### Fixed
- `hooks/view.test.ts` no longer queries a nonexistent `alt` field of the test kit's element query; it finds the row's drawing by its `alt` prop.

## [0.14.2] - 2026-10-26

### Fixed
- Crab animations are consistent and free of visual defects across costumes.

## [0.14.1] - 2026-10-26

### Changed
- **Breaking:** the `language` option is removed, and with it the Russian and Hebrew translations. The panel is English only, left to right.
- Row sprites are drawn in the flow of the row instead of as an overlay, which fixes sprites that were not drawn or were misplaced.

## [0.14.0] - 2026-10-26

### Changed
- **Breaking:** the mod is renamed to the-crew. The plugin id is `the-crew@the-crew`, the tools are `mcp__the-crew__progress` and `mcp__the-crew__step`, the pane is `crew-agents` and the command is `/crew`. It can be installed beside savvy-progress.

## [0.13.4] - 2026-10-26

### Fixed
- The crab overlay spans its row so the sprite is drawn.

## [0.13.3] - 2026-10-26

### Fixed
- Sprite animations keep looping across redraws instead of restarting.

## [0.13.2] - 2026-10-26

### Fixed
- An open subagent thread refreshes on each new message.

## [0.13.1] - 2026-10-26

### Added
- Generalist costume (beanie and a red Swiss army knife) for the `general-purpose` and `claude` agent types.

## [0.13.0] - 2026-10-26

### Changed
- Performance: animation CSS is emitted only for drawings with running work, so idle and finished crabs are static; the idle clock stops; rows are memoised and a thread's view is cached.

## [0.6.1 to 0.12.0] - 2026-10-24

### Added
- A subagent's thread in the panel: pressing a row's name replaces the agents list with its brief, replies and a line per tool call; it follows new messages at the bottom and has **‹ Agents** buttons at both ends to go back.
- A reused subagent (SendMessage, resume) moves back to Running on its new task, keeping its cost and tokens and leaving idle time out of its timer.

### Changed
- The thread scrolls natively, with a fixed header row for the back button.

## [0.5.1] - 2026-10-23

### Added
- Panel token totals split into input and output; an open-task button on a subagent's desktop row and a Back to main button on the main session's row.

### Fixed
- The `guide` costume has its own cap; the metric tiles stay when the pane is collapsed.

## [0.5.0] - 2026-10-23

### Added
- Costumes for Claude Code's built-in agent types (Explore, Plan, web-fetch, claude-code-guide, statusline-setup); the agent type, not the borrowed profile, is shown under the title.

## [0.4.0] - 2026-10-23

### Added
- Domain profile costumes (researcher, debugger, analyst, architect, auditor, navigator, inspector) and the animated costume gallery in the README.

### Removed
- The savvy-flow tier costumes and the built-in Explore pirate; savvy-flow agents wear the plain crab.

## [0.1.0] - 2026-10-23

### Added
- First release as crew-progress, a fork of [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz (MIT): the main session's own row (model, effort, context, estimated cost, time), a costume per workflow profile and the panel opening at session start.

[Unreleased]: https://github.com/Densetsu152637/The-Crew/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Densetsu152637/The-Crew/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/Densetsu152637/The-Crew/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/Densetsu152637/The-Crew/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Densetsu152637/The-Crew/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Densetsu152637/The-Crew/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Densetsu152637/The-Crew/releases/tag/v1.0.0
