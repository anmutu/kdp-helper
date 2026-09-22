import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBook } from "../src/domain/print-spec";
import { newPage, type Asset } from "../src/domain/book";
import { renderBook } from "../src/server/pdf";

describe("actual PDF files", () => {
  it("keeps the cover in color while converting black-ink interior illustrations to gray", async () => {
    const book = createBook("黑白内页，彩色封面");
    book.config.ink = "black";
    const image = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const asset: Asset = {
      id: crypto.randomUUID(),
      width: 64,
      height: 64,
      mime: "image/png",
      source: "import",
      createdAt: new Date().toISOString(),
      prompt: "",
      model: "",
    };
    book.pages = [{ ...newPage(), candidates: [asset], selectedAssetId: asset.id }];
    book.cover.candidates = [asset];
    book.cover.selectedAssetId = asset.id;
    const result = await renderBook(book, async () => image, true);
    async function redGreenDifference(bytes: Uint8Array) {
      const document = await PDFDocument.load(bytes);
      const embedded = document.context
        .enumerateIndirectObjects()
        .map(([, object]) => object)
        .find(
          (object): object is PDFRawStream =>
            object instanceof PDFRawStream &&
            object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
        );
      expect(embedded).toBeDefined();
      const rgb = await sharp(Buffer.from(embedded!.getContents()))
        .toColourspace("srgb")
        .png()
        .toBuffer();
      const { channels } = await sharp(rgb).stats();
      return channels[0].mean - channels[1].mean;
    }
    expect(Math.abs(await redGreenDifference(result.interior!))).toBeLessThan(5);
    expect(await redGreenDifference(result.cover!)).toBeGreaterThan(100);
  }, 30000);
  it("exports a valid interior independently of an unfinished cover", async () => {
    const book = createBook("独立内页");
    book.specConfirmed = true;
    book.pages = Array.from({ length: 24 }, () => ({
      ...newPage(),
      kind: "text" as const,
      title: "动物",
      text: "Hello.",
    }));
    const result = await renderBook(book, async () => Buffer.alloc(0), false, "interior");
    expect(result.issues.some((issue) => issue.code.startsWith("cover-"))).toBe(false);
    expect(result.cover).toBeUndefined();
    expect((await PDFDocument.load(result.interior!)).getPageCount()).toBe(24);
  }, 30000);
  it("embeds Chinese text and creates separate single-page interiors and a wraparound cover", async () => {
    const book = createBook("测试绘本");
    book.specConfirmed = true;
    book.config.bleed = true;
    const image = await sharp({
      create: { width: 2800, height: 2800, channels: 3, background: "#c5d1b0" },
    })
      .png()
      .toBuffer();
    const asset: Asset = {
      id: crypto.randomUUID(),
      width: 2800,
      height: 2800,
      mime: "image/png",
      source: "import",
      createdAt: new Date().toISOString(),
      prompt: "",
      model: "",
    };
    book.pages = Array.from({ length: 24 }, () => ({
      ...newPage(),
      title: "A — Animal 动物",
      text: "你好，小朋友。",
      candidates: [asset],
      selectedAssetId: asset.id,
      imageConfirmed: true,
    }));
    book.cover = {
      ...book.cover,
      title: "动物字母书",
      author: "Test Author",
      candidates: [asset],
      selectedAssetId: asset.id,
      imageConfirmed: true,
    };
    const result = await renderBook(book, async () => image, false);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const interior = await PDFDocument.load(result.interior!);
    const cover = await PDFDocument.load(result.cover!);
    expect(interior.getPageCount()).toBe(24);
    expect(interior.getPage(0).getWidth()).toBe(621);
    expect(interior.getPage(0).getHeight()).toBe(630);
    expect(cover.getPageCount()).toBe(1);
    expect(cover.getPage(0).getWidth()).toBeCloseTo((17.25 + 24 * 0.002347) * 72, 4);
    if (spawnSync("pdffonts", ["-v"]).status === 0) {
      const directory = await mkdtemp(path.join(tmpdir(), "kdp-font-check-"));
      try {
        await writeFile(path.join(directory, "book.pdf"), result.interior!);
        const checked = spawnSync("pdffonts", [path.join(directory, "book.pdf")], {
          encoding: "utf8",
        });
        expect(checked.stderr).toBe("");
        expect(checked.stdout).toMatch(/CID Type 0C\s+Identity-H\s+yes/);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 30000);
  it("refuses production files with text overflow and allows a labeled draft", async () => {
    const book = createBook("overflow");
    book.specConfirmed = true;
    book.pages = [{ ...newPage(), kind: "text", text: "长文字".repeat(900) }];
    const final = await renderBook(book, async () => Buffer.alloc(0), false);
    expect(final.interior).toBeUndefined();
    expect(final.issues.some((issue) => issue.code === "text-overflow")).toBe(true);
    expect(final.issues.find((issue) => issue.code === "text-overflow")).toMatchObject({
      pageId: book.pages[0].id,
      message: expect.stringContaining("第 1 页"),
    });
    const draft = await renderBook(book, async () => Buffer.alloc(0), true);
    expect((await PDFDocument.load(draft.interior!)).getPageCount()).toBe(1);
  }, 30000);
  it("identifies cover text overflow separately from interior errors", async () => {
    const book = createBook("Cover overflow");
    book.pages = [{ ...newPage(), kind: "text", text: "Hello" }];
    book.cover.description = "长文字".repeat(400);
    const result = await renderBook(book, async () => Buffer.alloc(0), true);
    expect(result.issues.find((issue) => issue.code === "cover-text-overflow")).toMatchObject({
      message: expect.stringContaining("封面"),
    });
  }, 30000);
});
