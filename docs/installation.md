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
6. Enter the Memos URL, API token, and sync tag.
7. Click **Test Connection**.
8. Click **Save**.
9. Create a note locally or keep tagged memos in Memos ready for import.
10. Click **Sync Now**.

## For Maintainers

The GitHub Actions workflow builds the plugin and publishes `memos-sync.zip` as an artifact automatically. End users do not need to build the plugin locally.

## Expected Result

- Local plugin notes are pushed to Memos with the configured sync tag.
- Remote memos with the configured sync tag are imported into the plugin notes panel.
- No Super Productivity task is created or modified.
