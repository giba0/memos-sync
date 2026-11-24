# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-11-24

### Editor and synchronization

- Add Excalidraw Markup with PNG previews and editable scenes.
- Link memos with native Memos references and open them in a reading dialog.
- Add saved filters, a keyboard shortcut reference, and keyboard navigation.
- Sync in the background after saving, and compress larger plugin states before persistence.
- Store pending attachment payloads separately from synced metadata.


### Added
- Link preview cards using Memos metadata and inline previews for supported image attachments.
- Archive, pin, and visibility synchronization with an archived notes view.
- Settings dialog, mini calendar, and clickable tag filters.
- Safe Markdown rendering and checklist editing, local filters, date grouping, and authenticated attachment previews/downloads.
- Authenticated live-change notifications with interval fallback and resumable chunked attachment uploads where supported.
- Initial project structure and tooling
- Core type definitions for sync mapping and state machine
- Memos API client adapter
- Plugin manifest skeleton for Super Productivity
- Open-source repository scaffolding (README, CONTRIBUTING, LICENSE, docs)

### Changed
- Synchronize all memos owned by the connected account, without requiring a tag. Existing linked notes retain their previous technical-tag behavior.
- Support both current and legacy Memos REST routes.
- Read all pages of active and archived memos and require confirmation before deleting a local note when its remote memo is missing or inaccessible.
- Compare normalized note snapshots to avoid attachment-format conflicts.
- Check linked memos individually when absent from complete listings.
- Follow Super Productivity theme colors and use the upstream Memos logo.

### Fixed
- Synchronize removal of the final attachment and preserve uploaded references when linking fails.
- Keep attachments in the unsaved composer without creating a note prematurely.
