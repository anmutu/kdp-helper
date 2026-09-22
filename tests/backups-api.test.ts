import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { store } from "../src/server/store";
import { readBytes } from "../src/server/http";
import { BACKUP_LIMITS } from "../src/domain/project-files";
import { GET as downloadBackup } from "../src/app/api/projects/[id]/backup/route";
import { POST as restoreBackup } from "../src/app/api/backups/restore/route";
import { GET as exportHistory } from "../src/app/api/exports/[projectId]/route";

const original = store.root;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kdp-backup-routes-"));
  store.root = root;
});
afterAll(async () => {
  store.root = original;
  await rm(root, { recursive: true, force: true });
});

describe("offline backup and history routes", () => {
  it("downloads and restores a project without touching its original", async () => {
    const originalBook = await store.mutate((await store.create("Route backup")).id, (book) => {
      book.generationStyleConfirmed = true;
    });
    const download = await downloadBackup(
      new Request(`http://127.0.0.1:3210/api/projects/${originalBook.id}/backup`),
      { params: Promise.resolve({ id: originalBook.id }) },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    const response = await restoreBackup(
      new Request("http://127.0.0.1:3210/api/backups/restore", {
        method: "POST",
        body: await download.arrayBuffer(),
        headers: { "Content-Type": "application/zip" },
      }),
    );
    expect(response.status).toBe(201);
    const restored = (await response.json()).book;
    expect(restored.id).not.toBe(originalBook.id);
    expect(restored.generationStyleConfirmed).toBe(false);
    expect(await store.read(originalBook.id)).toEqual(originalBook);
    const history = await exportHistory(
      new Request(`http://127.0.0.1:3210/api/exports/${restored.id}`),
      {
        params: Promise.resolve({ projectId: restored.id }),
      },
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({ items: [], problems: [] });
  });

  it("rejects foreign-origin restores and oversized uploads before processing the archive", async () => {
    const foreign = await restoreBackup(
      new Request("http://127.0.0.1:3210/api/backups/restore", {
        method: "POST",
        body: "not a zip",
        headers: { origin: "https://foreign.example" },
      }),
    );
    expect(foreign.status).toBe(403);
    const oversized = await restoreBackup(
      new Request("http://127.0.0.1:3210/api/backups/restore", {
        method: "POST",
        body: "not a zip",
        headers: { "content-length": String(BACKUP_LIMITS.archiveBytes + 1) },
      }),
    );
    expect(oversized.status).toBe(413);
  });

  it("bounds chunked uploads even without a content-length header", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://127.0.0.1:3210/api/backups/restore", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: string });
    await expect(readBytes(request, 3)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
});
