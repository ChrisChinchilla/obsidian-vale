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

Tagging a commit (tag name = plain version, e.g. `2.0.6`, no `v` prefix — matches `manifest.json`'s `version`) and pushing the tag triggers `.github/workflows/release.yml`, which installs deps, runs `npm run build`, verifies the tag matches `manifest.json`'s version (fails the build otherwise), creates a GitHub Release, and attaches `main.js`, `manifest.json`, and `styles.css` as individual release assets — required for BRAT and manual installs to work. `.github/workflows/build.yaml` is a separate CI-only sanity build on push/PR to `main`; it does not publish anything.
