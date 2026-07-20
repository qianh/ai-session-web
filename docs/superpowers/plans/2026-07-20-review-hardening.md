# Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all eight review findings so browser media capture, incremental synchronization, redaction, and Drive uploads remain correct under real Chrome and large-account conditions.

**Architecture:** Keep the existing adapter, pipeline, transport, and Drive boundaries. Extend only the contracts needed to represent JSON-safe offscreen bytes, ordered filter-group pagination, pinned media tabs, and authenticated raw Drive responses; preserve current storage schema except when a scope change explicitly invalidates its watermark.

**Tech Stack:** WXT, TypeScript, Chrome MV3 APIs, Google Drive REST API, Vitest, pnpm.

---

### Task 1: JSON-safe offscreen image conversion

**Files:**

- Create: `src/media/offscreen-message.ts`
- Modify: `src/media/offscreen-converter.ts`
- Modify: `entrypoints/offscreen/main.ts`
- Test: `tests/unit/media/offscreen-converter.test.ts`

- [ ] Add a test that JSON-round-trips the request and response and expects WebP bytes to survive.
- [ ] Run `pnpm vitest run tests/unit/media/offscreen-converter.test.ts` and verify it fails because `ArrayBuffer` is lost.
- [ ] Encode byte chunks as Base64 strings on both sides of `runtime.sendMessage`.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Redact all rendered session metadata

**Files:**

- Modify: `src/sync/pipeline.ts`
- Test: `tests/unit/sync/pipeline.test.ts`

- [ ] Add tests containing secrets in the title, source URL, media name, fallback media URL, and turn text.
- [ ] Run the pipeline test and verify secrets still appear in prepared Markdown/session data.
- [ ] Archive with the original media URL, then redact all renderable strings and count every replacement.
- [ ] Re-run the focused test and verify the archived fetch still receives the original URL while output is sanitized.

### Task 3: Invalidate watermarks when capture scope changes

**Files:**

- Modify: `src/runtime/app.ts`
- Test: `tests/unit/runtime/app.test.ts`

- [ ] Add tests for enabling non-personal workspaces and changing Claude organization ID.
- [ ] Verify both tests fail because the old watermark remains active.
- [ ] Set `fullBackfillPending`, remove `watermark`, and retain unrelated site settings only when scope expands or switches.
- [ ] Re-run the focused tests.

### Task 4: Make watermark scans inclusive and filter-group aware

**Files:**

- Modify: `src/adapters/shared.ts`
- Modify: `src/adapters/clients.ts`
- Modify: `src/sync/engine.ts`
- Test: `tests/unit/adapters/clients.test.ts`
- Test: `tests/unit/sync/engine.test.ts`

- [ ] Add tests that a lower-ID conversation at the watermark timestamp is processed, duplicate IDs are skipped, and paging jumps to the next filter group after older data.
- [ ] Verify the engine currently misses the boundary item and traverses an old group.
- [ ] Add `nextGroupCursor`, stop only the current ordered group on timestamps older than the watermark, and keep an in-run ID set.
- [ ] Re-run adapter and engine tests.

### Task 5: Preserve Drive API error classification

**Files:**

- Modify: `src/drive/upload-service.ts`
- Test: `tests/unit/drive/upload-service.test.ts`

- [ ] Add tests for 403 and retryable 429-style `DriveApiError` failures after candidate creation.
- [ ] Verify they are incorrectly returned as `UPLOAD_VERIFICATION_FAILED`.
- [ ] Reserve that result for byte mismatches, perform best-effort cleanup, and rethrow operational errors unchanged.
- [ ] Re-run upload service and sync-engine error classification tests.

### Task 6: Pin media chunks to one browser tab

**Files:**

- Modify: `src/bridge/page-transport.ts`
- Test: `tests/unit/bridge/page-transport.test.ts`

- [ ] Add a two-tab test that changes the active tab after `media-start` and records every script target.
- [ ] Verify chunks currently move to the newly active tab.
- [ ] Select once per media transfer and use the same tab ID for start, chunks, release, and retries.
- [ ] Re-run the transport tests.

### Task 7: Use resumable Drive uploads for large objects

**Files:**

- Modify: `src/drive/rest-client.ts`
- Modify: `src/drive/google-drive.ts`
- Test: `tests/unit/drive/rest-client.test.ts`
- Test: `tests/unit/drive/google-drive.test.ts`

- [ ] Add a large-byte test that expects a resumable session and multiple `Content-Range` chunks without multipart concatenation.
- [ ] Verify the current gateway sends one multipart body.
- [ ] Expose authenticated response access in `DriveHttp`; initiate resumable uploads above 5 MiB and send 8 MiB chunks while accepting HTTP 308.
- [ ] Keep multipart uploads for small objects and re-run Drive tests.

### Task 8: Full verification and packaging

**Files:**

- Verify: `.output/chrome-mv3/**`
- Create: `.output/*.zip`

- [ ] Run focused regression tests and then `pnpm verify`.
- [ ] Run `pnpm zip` (or `pnpm zip:release` when a valid local OAuth client ID is configured).
- [ ] Run the artifact audit and report the exact package path, size, and checksum.
