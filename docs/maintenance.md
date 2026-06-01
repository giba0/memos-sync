# Maintenance and Troubleshooting

Guide for resolving issues with the Memos SP Plugin.

## Debugging Sync Issues

1. Open the plugin in the central Super Productivity view.
2. Review the **Sync Log** entries.
3. Look at the diagnostics line for counts of local notes, remote memos, and computed actions.
4. Check for explicit `error`, `conflict`, or `unlinked` results.

## Common Errors

- **401 Unauthorized**: The API token is invalid or expired.
- **404 Not Found**: The Memos URL is incorrect or a linked memo was deleted.
- **Network error**: The Memos instance is unreachable.
- **Conflict detected**: Both the local plugin note and the remote memo changed since the last successful sync.

## Resetting State

If the plugin state becomes inconsistent:

1. Back up your Memos data first.
2. Remove the plugin from Super Productivity.
3. Clear the plugin cache.
4. Reinstall the plugin.
5. Re-enter the connection settings and run a fresh sync.

This resets the local plugin-owned note store. Remote memos remain unchanged.
