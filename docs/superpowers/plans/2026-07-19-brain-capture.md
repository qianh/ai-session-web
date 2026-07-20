# Brain Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal Chrome MV3 extension that backfills and incrementally archives visible conversations from ChatGPT, Claude, Gemini, and grok.com into the existing BrainHub Google Drive contract.

**Architecture:** A WXT service worker owns scheduling and orchestration. Site adapters expose a common list/detail/map contract; a main-world bridge observes completed page fetches as a fallback. Pure domain modules normalize, redact, render, hash, and reconcile data before a Drive REST adapter performs verified atomic uploads. React is limited to onboarding, popup, and status surfaces.

**Tech Stack:** WXT, TypeScript, React, Chrome MV3 APIs, Google Drive REST API, Zod, Vitest, Testing Library, Playwright, pnpm.

---

## File Map

- `entrypoints/background.ts`: MV3 event registration and dependency wiring only.
- `entrypoints/*-bridge.content.ts`: per-site main-world fetch observation and isolated-world relay.
- `entrypoints/popup/`: compact sync controls and current health.
- `entrypoints/options/`: onboarding, Drive/site/workspace permissions, progress, diagnostics.
- `src/domain/`: shared schema, hashing, redaction, Markdown rendering, filenames.
- `src/adapters/`: one adapter per site plus common transport and mapping contracts.
- `src/drive/`: OAuth token port, Drive REST client, path resolution, resumable assets, atomic session upload.
- `src/sync/`: state schema, storage port, backfill/incremental orchestration, retry, locking, alarm scheduling.
- `src/media/`: attachment download, hashing, WebP conversion request/response contracts.
- `src/platform/`: typed Chrome API facades and runtime messages.
- `tests/fixtures/`: sanitized API payloads captured only from dedicated test conversations.
- `tests/unit/`, `tests/integration/`, `tests/e2e/`: behavior evidence at increasing scope.

### Task 1: Engineering Baseline

**Files:**

- Create: `package.json`, `pnpm-lock.yaml`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`
- Create: `.gitignore`, `.prettierignore`, `eslint.config.js`
- Create: `tests/setup.ts`, `tests/smoke/manifest.test.ts`

- [ ] **Step 1: Add a failing manifest contract test**

Assert MV3, stable key placeholder, `identity/storage/alarms/scripting/offscreen` permissions, exact optional site origins, and `drive.file` OAuth scope.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run tests/smoke/manifest.test.ts`

Expected: failure because WXT configuration does not exist.

- [ ] **Step 3: Add the minimal WXT/TypeScript/React configuration**

Keep site origins in `optional_host_permissions`; do not declare broad wildcard hosts or telemetry.

