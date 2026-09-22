import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { store } from "../src/server/store";
import { newPage, type Book } from "../src/domain/book";
import { POST as createProject, GET as listProjects } from "../src/app/api/projects/route";
import { PUT as saveProject, DELETE as deleteProject } from "../src/app/api/projects/[id]/route";
import { POST as uploadAsset } from "../src/app/api/assets/route";
import { POST as exportProject } from "../src/app/api/export/route";
import { POST as outlineProject } from "../src/app/api/outline/route";
import { GET as readSettings } from "../src/app/api/settings/route";
import { GET as backupProject } from "../src/app/api/projects/[id]/backup/route";
import { POST as restoreProject } from "../src/app/api/backups/restore/route";
import { GET as readHistory } from "../src/app/api/exports/[projectId]/route";

let root: string;
const original = store.root;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kdp-api-flow-"));
  store.root = root;
});
afterAll(async () => {
  store.root = original;
  await rm(root, { recursive: true, force: true });
});
function request(route: string, body: unknown, method = "POST") {
  return new Request(`http://127.0.0.1:3210${route}`, {
    method,
    headers: {
      host: "127.0.0.1:3210",
      origin: "http://127.0.0.1:3210",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("offline route-to-file workflow, without network or paid generation", () => {
  it("persists the selected print configuration during project creation", async () => {
    const response = await createProject(
      request("/api/projects", {
        name: "原子规格绘本",
        config: { trim: "8x10", ink: "black", bleed: true, paper: "cream" },
      }),
    );
    expect(response.status).toBe(201);
    const book = (await response.json()).book as Book;
    expect(book.config).toEqual({ trim: "8x10", ink: "black", bleed: true, paper: "cream" });
    expect(book.specConfirmed).toBe(false);
  });

  it("returns healthy projects with actionable warnings for damaged files", async () => {
    const healthy = await store.create("Healthy project");
    const damaged = await store.create("Damaged project");
    const file = path.join(root, "projects", damaged.id + ".json");
    await writeFile(file, "broken");
    try {
      const response = await listProjects(new Request("http://127.0.0.1:3210/api/projects"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.projects.some((book: Book) => book.id === healthy.id)).toBe(true);
      expect(body.problems).toEqual([
        { file: `projects/${damaged.id}.json`, message: expect.stringContaining("原文件") },
      ]);
      expect(await readFile(file, "utf8")).toBe("broken");
    } finally {
      await rm(file);
    }
  });
  it("returns structured export errors with the exact page to fix", async () => {
    let book = await store.create("Overflow on page seven");
    book.specConfirmed = true;
    book.pages = Array.from({ length: 24 }, () => ({
      ...newPage(),
      kind: "text" as const,
      text: "Hello",
    }));
    book.pages[6].text = "长文字".repeat(900);
    book = await store.save(book);
    const response = await exportProject(
      request("/api/export", {
        projectId: book.id,
        draft: false,
        reviewed: true,
        target: "interior",
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toContain("第 7 页");
    expect(body.issues).toContainEqual(
      expect.objectContaining({
        code: "text-overflow",
        severity: "error",
        pageId: book.pages[6].id,
        message: expect.stringContaining("第 7 页"),
      }),
    );
  }, 30000);
  it("creates, imports, selects, exports and restores a backup of a real book", async () => {
    const created = await createProject(request("/api/projects", { name: "离线验收书" }));
    expect(created.status).toBe(201);
    let book: Book = (await created.json()).book;
    const image = await sharp({
      create: { width: 3000, height: 3200, channels: 3, background: "#b5c7aa" },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(image)], { type: "image/png" }), "test.png");
    form.set("projectId", book.id);
    form.set("targetId", "cover");
    const uploaded = await uploadAsset(
      new Request("http://127.0.0.1:3210/api/assets", {
        method: "POST",
        headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" },
        body: form,
      }),
    );
    expect(uploaded.status).toBe(200);
    const imported = await uploaded.json();
    book = imported.book;
    book.specConfirmed = true;
    book.pages = Array.from({ length: 24 }, () => ({
      ...newPage(),
      title: "动物",
      text: "A friendly animal.",
      candidates: [imported.asset],
      selectedAssetId: imported.asset.id,
      imageConfirmed: true,
    }));
    book.cover = {
      ...book.cover,
      title: "我的动物书",
      author: "作者",
      selectedAssetId: imported.asset.id,
      imageConfirmed: true,
    };
    const saved = await saveProject(request(`/api/projects/${book.id}`, { book }, "PUT"), {
      params: Promise.resolve({ id: book.id }),
    });
    expect(saved.status).toBe(200);
    const exported = await exportProject(
      request("/api/export", { projectId: book.id, draft: false, reviewed: true }),
    );
    expect(exported.status).toBe(200);
    const result = (await exported.json()).export;
    const bytes = await readFile(
      path.join(root, "exports", book.id, result.version, "interior.pdf"),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(24);
    const notes = await readFile(
      path.join(root, "exports", book.id, result.version, "upload-notes.txt"),
      "utf8",
    );
    expect(notes).toContain("CMYK");
    expect(notes).toContain("24 页");
    const originalSnapshot = await store.read(book.id);
    const backup = await backupProject(
      new Request(`http://127.0.0.1:3210/api/projects/${book.id}/backup`),
      { params: Promise.resolve({ id: book.id }) },
    );
    expect(backup.status).toBe(200);
    const restoredResponse = await restoreProject(
      new Request("http://127.0.0.1:3210/api/backups/restore", {
        method: "POST",
        body: await backup.arrayBuffer(),
      }),
    );
    expect(restoredResponse.status).toBe(201);
    const restored: Book = (await restoredResponse.json()).book;
    expect(restored.pages).toHaveLength(24);
    expect(restored.specConfirmed).toBe(false);
    expect(await store.read(book.id)).toEqual(originalSnapshot);
    const restoredBytes = await readFile(
      path.join(root, "exports", restored.id, result.version, "interior.pdf"),
    );
    expect(restoredBytes).toEqual(bytes);
    expect((await PDFDocument.load(restoredBytes)).getPageCount()).toBe(24);
    const history = await readHistory(
      new Request(`http://127.0.0.1:3210/api/exports/${restored.id}`),
      { params: Promise.resolve({ projectId: restored.id }) },
    );
    expect((await history.json()).items[0]).toMatchObject({
      target: "all",
      current: false,
      draft: false,
    });
    if (process.env.KDP_TEST_ARTIFACTS) {
      await mkdir(process.env.KDP_TEST_ARTIFACTS, { recursive: true });
      for (const filename of ["interior.pdf", "cover.pdf", "upload-notes.txt"]) {
        await copyFile(
          path.join(root, "exports", book.id, result.version, filename),
          path.join(process.env.KDP_TEST_ARTIFACTS, filename),
        );
      }
    }
  }, 60000);
  it("denies a foreign origin before exposing even redacted settings", async () => {
    const response = await readSettings(
      new Request("http://127.0.0.1:3210/api/settings", {
        headers: { host: "127.0.0.1:3210", origin: "https://foreign.example" },
      }),
    );
    expect(response.status).toBe(403);
  });
  it("rejects an odd outline target page count before any model call", async () => {
    const response = await outlineProject(
      request("/api/outline", { projectId: crypto.randomUUID(), targetPages: 25 }),
    );
    expect(response.status).toBe(400);
  });
  it("requires an existing project and blocks deleting a missing one", async () => {
    const missing = crypto.randomUUID();
    const response = await deleteProject(
      new Request(`http://127.0.0.1:3210/api/projects/${missing}`, {
        method: "DELETE",
        headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" },
      }),
      { params: Promise.resolve({ id: missing }) },
    );
    expect(response.status).toBe(404);
  });
});
