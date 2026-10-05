# Export Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make failed exports self-cleaning and make historical export downloads reject unsafe or oversized filesystem entries without changing the existing book workflow.

**Architecture:** Keep PDF rendering and export version naming unchanged. Wrap the existing temporary-directory write/rename phase in cleanup logic that only removes the hidden temporary path, and route downloads through the existing `readBoundedFile` helper with a dedicated 650 MiB export-file limit.

**Tech Stack:** Next.js 16 App Router, TypeScript, Node `fs/promises`, Vitest, Zod.

---

### Task 1: Clean up failed export temporary directories

**Files:**

- Modify: `src/server/pdf.ts:307-369` to clean the temporary export directory on write or rename failure.
- Test: `tests/export-reliability.test.ts` to exercise the failure path through `exportBook()`.

- [ ] **Step 1: Write the failing test**

Create a temporary `Store` root, create a minimal book, point the shared store at that root, and spy on `node:fs/promises.writeFile` so the first export-file write (`interior.pdf`) throws. Assert that `exportBook(book.id, true, false)` rejects and that the project's `exports` directory contains no hidden `.tmp` directory afterward. Restore the shared root and spy in `finally`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/export-reliability.test.ts`

Expected: FAIL because `exportBook()` currently leaves its temporary directory after the injected write failure.

- [ ] **Step 3: Implement minimal cleanup**

Import `rm` from `node:fs/promises`. After creating `temporary`, wrap the four writes and final `rename` in `try/catch`. In the catch block, run `rm(temporary, { recursive: true, force: true })`, ignore cleanup errors so the original error is preserved, then rethrow. Do not remove anything after a successful `rename`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- tests/export-reliability.test.ts`

Expected: PASS, including the assertion that no temporary directory remains.

### Task 2: Harden historical export downloads

**Files:**

- Modify: `src/domain/project-files.ts` to define the dedicated `650 * 1024 * 1024` export file limit.
- Modify: `src/app/api/exports/[projectId]/[version]/[filename]/route.ts` to call `readBoundedFile` instead of `readFile`.
- Test: `tests/export-reliability.test.ts` for valid files, directories, symlinks, and oversized files.

- [ ] **Step 1: Write failing route tests**

Create a project under a temporary shared store root and write files under `exports/<projectId>/<version>`. Call the route with local `host`/`origin` headers. Assert that a regular `interior.pdf` returns `200` with its bytes, a directory named `interior.pdf` returns a non-200 response, a symlink named `upload-notes.txt` returns a non-200 response, and a file whose `stat.size` is one byte over the export limit returns status `413` without reading it.

- [ ] **Step 2: Run the route tests to verify they fail**

Run: `npm test -- tests/export-reliability.test.ts`

Expected: FAIL because the current route reads directories/symlinks and has no size limit.

- [ ] **Step 3: Implement bounded reads**

Replace the direct `readFile(path.join(...))` call with `readBoundedFile(path.join(...), EXPORT_LIMITS.fileBytes)`. Keep the existing `404` mapping for missing or invalid export files, while allowing the helper's `413` size error to reach `endpoint` unchanged. Continue using the validated `projectId`, `version`, and `filename` values.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- tests/export-reliability.test.ts`

Expected: PASS for both cleanup and download safety cases.

### Task 3: Run project verification

**Files:**

- No additional source files; review the implementation diff and the new regression tests.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all test files and assertions pass.

- [ ] **Step 2: Run static checks and build**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: each command exits with status 0.

- [ ] **Step 3: Check patch hygiene**

Run: `git diff --check`

Expected: no whitespace errors; unrelated parent-directory changes remain untouched.