- [ ] **Step 4: Run tests, typecheck, lint, and build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`

Expected: all commands pass and `.output/chrome-mv3/manifest.json` satisfies the contract.

### Task 2: BrainHub Domain Contract

**Files:**

- Create: `src/domain/session.ts`, `src/domain/hash.ts`, `src/domain/redact.ts`, `src/domain/markdown.ts`
- Create: `tests/unit/domain/session.test.ts`, `hash.test.ts`, `redact.test.ts`, `markdown.test.ts`

- [ ] **Step 1: Write failing tests for web session validation**

Cover four source values, ISO timestamps, visible user/assistant turns, optional title/workspace/url, and attachment metadata.

- [ ] **Step 2: Verify RED, then implement the minimal Zod schemas**

The web schema extends the Markdown contract without changing existing required fields.

- [ ] **Step 3: Write failing compatibility tests for `conversationKey` and filenames**

Expected key algorithm: SHA-256 of `source + NUL + conversation_id`; expected filename: `{source}-{YYYYMMDD}-{sanitized first 8 id chars}.md`.

- [ ] **Step 4: Verify RED, implement hashing and filename generation, verify GREEN**

- [ ] **Step 5: Write failing redaction tests copied from the MCP contract**

Cover private keys, Bearer tokens, password assignments, credentials in URLs, API keys, internal domains, and CIDRs while preserving ordinary prose.

- [ ] **Step 6: Verify RED, port redaction version 1, verify GREEN**

- [ ] **Step 7: Write failing Markdown snapshot tests**

Require compatible frontmatter, visible main-branch order, stable media references, redaction counters, and deterministic `content_sha256`.

- [ ] **Step 8: Verify RED, implement the renderer, verify GREEN**

### Task 3: Drive and Atomic Upload

**Files:**

- Create: `src/drive/types.ts`, `rest-client.ts`, `paths.ts`, `upload-service.ts`, `auth.ts`
- Create: `tests/unit/drive/rest-client.test.ts`, `paths.test.ts`, `upload-service.test.ts`

- [ ] **Step 1: Write failing tests for Drive REST error handling and token refresh**

Cover successful JSON requests, 401 token eviction/retry, 403/429 typed errors, and exponential backoff boundaries.

- [ ] **Step 2: Verify RED, implement fetch-injected REST client, verify GREEN**

- [ ] **Step 3: Write failing tests for idempotent root/path creation**

Require first connect to create `brain-hub`, recursive child creation, and cached IDs validated against Drive.

- [ ] **Step 4: Verify RED, implement path resolver, verify GREEN**

- [ ] **Step 5: Write failing atomic-upload tests**

Require temp candidate upload, byte verification, `brainhubKey` reconciliation, newest `(updatedAt, contentSha256, id)` winner, stable rename, duplicate trashing, and watermark advancement only after verification.

- [ ] **Step 6: Verify RED, implement upload service, verify GREEN**

- [ ] **Step 7: Write failing media tests**

Require SHA-256 paths under `images/sha256/` and `attachments/sha256/`, global dedup, configurable 100 MB limit, resumable upload, and URL fallback warnings.

- [ ] **Step 8: Verify RED, implement media upload path, verify GREEN**

### Task 4: Site Adapter Contract and Fixtures

**Files:**

- Create: `src/adapters/types.ts`, `registry.ts`, `shared.ts`
- Create: `src/adapters/chatgpt.ts`, `claude.ts`, `gemini.ts`, `grok.ts`
- Create: `tests/unit/adapters/*.test.ts`, `tests/fixtures/{chatgpt,claude,gemini,grok}/`

- [ ] **Step 1: Write failing common adapter contract tests**

Each adapter must discover workspaces, paginate all conversations, fetch details, choose the visible active branch, map timestamps/roles/media, and classify auth/schema/rate errors.

- [ ] **Step 2: Verify RED, add the interface and registry, verify GREEN**

- [ ] **Step 3: Inspect one dedicated test conversation per logged-in site**

Capture only sanitized list/detail payload shapes and the minimum headers needed to reproduce same-origin requests. Do not record existing conversation bodies, cookies, or tokens.

- [ ] **Step 4: Add a failing mapping test per sanitized fixture**

- [ ] **Step 5: Implement each adapter one at a time and verify its focused GREEN state**

- [ ] **Step 6: Add malformed/changed-schema fixtures and verify one adapter failure cannot abort another**

### Task 5: Backfill, Incremental Sync, and Fetch Fallback

**Files:**

- Create: `src/sync/state.ts`, `store.ts`, `engine.ts`, `retry.ts`, `lock.ts`, `scheduler.ts`
- Create: `src/platform/messages.ts`, `site-permissions.ts`
- Create: `entrypoints/chatgpt-bridge.content.ts`, `claude-bridge.content.ts`, `gemini-bridge.content.ts`, `grok-bridge.content.ts`
- Create: `tests/unit/sync/*.test.ts`, `tests/integration/fetch-bridge.test.ts`

- [ ] **Step 1: Write failing tests for metadata-only persisted state**

Allow settings, workspace allowlists, watermarks, hashes, progress counters, Drive IDs, and error codes; reject message text, API bodies, media bytes, cookies, and access tokens.

- [ ] **Step 2: Verify RED, implement versioned state/store, verify GREEN**

- [ ] **Step 3: Write failing backfill and incremental engine tests**

Cover pause/resume, pagination, per-conversation checkpoints, no watermark on failure, 30-minute due checks, manual sync, concurrency limits, and cross-site failure isolation.

- [ ] **Step 4: Verify RED, implement engine, verify GREEN**

- [ ] **Step 5: Write failing main-world bridge tests**

Require response cloning without altering site behavior, SSE completion assembly, strict origin/message validation, bounded in-memory buffering, and no persisted body.

- [ ] **Step 6: Verify RED, implement dynamically registered per-site bridges, verify GREEN**

- [ ] **Step 7: Write alarm and restart tests, then wire the background service worker**

Register listeners synchronously at module load and reconstruct all state after MV3 worker restart.

### Task 6: Permissions, Onboarding, Popup, and Status

**Files:**

- Create: `entrypoints/options/App.tsx`, `entrypoints/options/style.css`, supporting components
- Create: `entrypoints/popup/App.tsx`, `entrypoints/popup/style.css`, supporting components
- Create: `tests/components/options.test.tsx`, `popup.test.tsx`

- [ ] **Step 1: Write failing onboarding component tests**

Require explicit Drive connect, profile name, per-site host permission buttons, detected workspace toggles with non-personal spaces off, backfill confirmation, and permission/error states.

- [ ] **Step 2: Verify RED, implement the quiet utilitarian onboarding UI, verify GREEN**

- [ ] **Step 3: Write failing popup/status tests**

Require last/next sync, four independent site states, progress, pause/resume, sync-now, warning details, and no layout shift for dynamic counters.

- [ ] **Step 4: Verify RED, implement popup/status UI, verify GREEN**

- [ ] **Step 5: Add badge state tests and implement aggregate badge rules**

Use no badge when healthy, progress count during backfill, and `!` when any enabled site is degraded.

### Task 7: Packaging and Verification

**Files:**

- Create: `tests/e2e/onboarding.spec.ts`, `popup.spec.ts`, `site-smoke.spec.ts`
- Create: `scripts/derive-extension-id.mjs`, `scripts/package.mjs`
- Create: `README.md`, `docs/google-oauth-setup.md`, `docs/privacy.md`, `docs/site-adapters.md`

- [ ] **Step 1: Write failing build artifact and stable-ID tests**

Require deterministic extension ID, no placeholder OAuth ID in release build, exact permissions, and no remotely hosted code.

- [ ] **Step 2: Generate the stable public key and report the Item ID**

The private signing key remains outside the repository; only the public manifest key is committed.

- [ ] **Step 3: Obtain the Chrome Extension OAuth Client ID from the user and inject it via build configuration**

- [ ] **Step 4: Run unit, component, integration, type, lint, and production-build gates**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`

- [ ] **Step 5: Load the unpacked production extension and visually verify popup/options at desktop and narrow widths**

Check nonblank rendering, readable focus states, no overlap, no clipping, and stable controls.

- [ ] **Step 6: Perform four-site live smoke tests with dedicated conversations**

Prove list/detail capture, visible-branch mapping, media behavior, single-site failure isolation, and manual/incremental re-run idempotency.

- [ ] **Step 7: Perform Drive end-to-end proof**

Prove `brain-hub/inbox/web-<profile>/` creation, Markdown byte verification, app properties, zero duplicates after two syncs, media dedup, and no persisted local body.

- [ ] **Step 8: Produce the ZIP and complete a requirement-by-requirement audit**

Do not claim completion for any site without real authenticated fixture and live smoke evidence.
