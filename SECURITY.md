# Security Policy

## Supported Versions

This project is currently maintained on the latest commit in the default branch.

## Reporting a Vulnerability

Please do not open a public issue for security-sensitive reports.

Instead:

1. Open a private security advisory on GitHub if available for the repository.
2. If private reporting is not available, contact the maintainer before publishing details.

When reporting a vulnerability, include:

- A clear description of the issue
- Affected version or commit
- Reproduction steps
- Possible impact
- Any suggested mitigation

## Sensitive Data Guidance

This plugin stores the Memos API token in Super Productivity plugin storage. Treat exported plugin state as sensitive data.

Do not publish:

- Real API tokens
- Real personal note exports
- Private instance URLs if they should remain private
- Attachments that contain confidential information
