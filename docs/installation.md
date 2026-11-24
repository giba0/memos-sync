# Installation Guide

Follow these steps to install and configure the Memos SP Plugin in Super Productivity.

## Prerequisites

- Super Productivity installed.
- A running Memos instance.
- A personal access token generated from Memos.

## Steps

1. Open the GitHub repository releases page or the latest successful workflow run.
2. Download the generated `memos-sync.zip` artifact.
3. Open **Settings** > **Plugins** in Super Productivity.
4. Import the downloaded plugin ZIP.
5. Open **Memos Sync** in the central Super Productivity view.
6. Open **Settings** and enter the Memos URL and API token.
7. Click **Test Connection**.
8. Click **Save**.
9. Create a note locally or keep your memos in Memos ready for import.
10. Click **Sync Now**.

The view uses the colors supplied by the Super Productivity theme when the host exposes them. Change the theme in Super Productivity rather than entering separate colors in the plugin.

## For Maintainers

The GitHub Actions workflow builds the plugin and publishes `memos-sync.zip` as an artifact automatically. End users do not need to build the plugin locally.

## Expected Result

- Local plugin notes are pushed to Memos without adding a sync tag.
- All active and archived memos owned by the connected account are imported, regardless of tags.
- Existing links from older versions preserve their technical tag behavior. Unlinked copies are not automatically deduplicated.
- No Super Productivity task is created or modified.
