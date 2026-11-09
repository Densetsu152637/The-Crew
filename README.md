# the-crew

A Claude Code mod: a live panel of your crew (the main session plus every subagent) and a progress bar above the prompt. It is a fork of [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by [johnnyvizz](https://github.com/johnnyvizz), MIT licensed, with three additions:

- **Main session row.** The panel's first row is the main session itself, wearing a crown: its model and effort, how full its context window is, an estimated cost, and how long the session has run. It walks while a main turn runs and rests between turns.
- **A costume per workflow profile.** A subagent is drawn as the profile it was dispatched with, each with its own pixel-crab costume and colour, instead of the generic crab.
- **A subagent's thread in the panel.** In the desktop app's panel, clicking a subagent row's name replaces the agents list with that agent's conversation, read as the main transcript reads: its brief, its replies, and each run of tool calls as one summary line (`Read 3 files, ran 2 commands`). The conversation is read only while its thread is open; otherwise the rows follow the agents' events alone. It opens at the newest message and follows new ones while you stay at the bottom; scroll up to read back, and scroll to the bottom again to resume following. **‹ Agents** at the top and again below the newest message goes back to the list.
- **Reused subagents run again.** A finished subagent that is messaged again (SendMessage, a resume, or any run the engine reports) moves back to the running list on its new task: its title becomes the message's summary (or its first line), its role follows a new brief's `Profile:` tag, and its reported steps start over. Its cost and tokens are kept, and its timer leaves out the time it sat finished.
- **Long sessions stay drawn.** The engine refuses a pane past 100,000 characters, which a session with dozens of subagents used to reach, leaving the panel empty. The newest rows are drawn in full while that budget lasts, the rest as one line each (title and state; the title still opens the thread), and any past those are counted.
- **Resumed sessions keep the panel.** The rows, the main session's row, the open thread and the conversations of threads you opened are copied to the plugin's store as they change, so a session resumed after sitting inactive shows its history instead of an empty panel. Runs that were still running when the old process ended read as finished with the error mark. The ten most recent sessions are kept.

Everything else works as in savvy-progress: running, finished and planned subagents with model, effort, task progress, context, estimated cost and time; the savvy-flow tiers (their names, colours and models, drawn as the plain crab since 0.4.0); the progress bar for orchestrated flows.

## Costume gallery

Every crab the mod ships, as it looks while its agent runs (`prefers-reduced-motion` stops the animation). The images are generated from the drawing code; see [Development](#development).

<table>
<tr><td align="center" width="25%"><img src="media/costumes/root.svg" width="128" height="128" alt="root crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.root.md">root</a></b><br><sub>gold crown with jewels; the jewels sparkle</sub></td><td align="center" width="25%"><img src="media/costumes/manager.svg" width="128" height="128" alt="manager crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.manager.md">manager</a></b><br><sub>headset with mic and a conductor's baton; the baton conducts</sub></td><td align="center" width="25%"><img src="media/costumes/explorer.svg" width="128" height="128" alt="explorer crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.explorer.md">explorer</a></b><br><sub>pith helmet and a lantern; the lantern swings</sub></td><td align="center" width="25%"><img src="media/costumes/implementer.svg" width="128" height="128" alt="implementer crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.implementer.md">implementer</a></b><br><sub>bandana and a claw hammer; the hammer strikes</sub></td></tr>
<tr><td align="center" width="25%"><img src="media/costumes/documenter.svg" width="128" height="128" alt="documenter crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.documenter.md">documenter</a></b><br><sub>scroll and a quill; the quill writes</sub></td><td align="center" width="25%"><img src="media/costumes/tester.svg" width="128" height="128" alt="tester crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.tester.md">tester</a></b><br><sub>lab goggles and a flask; the bubbles rise</sub></td><td align="center" width="25%"><img src="media/costumes/validator.svg" width="128" height="128" alt="validator crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.validator.md">validator</a></b><br><sub>visor cap and a clipboard; the check mark blinks</sub></td><td align="center" width="25%"><img src="media/costumes/critic.svg" width="128" height="128" alt="critic crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.critic.md">critic</a></b><br><sub>beret and a gold monocle; the monocle glints</sub></td></tr>
</table>

**Domain profiles**

<table>
<tr><td align="center" width="25%"><img src="media/costumes/researcher.svg" width="128" height="128" alt="researcher crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.researcher.md">researcher</a></b><br><sub>mortarboard and an open book; the page flips</sub><br><sub>workflow: <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.research.md">research</a></sub></td><td align="center" width="25%"><img src="media/costumes/debugger.svg" width="128" height="128" alt="debugger crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.debugger.md">debugger</a></b><br><sub>bug net and a ladybird; the net swings, the bug buzzes</sub><br><sub>workflow: <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.debugging.md">debugging</a></sub></td><td align="center" width="25%"><img src="media/costumes/analyst.svg" width="128" height="128" alt="analyst crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.analyst.md">analyst</a></b><br><sub>tie and a bar-chart board; the bars rise</sub><br><sub>workflow: <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.data-analysis.md">data-analysis</a></sub></td><td align="center" width="25%"><img src="media/costumes/architect.svg" width="128" height="128" alt="architect crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.architect.md">architect</a></b><br><sub>blueprint roll and a set square; the set square measures</sub><br><sub>workflow: <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.architecture.md">architecture</a></sub></td></tr>
<tr><td align="center" width="25%"><img src="media/costumes/auditor.svg" width="128" height="128" alt="auditor crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.auditor.md">auditor</a></b><br><sub>shield with a padlock; the padlock glints</sub><br><sub>workflow: <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.security.md">security</a></sub></td><td align="center" width="25%"><img src="media/costumes/navigator.svg" width="128" height="128" alt="navigator crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.navigator.md">navigator</a></b><br><sub>browser window with a cursor; the cursor clicks a link</sub><br><sub>workflow: <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.browser.md">browser</a></sub></td><td align="center" width="25%"><img src="media/costumes/inspector.svg" width="128" height="128" alt="inspector crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.inspector.md">inspector</a></b><br><sub>headphones and a camera; the flash fires, a note rises</sub><br><sub>workflow: <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.vision.md">vision</a>, <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.audio.md">audio</a>, <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/workflows/AGENTS.video.md">video</a></sub></td><td align="center" width="25%"><img src="media/costumes/other.svg" width="128" height="128" alt="other crab"><br><b>any other agent</b><br><sub>the plain crab, labelled with its agent type or savvy-flow tier; walks</sub></td></tr>
</table>

**Claude Code built-in agents**

The built-in subagent types wear a costume too: those that overlap a workflow profile reuse its costume, the rest have their own. The agent type, not the profile name, is shown under the title.

<table>
<tr><td align="center" width="25%"><img src="media/costumes/explorer.svg" width="128" height="128" alt="explorer crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.explorer.md">Explore</a></b><br><sub>pith helmet and a lantern; the lantern swings</sub><br><sub>uses the <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.explorer.md">explorer</a> costume</sub></td><td align="center" width="25%"><img src="media/costumes/architect.svg" width="128" height="128" alt="architect crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.architect.md">Plan</a></b><br><sub>blueprint roll and a set square; the set square measures</sub><br><sub>uses the <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.architect.md">architect</a> costume</sub></td><td align="center" width="25%"><img src="media/costumes/researcher.svg" width="128" height="128" alt="researcher crab"><br><b><a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.researcher.md">web-fetch</a></b><br><sub>mortarboard and an open book; the page flips</sub><br><sub>uses the <a href="https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/profiles/AGENTS.researcher.md">researcher</a> costume</sub></td><td align="center" width="25%"><img src="media/costumes/generalist.svg" width="128" height="128" alt="generalist crab"><br><b><a href="https://code.claude.com/docs/en/sub-agents">general-purpose</a> / <a href="https://code.claude.com/docs/en/sub-agents">claude</a></b><br><sub>beanie and a red Swiss army knife; the blade flicks</sub><br><sub>its own costume</sub></td></tr>
<tr><td align="center" width="25%"><img src="media/costumes/guide.svg" width="128" height="128" alt="guide crab"><br><b><a href="https://code.claude.com/docs/en/sub-agents">claude-code-guide</a></b><br><sub>red info cap and a tour flag; the flag waves</sub><br><sub>its own costume</sub></td><td align="center" width="25%"><img src="media/costumes/statusline.svg" width="128" height="128" alt="statusline crab"><br><b><a href="https://code.claude.com/docs/en/sub-agents">statusline-setup</a></b><br><sub>paint roller and a status bar; the roller rolls</sub><br><sub>its own costume</sub></td></tr>
</table>

**Retired in 0.4.0:** the savvy-flow tier costumes (fable astronaut, heavy detective, careful engineer, medium chef, light racer) and the built-in Explore agent's pirate. The savvy-flow agents now wear the plain crab and keep their tier word, colour and model, and the progress tools are unchanged. Since 0.5.0 the built-in agents have costumes again (see above).

## Install

At the prompt of a terminal session:

```
/plugin install the-crew --marketplace Densetsu152637/The-Crew
```

From a shell:

```
claude plugin install the-crew --marketplace Densetsu152637/The-Crew
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Densetsu152637/The-Crew`, then Add plugin.

the-crew uses its own names throughout (`/crew`, the `crew-agents` pane, `mcp__the-crew__*` tools), so it can be installed beside savvy-progress; you will usually want only one of them enabled, since both draw a panel.

## Using it

- `/crew` shows or hides the panel; `/crew open` opens it, or brings it forward, without toggling.
- With the default `autoOpen: any`, the panel opens by itself once per session when a subagent starts, and whenever a flow reports a plan.

### The main session row

| Shown | Where it comes from |
| --- | --- |
| Model and effort | The main loop's latest model request (`turn.step`); `—` until the first one after the mod loads. |
| Context | The engine's own measure of the live window after each main turn (`session.measure`, `SessionContextUsage`), and the request's input side between measures. |
| Input and output tokens | Each request's prompt side (uncached input plus cache reads and writes) and its output, summed separately; the panel totals show them as two figures. |
| Estimated cost | Each main-loop request's token counts priced with the same table as the subagents (`PRICES` in `hooks/register.tsx`). |
| Time | Since the session began (`$.session.usage().startedAt`). |

The cost is an estimate and counts only requests made while the mod is loaded: requests from before it loaded are not in it. The row is not reset by `/clear` (its cost, tokens and time keep counting from the first start). The engine's own ledger (`/cost`) also includes subagents, so it is not used for this row.

### Profiles and costumes

A subagent's costume is picked in this order, the first match winning:

1. Its agent type is a profile name, e.g. `implementer` or `my-plugin:implementer`.
2. Its brief carries a tag such as `Role: leaf; Profile: implementer` anywhere in it ([the brief tag convention](https://github.com/Densetsu152637/Agent-Custom-Workflow/blob/main/templates/subagent-brief.md#compact-schema)); the first `Profile:` counts.
3. Its agent type is a Claude Code built-in: `Explore` (or `explore`) draws as `explorer`, `Plan` (`plan`) as `architect`, `web-fetch` as `researcher`, `general-purpose` and `claude` as `generalist`, `claude-code-guide` as `guide` and `statusline-setup` as `statusline`. The label under the title stays the agent type (e.g. `Explore`), so a built-in is not mistaken for the profile it borrows.
4. Otherwise the plain crab, labelled with its savvy-flow tier (`savvy-careful` shows `careful`) or else its agent type.

The profiles are those of [Agent-Custom-Workflow](https://github.com/Densetsu152637/Agent-Custom-Workflow): `manager`; the generic `explorer`, `implementer`, `validator`, `critic`, `documenter` and `tester`; and the domain profiles `researcher`, `debugger`, `analyst`, `architect`, `auditor`, `navigator` and `inspector`. The [costume gallery](#costume-gallery) shows each one and links its profile and workflow files.

The profile's name appears under the agent's title, where savvy-flow agents show their tier. `prefers-reduced-motion` stops every animation.

## Tools it adds

- `mcp__the-crew__progress`: an orchestrator reports the plan, phase and accepted tasks for the progress bar. Only the main session can; a call from a subagent is ignored.
- `mcp__the-crew__step`: a subagent reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead. `savvy-*` workers get one line at the end of their brief asking for these reports.

Costs are rough estimates from token counts and list prices (as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate.

## Settings

`autoOpen`: `any` (default) or `savvy`. With `any` the panel also opens, once per session, when any subagent starts; with `savvy` only for savvy-flow workers and reported plans.

`openAtStart`: `on` (default) or `off`. With `on` the panel opens when a session starts (once per session, so closing it stays closed); with `off` it opens only per `autoOpen` or `/crew`.

Set them in `/config`, or in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "the-crew": { "options": { "autoOpen": "any", "openAtStart": "on" } } } }
```

## Changes

See [CHANGELOG.md](CHANGELOG.md). From 1.0.0 the [public surface](docs/public-surface.md) (tool schemas, brief tag, costume mapping, `/crew`, options) follows semantic versioning; [docs/live-check.md](docs/live-check.md) is the manual checklist for the desktop app.

## Development

Changes go to the **`experimental`** branch; `main` is the release branch and takes a release only with the maintainer's explicit confirmation. See [CONTRIBUTING.md](CONTRIBUTING.md).

`claude plugin validate .` checks the manifest and the hooks module; `claude plugin test .` runs the tests in `hooks/*.test.ts(x)`.

`tsc -p .` type-checks the hooks and the tests against `types/vendor/claude-code.d.ts`, a committed copy of the engine's API declarations, so it works from a clean clone with no engine loaded (TypeScript 5.4 or newer). The engine lays the same file at `.claude-plugin/types/claude-code/index.d.ts` only after it has loaded the mod, which is why the repository does not rely on it. On a Claude Code bump, load the mod once with the new CLI, copy `.claude-plugin/types/claude-code/index.d.ts` over `types/vendor/claude-code.d.ts` (its first line names the version), set `CLAUDE_CODE_VERSION` in `.github/workflows/ci.yml` to the same version, and re-run the checks.

The `CI` workflow (`.github/workflows/ci.yml`) installs the pinned CLI with npm and runs `claude plugin validate .`, `claude plugin test .`, `tsc -p .` and the costume check on every push to `main` or `experimental` and every pull request. None of them calls the model API.

The crab drawings live in `hooks/crabs.ts` (pixel grids, `COSTUMES`, `CRAB_CSS`), which `hooks/register.tsx` imports. After changing a costume, regenerate the gallery images with Node 22.18 or later, which runs the TypeScript directly:

```
node tools/render-costumes.mjs          # writes media/costumes/<costume>.svg, one per COSTUMES entry
node tools/render-costumes.mjs --check  # exits 1 when an image is missing, stale or has no costume
```

The test harness cannot read files, so the `Costumes` GitHub Actions workflow (`.github/workflows/costumes.yml`) and the `CI` workflow run the `--check` on every push to `main` or `experimental` and every pull request.

The gallery images are generated, but there is no script for a screenshot of the panel: any panel screenshot is taken by hand in the desktop app (see [docs/live-check.md](docs/live-check.md)).

## Credits and licence

Built on [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) by johnnyvizz: the panel, the progress bar, the cost table and the pixel crabs (themselves after DockCrab's Clawd). MIT licence; see [LICENSE](LICENSE), which carries both copyrights.
