import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { unzipSync, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { newPage } from "../src/domain/book";
import { Store } from "../src/server/store";
import { backupProject, restoreProject } from "../src/server/backup";
import { listExports } from "../src/server/exports";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "kdp-backup-"));
  roots.push(root);
  return new Store(root);
}
async function example() {
  const source = await setup();
  let book = await source.create("可恢复绘本");
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const asset = await source.addAsset(book.id, image, "generated", "a red animal", "test-model");
  book.specConfirmed = true;
  book.pages = [
    {
      ...newPage(),
      title: "A",
      text: "Animal",
      zoom: 1.2,
      candidates: [asset],
      selectedAssetId: asset.id,
      imageConfirmed: true,
    },
  ];
  book.cover = {
    ...book.cover,
    candidates: [asset],
    selectedAssetId: asset.id,
    imageConfirmed: true,
  };
  book.referenceAssetId = asset.id;
  book = await source.save(book);
  return { source, book, asset };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable project backups", () => {
  it("round trips content, shared images and exports into a new unconfirmed copy without secrets", async () => {
    const { source, book, asset } = await example();
    await source.saveSettings({ apiKey: "source-private-secret" });
    const version = `print-${book.version}-1700000000000-abcdef01`;
    const directory = path.join(source.root, "exports", book.id, version);
    await mkdir(directory, { recursive: true });
    await source.atomic(`exports/${book.id}/${version}/snapshot.json`, book);
    await writeFile(path.join(directory, "interior.pdf"), "%PDF-1.7\ninterior");
    await writeFile(path.join(directory, "cover.pdf"), "%PDF-1.7\ncover");
    await writeFile(path.join(directory, "upload-notes.txt"), "Historical notes");
    const backup = await backupProject(book.id, source);
    const files = unzipSync(backup);
    expect(Object.keys(files).filter((name) => name.startsWith("assets/"))).toHaveLength(1);
    expect(Buffer.from(backup).includes(Buffer.from("source-private-secret"))).toBe(false);
    expect(Object.keys(files).some((name) => /settings|jobs|operations/.test(name))).toBe(false);
    const target = await setup();
    await target.saveSettings({ apiKey: "target-private-secret" });
    const restored = await restoreProject(backup, target);
    expect(restored.id).not.toBe(book.id);
    expect(restored.name).toContain("恢复副本");
    expect(restored.specConfirmed).toBe(false);
    expect(restored.pages[0]).toMatchObject({ text: "Animal", zoom: 1.2, imageConfirmed: false });
    expect(restored.pages[0].id).not.toBe(book.pages[0].id);
    expect(restored.pages[0].selectedAssetId).not.toBe(asset.id);
    expect(restored.cover.selectedAssetId).toBe(restored.pages[0].selectedAssetId);
    expect(restored.referenceAssetId).toBe(restored.cover.selectedAssetId);
    expect(await target.assetBytes(restored.referenceAssetId!)).toEqual(
      await source.assetBytes(asset.id),
    );
    expect((await target.settings()).apiKey).toBe("target-private-secret");
    expect(await source.read(book.id)).toEqual(book);
    const history = await listExports(restored.id, target);
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ current: false, draft: false, target: "all" });
    expect(
      await readFile(path.join(target.root, "exports", restored.id, version, "cover.pdf"), "utf8"),
    ).toBe("%PDF-1.7\ncover");
    expect(await target.jobs()).toEqual([]);
  });

  it.each(["../escape.txt", "settings.json", "/absolute.png", "assets/../escape.png"])(
    "rejects the unexpected archive entry %s before writing a project",
    async (name) => {
      const { source, book } = await example();
      const files = unzipSync(await backupProject(book.id, source));
      files[name] = new TextEncoder().encode("untrusted");
      const target = await setup();
      await expect(restoreProject(zipSync(files, { level: 0 }), target)).rejects.toThrow();
      expect((await target.list()).projects).toEqual([]);
    },
  );

  it.each(["checksum", "missing", "compressed", "dimensions", "format"])(
    "rejects %s corruption without publishing a partial project",
    async (kind) => {
      const { source, book, asset } = await example();
      const files = unzipSync(await backupProject(book.id, source));
      if (kind === "checksum") files[`assets/${asset.id}.png`][20] ^= 1;
      if (kind === "missing") delete files[`assets/${asset.id}.png`];
      if (kind === "dimensions" || kind === "format") {
        const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
        if (kind === "dimensions") manifest.assets[0].width += 1;
        else manifest.version = 999;
        files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
      }
      const target = await setup();
      await expect(
        restoreProject(zipSync(files, { level: kind === "compressed" ? 6 : 0 }), target),
      ).rejects.toThrow();
      expect((await target.list()).projects).toEqual([]);
      expect(await readdir(target.root)).toEqual(["projects"]);
    },
  );

  it("cleans up new files when publishing the restored project fails", async () => {
    const { source, book } = await example();
    const backup = await backupProject(book.id, source);
    const target = await setup();
    vi.spyOn(target, "atomic").mockRejectedValue(new Error("disk full"));
    await expect(restoreProject(backup, target)).rejects.toThrow();
    expect((await target.list()).projects).toEqual([]);
    expect(await readdir(path.join(target.root, "assets"))).toEqual([]);
  });
  it("rejects an undecodable image even when its checksum was recomputed", async () => {
    const { source, book, asset } = await example();
    const files = unzipSync(await backupProject(book.id, source));
    const name = `assets/${asset.id}.png`;
    files[name] = new TextEncoder().encode("not a real PNG");
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    manifest.files[name] = {
      size: files[name].length,
      sha256: createHash("sha256").update(files[name]).digest("hex"),
    };
    files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
    const target = await setup();
    await expect(restoreProject(zipSync(files, { level: 0 }), target)).rejects.toThrow("无法解码");
    expect(await readdir(target.root)).toEqual([]);
  });
  it("does not produce a misleadingly complete backup when an original image is damaged", async () => {
    const { source, book, asset } = await example();
    await writeFile(path.join(source.root, "assets", `${asset.id}.png`), "damaged");
    await expect(backupProject(book.id, source)).rejects.toThrow("无法解码");
    expect(await source.read(book.id)).toEqual(book);
  });
  it("rejects malformed JSON and oversized ZIP entries before writing files", async () => {
    const { source, book } = await example();
    const backup = await backupProject(book.id, source);
    const target = await setup();
    const files = unzipSync(backup);
    files["manifest.json"] = new TextEncoder().encode("{broken");
    await expect(restoreProject(zipSync(files, { level: 0 }), target)).rejects.toMatchObject({
      status: 400,
    });
    const oversized = Buffer.from(backup);
    const centralDirectory = oversized.readUInt32LE(oversized.length - 6);
    oversized.writeUInt32LE(200 * 1024 * 1024, centralDirectory + 20);
    oversized.writeUInt32LE(200 * 1024 * 1024, centralDirectory + 24);
    await expect(restoreProject(oversized, target)).rejects.toMatchObject({ status: 413 });
    expect(await readdir(target.root)).toEqual([]);
  });
  it("allows a restored copy to be backed up and restored again without stale asset references", async () => {
    const { source, book } = await example();
    const target = await setup();
    const first = await restoreProject(await backupProject(book.id, source), target);
    const second = await restoreProject(await backupProject(first.id, target), target);
    expect(second.id).not.toBe(first.id);
    expect(second.referenceAssetId).not.toBe(first.referenceAssetId);
    expect(await target.assetBytes(second.referenceAssetId!)).toEqual(
      await target.assetBytes(first.referenceAssetId!),
    );
    expect(await target.read(first.id)).toEqual(first);
  });
});
