# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian plugin (`vale-linter`, display name "Vale Linter") that shells out to the [Vale](https://vale.sh/) prose linter and renders its results as inline decorations in the Obsidian editor. Not published on the official Obsidian Community Plugin list — distributed via manual install or [BRAT](https://github.com/TfTHacker/obsidian42-brat), so GitHub Releases must carry `manifest.json`, `main.js`, and `styles.css` as individual downloadable assets (BRAT fetches these directly from the release, not from the repo source).

## Commands

- `npm install`
- `npm run dev` — esbuild in watch mode, bundles `main.ts` → `main.js`. No type-checking.
- `npm run build` — `tsc -noEmit -skipLibCheck` (type-check only) then esbuild production bundle. This is what CI and the release workflow run; it must pass with zero tsc errors.
- `npm version <patch|minor|major|x.y.z>` — bumps `package.json`, then runs `version-bump.mjs` (the `version` lifecycle script) which syncs `manifest.json`'s `version` and adds/updates the matching entry in `versions.json` (mapping plugin version → `minAppVersion`), and stages both files.
- No test suite exists in this repo.
- Linting is configured (`eslint.config.mjs`, flat config, built on `eslint-plugin-obsidianmd`) but currently non-functional: `eslint-plugin-obsidianmd` (a `github:` dependency) isn't actually present in `node_modules`, so `npx eslint .` fails with `ERR_MODULE_NOT_FOUND`. There's also a legacy `.eslintrc.json` (references `react`/`eslint:recommended`) that is not used by any script and predates the flat config — don't treat it as authoritative.

## Architecture

