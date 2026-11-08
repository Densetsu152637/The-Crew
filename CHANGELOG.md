# Changelog

All notable changes to the-crew. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/) from 1.0.0 on; the surface that policy covers is listed in [docs/public-surface.md](docs/public-surface.md).

Version bumps before 0.13.0 were not committed one by one, so entries before 0.13.0 are grouped by the commits and README notes that survive and may not match each release boundary exactly.

## [Unreleased]

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

[Unreleased]: https://github.com/Densetsu152637/The-Crew/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/Densetsu152637/The-Crew/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Densetsu152637/The-Crew/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Densetsu152637/The-Crew/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Densetsu152637/The-Crew/releases/tag/v1.0.0
