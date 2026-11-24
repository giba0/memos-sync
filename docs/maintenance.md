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
- **410 Gone for `/api/v1`**: Memos 26.10 removed the old API routes. Update the plugin to a version that supports `/api`, and ensure the reverse proxy routes `/api/*` to Memos.
- **Network error**: The Memos instance is unreachable.
- **Conflict detected**: Both the local plugin note and the remote memo changed since the last successful sync.
- **Remote memo not found or inaccessible**: Verify the memo in Memos and check access before confirming deletion of its local note. If access returns, run sync again.
- **A memo is not imported**: Confirm it is owned by the connected account, and check **Archived** and **Sync Log**. A sync tag is no longer required.
- **Current user cannot be identified**: Ensure the server exposes the current-user endpoint and the token has access. Sync is stopped rather than risk changing another user's memos.
- **Attachment cannot be opened**: Check authentication, host network permissions, and the proxy. The plugin refuses attachment redirects and HTML login pages; use the **Memos** link to find the memo in the service.
- **Link preview unavailable**: The Memos server or proxy may not expose the link-metadata endpoint, or the target page may be unreachable. The original link still works; use **Retry** after a temporary failure.
- **Upload outcome uncertain**: Check Memos for the attachment before removing and reattaching it. Legacy uploads are not repeated automatically after an uncertain result. A finalized but expired chunked session also requires checking Memos when its attachment cannot be retrieved.
- **Live updates unavailable**: Check the `/api/sse` route and host streaming support. Automatic interval sync continues even when live events are unavailable.

## Resetting State

If the plugin state becomes inconsistent:

1. Back up your Memos data first.
2. Remove the plugin from Super Productivity.
3. Clear the plugin cache.
4. Reinstall the plugin.
5. Re-enter the connection settings and run a fresh sync.

This resets the local plugin-owned note store. Remote memos remain unchanged.
