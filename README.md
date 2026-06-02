# Memos Sync

Plugin-owned notes in Super Productivity with two-way sync to Memos.

## What it is

Memos Sync adds a dedicated notes experience to Super Productivity and keeps those notes synchronized with [Memos](https://usememos.com/), the open source, self-hostable note-taking app.

This plugin is intentionally **note-centric**.

- It **does not** create or manage Super Productivity tasks.
- It stores its own local notes in plugin persistence.
- It syncs those notes with tagged memos from Memos.

If you want a lightweight Memos-style notes flow inside Super Productivity, this plugin is built for that.

## Preview
![[memos-sync-preview.png]]

## Features

- Two-way sync between plugin-owned local notes and Memos memos
- Card-based timeline UI inspired by Memos
- Tag-based remote memo selection with a configurable sync tag such as `sp-sync`
- Manual conflict resolution when both sides changed since the last successful sync
- Attachment import and upload support
- Optional automatic sync on a user-defined interval
- Keyboard shortcuts for opening the plugin, creating a note, and running sync

## Quick start

1. Download the latest `memos-sync.zip` from GitHub Releases or workflow artifacts.
2. Import it in **Super Productivity → Settings → Plugins**.
3. Open **Memos Sync**.
4. Enter your **Memos URL**, **API token**, and **sync tag**.
5. Click **Test Connection** and then **Save**.
6. Create a note locally or keep tagged memos in Memos ready for import.
7. Click **Sync Now**.

For a more detailed installation flow, see [docs/installation.md](docs/installation.md).

## How it works

### Local notes

You write and manage notes inside the plugin UI in Super Productivity.

- The composer at the top creates a new local note
- Clicking a card edits an existing note
- Attachments can be added from the composer

### Remote notes

On sync, the plugin:

- pushes local notes to Memos
- imports remote memos that contain the configured sync tag
- updates already linked notes on both sides

### Sync rules

- Local note creation creates a remote memo on sync
- Remote memos with the configured sync tag are imported into the local timeline
- Remote deletion removes the linked local note
- Local deletion removes the linked remote memo on the next sync
- If both sides changed, the plugin creates a conflict and asks you to choose which version wins

## Configuration

Open the plugin and configure:

- **Memos URL**: Base URL of your Memos instance
- **API Token**: Personal access token created in Memos
- **Sync Tag**: Tag used to identify synced memos, for example `sp-sync`
- **Enable auto-sync**: Optional automatic synchronization
- **Auto-sync interval**: Interval in minutes when auto-sync is enabled

## Attachments

- Use the paperclip button in the composer to attach files locally
- Attachments are uploaded to Memos on sync when supported by the remote instance
- Imported remote attachments are shown in the local timeline

## Shortcuts

Default plugin shortcuts:

- **Open Memos Sync**
- **Create Memos Sync Note**
- **Run Memos Sync**

Inside the plugin view:

- **Ctrl/Cmd + Enter** saves the current note
- **Shift + Enter** inserts a new line
- **Ctrl/Cmd + Shift + S** triggers sync

Shortcut registration depends on the Super Productivity host runtime. If your installation exposes plugin shortcuts in keyboard settings, you can customize them there.

## What this plugin is not

To avoid confusion:

- It is **not** a task sync plugin
- It does **not** mirror native Super Productivity tasks
- It does **not** replace Super Productivity task management
- It is a dedicated notes workflow that lives alongside your tasks

## Limitations

- Notes live in plugin storage, not as native Super Productivity tasks
- The API token is stored in Super Productivity plugin storage, not in a secure keychain
- Attachment handling depends on the Memos API exposed by your instance and proxy setup
- If your Memos instance returns HTML instead of JSON for `/api/v1/*`, sync will fail until the base URL or reverse proxy is fixed

## Security notes

- Prefer a self-hosted or otherwise trusted Memos instance
- Do not share exported plugin state because it can contain the stored API token
- Do not commit real instance URLs, tokens, or personal note exports into this repository

## Development

- [docs/local-development.md](docs/local-development.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/maintenance.md](docs/maintenance.md)

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

MIT