- **`main.ts`** — the plugin entry point (`ValePlugin extends Plugin`) and `ValeSettingTab`. Owns settings (`ValePluginSettings`, persisted via `loadData`/`saveData`), the status bar item, command registration, and orchestrates a check: on `editor-change` (debounced) or `active-leaf-change`, it writes the active file's *in-editor* content to a temp file (not the on-disk file — this matters, since it reflects unsaved edits), runs Vale via `execFile` (argument array, not shell string interpolation — keep it that way) with `--output=JSON`, parses the JSON into `ValeIssue[]`, and dispatches those to the CodeMirror decoration layer. Vale's exit code 1 (meaning "issues found") is treated as a non-error path by inspecting `error.stdout`.
- **`src/valeDecorations.ts`** — the CodeMirror 6 integration: a `StateField`/`StateEffect` pair (`valeDecorationsField` / `setValeDecorationsEffect`) that turns `ValeIssue[]` into a `DecorationSet`, plus a `hoverTooltip` extension that renders severity/message/suggestion-action UI on hover. Suggestion/replace/remove actions are applied by dispatching editor transactions directly against calculated `{from, to}` ranges (Vale's 1-indexed line/column spans converted to CodeMirror's 0-indexed doc positions). Imports the `ValeIssue` type back from `../main` — `main.ts` and this file are mutually dependent by design (type only, no runtime cycle).
- **`src/utils.ts`** — path helpers: resolving a possibly-relative path against the vault's base path, and probing common OS install locations for the `vale` binary when the user hasn't set an explicit path.
- **`src/logger.ts`** — a small leveled logger (`DEBUG`/`WARN`/`ERROR`, default `WARN`) used instead of raw `console.*` in `main.ts`.
- **Build**: esbuild bundles only `main.ts` (which pulls in `src/*`) to a single `main.js`, marking `obsidian`, `electron`, and the `@codemirror/*`/`@lezer/*` packages as `external` (Obsidian provides these at runtime). `tsc` is type-check-only (`noEmit`) — it never emits JS. `tsconfig.json` requires `moduleResolution: "bundler"`; without it, resolution of `obsidian`/`@codemirror/*` breaks and cascades into unrelated-looking type errors across `main.ts`.
- Note: `src/utils.js` and `src/valeDecorations.js` are stray committed build artifacts sitting next to their `.ts` sources — they are not part of the actual build path (esbuild only bundles from `main.ts`'s import graph) and can be ignored/removed.

## Release process

Tagging a commit (tag name = plain version, e.g. `2.0.6`, no `v` prefix — matches `manifest.json`'s `version`) and pushing the tag triggers `.github/workflows/release.yml`, which installs deps, runs `npm run build`, verifies the tag matches `manifest.json`'s version (fails the build otherwise), creates a GitHub Release, and attaches `main.js`, `manifest.json`, and `styles.css` as individual release assets — required for BRAT and manual installs to work. `.github/workflows/build.yaml` is a separate CI-only sanity build on push/PR to `main`; it does not publish anything. `.npmrc` sets `tag-version-prefix=` so `npm version <bump>` produces a correctly un-prefixed tag directly (its default `v`-prefixed behavior doesn't match this repo's tag convention). See the `release` skill (`.claude/skills/release/`) for the full step-by-step process, including how to cut a pre-release.

## Feature roadmap

Compared against two more mature Vale integrations to find gaps worth closing:
[`marcusolsson/obsidian-vale`](https://github.com/marcusolsson/obsidian-vale) (archived, the plugin this repo was forked from) and
[`ChrisChinchilla/vale-vscode`](https://github.com/ChrisChinchilla/vale-vscode) (a fork of the deprecated `errata-ai/vale-vscode`, the most feature-complete Vale editor integration available). Items below are grouped by rough size; check them off as they land. Note: `ensureAbsolutePath()` in `src/utils.ts` (see Architecture above) is dead code today — fixing it is bundled into the roadmap since several items below depend on config paths actually resolving correctly.

**High value, low effort:**
- [x] `minAlertLevel`-style setting: minimum severity to surface at all (distinct from just recoloring low-severity issues).
- [x] `maxNumberOfProblems` cap, to avoid flooding the editor/status bar on huge documents.
- [x] "Sync styles" command — just shells out to `vale sync` via `execFile`, no UI required.
- [x] "Show effective configuration" command — surface Vale's resolved config for debugging (mirrors `vale.showConfig` in vale-vscode).
- [x] Wire up `ensureAbsolutePath()` in `src/utils.ts` so a relative `configPath` setting actually resolves against the vault base path, instead of being used as-is.

**Medium:**
- [x] Vocab management — "Add to accept list" / "Add to reject list" commands/hover actions that write to Vale's vocab files (mirrors vale-vscode). Implemented via `vale ls-config` (parsed for `StylesPath`/`Vocab`) plus hover buttons on spelling issues; requires `Vocab = <name>` set in `.vale.ini`.
- [x] Alert filter setting — suppress specific checks by name/glob, independent of severity. Implemented as a comma-separated `ignoredChecks` setting with `*` wildcard support.
- [x] A dedicated issues panel/view (an Obsidian `ItemView`) listing all issues in the current file, not just inline decorations (mirrors `ValeView.tsx` in the original plugin). Reuses the legacy `.obsidian-vale .alert` CSS classes already present in `styles.css`. Vault-wide (not just current file) issue listing is not implemented — scoped to the active file only.

**Larger/architectural:**
- [x] In-app style package browser/installer (mirrors `StyleSettings.tsx` in the original plugin) — replaces the current "run `vale sync` yourself" workflow. A `ValeStyleBrowserModal` (command "Browse styles" and a settings-tab button) lists packages from `errata-ai/packages`' `library.json` registry; installing/removing a style edits the `Packages` (top-level) and `BasedOnStyles` (under `[*.md]`) keys via small targeted line-based helpers in `src/valeConfigEdit.ts` (not a full ini rewrite - see the note on the `.vale.ini` generation/management item below), then shells out to `vale sync` to actually download it, mirroring the original's "one toggle = install + enable" UX but via Vale's own supported `Packages` mechanism instead of the original's direct zip-download approach. Verified end-to-end against a real `vale` binary that `Packages = <name>` + `vale sync` downloads and extracts to `<StylesPath>/<name>`, matching what "Remove" deletes.
- [x] Per-rule settings UI — enable/disable individual checks and override their severity from within Obsidian (mirrors `RuleSettings.tsx`). A gear icon next to each installed style in the style browser opens `ValeRuleSettingsModal`, which lists that style's rules (read from its `.yml` files in `StylesPath/<style>/`) with a per-rule dropdown (Default/Suggestion/Warning/Error/Disabled) backed by `${style}.${rule} = NO|suggestion|warning|error` keys under `[*.md]`, using the same targeted `src/valeConfigEdit.ts` line editing as the style browser (extended with single-value get/set/remove helpers). Verified end-to-end against a real `vale` binary that disabling a rule this way actually removes it from lint output. Rule management for the built-in `Vale` style itself isn't included (mirrors the original plugin's same limitation) since its rules aren't exposed as files on disk.
- [ ] `.vale.ini` generation/management — plugin writes and maintains `StylesPath`/`BasedOnStyles` instead of requiring manual edits (mirrors `ValeConfigManager.ts`).
- [x] Managed Vale binary install/update ("Install or update Vale" command, mirrors `vale.install` in vale-vscode) instead of requiring a pre-existing install. On startup, if no runnable `vale` is found (setting, common paths, or PATH), the plugin downloads the right release asset from `errata-ai/vale`'s GitHub releases into `<vault>/.obsidian/plugins/vale-linter/vale-bin/` and switches `valePath` to it, unless `manageValeInstall` is turned off. If an existing install is found instead, a one-time Notice mentions the managed-install option rather than switching automatically. Extraction shells out to the system `tar` (bsdtar on Windows 10+ handles `.zip` too), so no new npm dependency was added. The settings tab also has an "Uninstall" button (shown once a managed copy exists) that deletes the managed directory and resets `valePath` back to `'vale'` if it was pointing at the managed binary.
- [ ] Optional Docker execution mode (mirrors `vale.docker.*` in vale-vscode).
- [ ] Optional remote Vale-server execution mode, as an alternative to local CLI exec (mirrors the original plugin's `server.url` mode).

**Not planned:** multi-root-workspace-style per-folder Vale instances (vale-vscode) have no real Obsidian equivalent, since a vault is single-root — skipping rather than forcing a fit.
