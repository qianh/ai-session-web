# Contributing

BrainHub Capture accepts focused issues and pull requests for Google Chrome and the four supported AI sites.

Before submitting a change:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Do not commit OAuth credentials, cookies, raw conversations, Chrome profiles, generated extension packages, or maintainer release artifacts. Site-adapter changes must retain bounded parsing, per-site optional permissions, redaction, and regression tests.

Official OAuth identity is injected only for Chrome Web Store builds. Fork maintainers must use their own Google Cloud Chrome Extension OAuth Client.
