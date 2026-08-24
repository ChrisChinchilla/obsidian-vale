---
name: release
description: Cut a new release (or pre-release) of the Vale Linter Obsidian plugin for BRAT/manual install. Use when the user asks to release, publish, cut a version, or ship a new build of this plugin.
---

# Releasing Vale Linter

This plugin is distributed via manual install and [BRAT](https://github.com/TfTHacker/obsidian42-brat),
not the official Obsidian Community Plugin list. A release is just a tagged
commit: pushing a plain-version tag (e.g. `2.1.0`) triggers
`.github/workflows/release.yml`, which builds, verifies the tag matches
`manifest.json`, and publishes a GitHub Release carrying `main.js`,
`manifest.json`, and `styles.css` as individual downloadable assets - BRAT
and manual installs both fetch these directly from the release, not the repo
source.

## Before releasing

1. Make sure the target branch is what you actually want released. Check
   `git log <last-tag>..HEAD --oneline` to see what's shipping - if there's
   unmerged feature-branch work the user wants, confirm whether to merge
   first or release from the branch directly (a real release should
   normally come from `main`; only cut from a feature branch for a
   deliberate pre-release/beta test).
2. Run `npm install && npm run build` locally first. This is a type-check +
   production build - catch failures here, not in CI after the tag is
   already pushed and public.
3. Decide the version bump (semver): a batch of new backward-compatible
   features is a **minor** bump, a fix-only batch is a **patch**, breaking
   changes are **major**. Look at what actually shipped, not just the
   commit count.

## Cutting a stable release

```
npm version <patch|minor|major>
git push origin <branch>
git push origin <version>   # e.g. git push origin 2.1.0
```

`npm version` bumps `package.json`, runs `version-bump.mjs` (syncs
`manifest.json`'s version and adds a `versions.json` entry mapping it to the
current `minAppVersion`), and commits + tags in one step.

**Gotcha already fixed in this repo**: `npm version` defaults to a
`v`-prefixed tag (`v2.1.0`), but this repo's actual tag convention has no
prefix (`2.0.6`, `2.1.0`) - past releases were evidently tagged manually
rather than via `npm version`. A checked-in `.npmrc` with
`tag-version-prefix=` fixes this so `npm version` produces the right tag
directly. If that file is ever missing, either restore it or manually
re-tag (`git tag <version> <commit> && git push origin <version>`, then
delete the errant `v`-prefixed tag both locally and on the remote) rather
than pushing a mismatched tag.

## After pushing the tag

Watch the release workflow rather than assuming it succeeded - a tag/manifest
mismatch or a build failure fails loudly, but only if you look:

```
gh run list --repo ChrisChinchilla/obsidian-vale --limit 3
gh run watch <run-id> --repo ChrisChinchilla/obsidian-vale --exit-status
gh release view <version> --repo ChrisChinchilla/obsidian-vale \
  --json tagName,isPrerelease,isDraft,assets
```

Confirm all three assets (`main.js`, `manifest.json`, `styles.css`) are
present with non-zero size before telling the user it's done.

## Doing a pre-release instead

Not yet wired up in `release.yml` - add this before relying on it. The goal:
a semver prerelease suffix in the tag/version (e.g. `2.1.0-beta.1`) should
automatically mark the GitHub Release as a prerelease, while a plain
version tag stays a normal stable release. This was verified against BRAT's
own source (`obsidian42-brat`): it explicitly passes `includePrerelease:
true` when installing/updating a beta-tracked plugin, so a GitHub
prerelease is exactly the right mechanism - BRAT users still get it, while
anyone browsing the repo's "Latest release" on GitHub does not.

To add it, insert a step before the `ncipollo/release-action@v1` step in
`.github/workflows/release.yml` and pass its output through:

```yaml
    - name: Detect prerelease
      id: prerelease
      run: |
        if [[ "${GITHUB_REF#refs/tags/}" == *-* ]]; then
          echo "value=true" >> "$GITHUB_OUTPUT"
        else
          echo "value=false" >> "$GITHUB_OUTPUT"
        fi
    - uses: ncipollo/release-action@v1
      with:
        generateReleaseNotes: true
        artifacts: "main.js,manifest.json,styles.css"
        artifactErrorsFailBuild: true
        prerelease: ${{ steps.prerelease.outputs.value }}
```

Then cut it the same way as a stable release, just with a suffixed version:

```
npm version 2.1.0-beta.1
git push origin <branch>
git push origin 2.1.0-beta.1
```

Note `npm version <exact-string>` accepts a prerelease-suffixed string
directly; `version-bump.mjs` doesn't care about the suffix, it just copies
whatever `npm_package_version` is into `manifest.json`/`versions.json`.

## Release notes

`release.yml` already sets `generateReleaseNotes: true`, which produces a
commit-based changelog automatically - no manual release notes are needed
by default. Only write a curated summary in the release body if the user
explicitly asks for one (e.g. a release big enough to warrant highlighting
specific features up front).
