import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { exportBook } from "../src/server/pdf";
import { GET as downloadExport } from "../src/app/api/exports/[projectId]/[version]/[filename]/route";
import { EXPORT_LIMITS } from "../src/domain/project-files";
import { store } from "../src/server/store";

const mockState = vi.hoisted(() => ({
  originalWriteFile: undefined as typeof import("node:fs/promises").writeFile | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  mockState.originalWriteFile = actual.writeFile;
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const originalRoot = store.root;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "kdp-export-reliability-"));
  store.root = root;
});

afterAll(async () => {
  store.root = originalRoot;
  await rm(root, { recursive: true, force: true });
});

function request(url: string) {
  return new Request(`http://127.0.0.1:3210${url}`, {
    headers: {
      host: "127.0.0.1:3210",
      origin: "http://127.0.0.1:3210",
    },
  });
}

describe("export reliability boundaries", () => {
  it("removes the temporary export directory when writing an export fails", async () => {
    const book = await store.create("失败清理测试");
    const writeFileMock = vi.mocked(fs.writeFile);
    writeFileMock.mockImplementation(async (file, data, options) => {
      if (String(file).endsWith("/interior.pdf")) throw new Error("disk full");
      return mockState.originalWriteFile!(file, data, options);
    });

    try {
      await expect(exportBook(book.id, true, false)).rejects.toThrow("disk full");
      await expect(readdir(path.join(root, "exports", book.id))).resolves.toEqual([]);
    } finally {
      writeFileMock.mockImplementation(mockState.originalWriteFile!);
    }
  });

  it("downloads a regular historical export file", async () => {
    const book = await store.create("下载测试");
    const version = "print-0-1700000000000-abcdef01";
    const directory = path.join(root, "exports", book.id, version);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "interior.pdf"), "pdf bytes");

    const response = await downloadExport(
      request(`/api/exports/${book.id}/${version}/interior.pdf`),
      { params: Promise.resolve({ projectId: book.id, version, filename: "interior.pdf" }) },
    );

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("pdf bytes");
  });

  it("rejects directories and symbolic links masquerading as export files", async () => {
    const book = await store.create("文件类型测试");
    const version = "print-0-1700000001000-abcdef02";
    const directory = path.join(root, "exports", book.id, version);
    await mkdir(directory, { recursive: true });

    await mkdir(path.join(directory, "interior.pdf"));
    const directoryResponse = await downloadExport(
      request(`/api/exports/${book.id}/${version}/interior.pdf`),
      { params: Promise.resolve({ projectId: book.id, version, filename: "interior.pdf" }) },
    );
    expect(directoryResponse.status).toBe(400);

    await rm(path.join(directory, "interior.pdf"), { recursive: true, force: true });
    const target = path.join(directory, "real-notes.txt");
    await writeFile(target, "secret");
    await symlink(target, path.join(directory, "upload-notes.txt"));
    const symlinkResponse = await downloadExport(
      request(`/api/exports/${book.id}/${version}/upload-notes.txt`),
      { params: Promise.resolve({ projectId: book.id, version, filename: "upload-notes.txt" }) },
    );
    expect(symlinkResponse.status).toBe(400);
  });

  it("rejects an export file larger than the KDP file limit", async () => {
    const book = await store.create("文件大小测试");
    const version = "print-0-1700000002000-abcdef03";
    const directory = path.join(root, "exports", book.id, version);
    const file = path.join(directory, "interior.pdf");
    await mkdir(directory, { recursive: true });
    await writeFile(file, Buffer.alloc(0));
    await truncate(file, EXPORT_LIMITS.fileBytes + 1);

    const response = await downloadExport(
      request(`/api/exports/${book.id}/${version}/interior.pdf`),
      { params: Promise.resolve({ projectId: book.id, version, filename: "interior.pdf" }) },
    );

    expect(response.status).toBe(413);
  });
});
