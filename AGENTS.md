# AGENTS.md

This file provides repository-specific guidance for coding agents working on **Memos Sync**.

## Project Summary

Memos Sync is a Super Productivity plugin that provides **plugin-owned notes** and synchronizes them with **Memos**.

Important scope boundaries:

- The plugin does **not** create or manage Super Productivity tasks.
- The plugin owns its own local note store in plugin persistence.
- Sync is between **local plugin notes** and **remote Memos memos**.
- The UI should feel close to the philosophy of Memos: light, direct, and low-friction.

## Architecture Overview

Key files and responsibilities:

- `src/plugin.ts`
  - Host-side plugin runtime
  - Persistent state
  - Auto-sync scheduler
  - Shortcut registration
  - Sync orchestration
- `src/ui/index.html`
  - Entire iframe UI
  - Timeline/composer interactions
  - Search, conflicts, attachment interactions
- `src/adapters/memos-client.ts`
  - HTTP adapter for the Memos API
  - Error handling for JSON vs HTML responses
  - Attachment upload/link operations
- `src/engine/sync-engine.ts`
  - Pure sync decision engine
  - No side effects
  - Computes actions from local snapshots + remote snapshots + mappings
- `src/types/index.ts`
  - Local note, attachment, mapping, config, sync log types
- `src/types/memos.ts`
  - Remote Memos API types

## Non-Negotiable Product Rules

When modifying this repo, preserve these behaviors unless the user explicitly asks to change them:

1. **No task creation**
   - Never reintroduce Super Productivity task-based sync.
   - This plugin is note-centric.

2. **Local note creation is explicit**
   - A “new note” command opens a blank composer.
   - It must not pre-create a note/card before save.

3. **Remote deletion behavior**
   - If a linked remote memo is deleted, the linked local note is removed.

4. **Local deletion behavior**
   - If a linked local note is deleted, the linked remote memo is deleted on sync.

5. **Sync tag behavior**
   - Sync uses a configurable tag such as `sp-sync`.
   - The user enters the tag without needing to think about formatting details.

6. **Memos-like UI philosophy**
   - Prefer simple cards, light visual weight, and minimal controls.
   - Avoid admin/dashboard-heavy layouts.

## UI Guidelines

The UI has already gone through several iterations. Keep these principles:

- Prefer **card-based timeline items** over flat rows or heavy side panels.
- Keep the **composer minimal** and focused.
- Avoid visual clutter.
- Prefer a `⋯` overflow menu for secondary actions.
- Hashtags should be visually distinct but subtle.
- Attachments should feel like part of the note, not bolted-on debug UI.
- Do not expose noisy diagnostic UI unless the user asks.

Avoid:

- Reintroducing the old three-column dashboard feel
- Making settings dominate the screen
- Always-visible destructive actions on every card
- Over-explaining keyboard shortcuts inside the main UI

## Sync and Data Rules

When changing sync logic:

- Keep the sync engine in `src/engine/sync-engine.ts` **pure**.
- Side effects belong in `src/plugin.ts`.
- Preserve content-hash-based change detection.
- Preserve mapping-based identity (`localNoteId` ↔ `memoId`).
- Preserve conflict state instead of silently overwriting both sides.

When changing attachment logic:

- Do not call attachment endpoints unless needed.
- Plain text sync must continue to work even if attachment support is unavailable.
- Assume some Memos instances or proxies may partially expose the API.

When changing timestamp handling:

- Preserve remote-created timestamps when importing from Memos.
- Avoid replacing meaningful note times with sync execution time.

## Auto-Sync Rules

- Auto-sync is user-configurable.
- Interval is stored in milliseconds in config.
- The UI presents the interval in minutes.
- Minimum interval should remain sane and safe.
- Prevent concurrent overlapping sync runs.

## Keyboard Shortcut Rules

There are two shortcut layers:

1. **Super Productivity host shortcuts** in `src/plugin.ts`
2. **In-view keyboard behavior** in `src/ui/index.html`

If you change shortcuts:

- Keep host registration compatible with Super Productivity runtime behavior.
- Keep new-note behavior opening a blank composer with focus.
- Preserve `Ctrl/Cmd + Enter` for save unless explicitly changed.
- Preserve `Shift + Enter` for newline.

## Documentation Rules

This is a public repository. Keep documentation aligned with the real product behavior.

Before changing docs, verify the implementation first.

Keep these files in sync with reality:

- `README.md`
- `docs/installation.md`
- `docs/architecture.md`
- `docs/maintenance.md`
- `package.json`
- `manifest.json`

Do not document features that do not actually exist.

## Public Repository Safety

Never commit:

- Real API tokens
- Real user note exports
- Private instance URLs you should not expose
- Personal attachments or confidential files
- Plugin state dumps containing credentials

Be careful with examples:

- Use placeholder URLs like `https://memos.example.com`
- Use fake note content when adding examples/tests/docs

## Build, Test, and Release Commands

Use these commands:

- `npm run typecheck`
- `npm test`
- `npm run build`

The build output goes to `dist/`.

The GitHub Actions workflow is responsible for:

- typechecking
- testing
- building
- packaging `memos-sync.zip`

End users should install from the generated ZIP artifact or release asset.

## Versioning Policy

Use practical semantic versioning:

- **Patch** (`0.1.x`)
  - bug fixes
  - small visual tweaks
  - docs-only corrections
  - non-breaking behavior fixes

- **Minor** (`0.x.0`)
  - new user-facing features
  - new sync capabilities
  - attachment support improvements
  - auto-sync feature changes

- **Major** (`x.0.0`)
  - breaking sync model changes
  - storage format changes without backward compatibility
  - large UX or API changes that require user migration

For this repository specifically, because it is still early-stage, most changes will likely be:

- `0.1.x` for fixes and polish
- `0.2.0`, `0.3.0`, etc. for meaningful new features

When in doubt:

- behavior fix → patch
- capability expansion → minor
- incompatible migration → major

## Git and Commit Guidance

- Keep commits atomic.
- Prefer multiple focused commits over one giant commit.
- Separate:
  - tooling/build
  - sync engine/domain model
  - plugin host/runtime
  - UI
  - docs/release workflow

## What Agents Should Check Before Finishing

Before reporting work complete:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. Confirm docs still describe current behavior
5. Confirm no secrets or local artifacts were introduced

If the environment prevents one of these commands from running, say so explicitly and explain whether the failure was environmental or code-related.
