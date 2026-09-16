import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { store } from "../src/server/store";
import { newPage, type Book } from "../src/domain/book";
import { POST as createProject } from "../src/app/api/projects/route";
import { PUT as saveProject, DELETE as deleteProject } from "../src/app/api/projects/[id]/route";
import { POST as uploadAsset } from "../src/app/api/assets/route";
import { POST as exportProject } from "../src/app/api/export/route";
import { POST as outlineProject } from "../src/app/api/outline/route";
import { GET as readSettings } from "../src/app/api/settings/route";

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
  it("creates, imports, selects, saves and exports a real book", async () => {
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
    if (process.env.KDP_TEST_ARTIFACTS) {
      await mkdir(process.env.KDP_TEST_ARTIFACTS, { recursive: true });
      for (const filename of ["interior.pdf", "cover.pdf", "upload-notes.txt"]) {
        await copyFile(
          path.join(root, "exports", book.id, result.version, filename),
          path.join(process.env.KDP_TEST_ARTIFACTS, filename),
        );
      }
    }
  }, 30000);
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
