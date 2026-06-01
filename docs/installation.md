# Installation Guide

Follow these steps to install and configure the Memos SP Plugin in Super Productivity.

## Prerequisites

- Super Productivity installed.
- A running usememos instance.
- A personal access token generated from usememos.

## Steps

1. Build the plugin and create a ZIP whose root contains `manifest.json`, `plugin.js`, `index.html`, and `icon.svg`.
2. Open **Settings** > **Plugins** in Super Productivity.
3. Import the plugin ZIP.
4. Open the plugin in the central Super Productivity view.
5. Enter the Memos URL, API token, and sync tag.
6. Click **Test Connection**.
7. Click **Save**.
8. Click **Add New Note** to create a local plugin note, or keep tagged memos in usememos for import.
9. Click **Sync Now**.

## Expected Result

- Local plugin notes are pushed to usememos with the configured sync tag.
- Remote memos with the configured sync tag are imported into the plugin notes panel.
- No Super Productivity task is created or modified.
