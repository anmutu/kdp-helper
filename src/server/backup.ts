import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { unzipSync, zipSync, type Unzipped } from "fflate";
import { z } from "zod";
import { assetSchema, bookSchema, type Asset, type Book } from "@/domain/book";
import { BACKUP_LIMITS, exportVersionSchema } from "@/domain/project-files";
import { AppError } from "./errors";
import { listExports, readBoundedFile } from "./exports";
import { store, type Store } from "./store";

function safeEntry(name: string) {
  if (name === "project.json" || name === "manifest.json") return true;
  const segments = name.split("/");
  if (segments.length === 2 && segments[0] === "assets" && segments[1].endsWith(".png"))
    return z.string().uuid().safeParse(segments[1].slice(0, -4)).success;
  return (
    segments.length === 3 &&
    segments[0] === "exports" &&
    exportVersionSchema.safeParse(segments[1]).success &&
    ["interior.pdf", "cover.pdf", "upload-notes.txt", "snapshot.json"].includes(segments[2])
  );
}
const manifestSchema = z.object({
  format: z.literal("kdp-helper-backup"),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  assets: z.array(assetSchema).max(BACKUP_LIMITS.entries),
  files: z.record(
    z.string().refine((name) => name !== "manifest.json" && safeEntry(name)),
    z.object({
      size: z.number().int().positive().max(BACKUP_LIMITS.fileBytes),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
function jsonBytes(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > BACKUP_LIMITS.jsonBytes)
    throw new AppError("备份中的 JSON 超过 16 MiB，请手工备份数据目录。", 413);
  return bytes;
}
function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new AppError("备份中的 JSON 文件损坏。");
  }
}
async function validateImage(bytes: Uint8Array, asset: Asset) {
  try {
    const image = sharp(Buffer.from(bytes), { limitInputPixels: 50_000_000 });
    const metadata = await image.metadata();
    if (
      metadata.format !== "png" ||
      metadata.width !== asset.width ||
      metadata.height !== asset.height ||
      (metadata.pages || 1) !== 1
    )
      throw new Error("Metadata mismatch");
    await image.stats();
  } catch {
    throw new AppError("备份中的图片无法解码，或实际尺寸与清单不一致。");
  }
}
function assetIds(book: Book) {
  return new Set([
    ...book.pages.flatMap((page) => page.candidates.map((asset) => asset.id)),
    ...book.cover.candidates.map((asset) => asset.id),
    ...(book.referenceAssetId ? [book.referenceAssetId] : []),
  ]);
}

export async function backupProject(
  projectId: string,
  storage: Store = store,
): Promise<Uint8Array> {
  z.string().uuid().parse(projectId);
  return storage.lock("archives", () =>
    storage.lock(projectId, async () => {
      const book = await storage.canonicalize(await storage.read(projectId));
      const history = await listExports(projectId, storage);
      if (history.problems.length)
        throw new AppError(
          "导出历史有损坏或缺失版本。为避免生成不完整备份，请先检查历史文件，或手工备份整个数据目录。",
        );
      const files: Record<string, Uint8Array> = {};
      let total = 0;
      const add = (name: string, bytes: Uint8Array) => {
        total += bytes.length;
        if (
          total > BACKUP_LIMITS.archiveBytes ||
          Object.keys(files).length >= BACKUP_LIMITS.entries - 1
        )
          throw new AppError("项目超过备份的 256 MiB 或文件数量限制，请手工备份数据目录。", 413);
        if (!bytes.length || bytes.length > BACKUP_LIMITS.fileBytes)
          throw new AppError("备份文件为空或超过 128 MiB，请检查原文件或手工备份。", 413);
        files[name] = bytes;
      };
      add("project.json", jsonBytes(book));
      const assets: Asset[] = [];
      for (const id of assetIds(book)) {
        const stored = await storage.asset(id);
        if (stored.projectId !== projectId)
          throw new AppError("素材归属与项目不一致，未生成备份。");
        assets.push(stored.asset);
        const bytes = await readBoundedFile(
          path.join(storage.root, "assets", `${id}.png`),
          BACKUP_LIMITS.fileBytes,
        );
        await validateImage(bytes, stored.asset);
        add(`assets/${id}.png`, bytes);
      }
      for (const entry of history.items) {
        for (const name of [...entry.files.map((file) => file.name), "snapshot.json"]) {
          const relative = `exports/${entry.version}/${name}`;
          const bytes = await readBoundedFile(
            path.join(storage.root, "exports", projectId, entry.version, name),
            name.endsWith(".json") ? BACKUP_LIMITS.jsonBytes : BACKUP_LIMITS.fileBytes,
          );
          add(
            relative,
            name === "snapshot.json"
              ? jsonBytes(bookSchema.parse(JSON.parse(bytes.toString("utf8"))))
              : bytes,
          );
        }
      }
      add(
        "manifest.json",
        jsonBytes({
          format: "kdp-helper-backup",
          version: 1,
          createdAt: new Date().toISOString(),
          assets,
          files: Object.fromEntries(
            Object.entries(files).map(([name, bytes]) => [
              name,
              {
                size: bytes.length,
                sha256: digest(bytes),
              },
            ]),
          ),
        }),
      );
      const archive = zipSync(files, { level: 0 });
      if (archive.length > BACKUP_LIMITS.archiveBytes)
        throw new AppError("ZIP 超过 256 MiB，请手工备份数据目录。", 413);
      return archive;
    }),
  );
}

function unpack(bytes: Uint8Array) {
  if (bytes.length > BACKUP_LIMITS.archiveBytes) throw new AppError("备份超过 256 MiB。", 413);
  const names = new Set<string>();
  let total = 0;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        if (!safeEntry(entry.name) || names.has(entry.name))
          throw new AppError("备份含重复或不允许的文件路径。");
        names.add(entry.name);
        total += entry.originalSize;
        const limit = entry.name.endsWith(".json")
          ? BACKUP_LIMITS.jsonBytes
          : BACKUP_LIMITS.fileBytes;
        if (entry.compression !== 0 || entry.size !== entry.originalSize)
          throw new AppError("仅支持本工具生成的未重新压缩 ZIP 备份。");
        if (
          !Number.isSafeInteger(entry.size) ||
          entry.size <= 0 ||
          entry.size > limit ||
          total > BACKUP_LIMITS.archiveBytes ||
          names.size > BACKUP_LIMITS.entries
        )
          throw new AppError("备份条目超过安全大小或数量限制。", 413);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("无法读取 ZIP 备份，请选择本工具导出的完整文件。");
  }
  if (!files["manifest.json"] || !files["project.json"])
    throw new AppError("备份缺少项目或校验清单。");
  const manifest = manifestSchema.parse(parseJson(files["manifest.json"]));
  if (Object.keys(manifest.files).length !== Object.keys(files).length - 1)
    throw new AppError("备份文件与清单不一致。");
  for (const [name, record] of Object.entries(manifest.files)) {
    if (!files[name] || files[name].length !== record.size || digest(files[name]) !== record.sha256)
      throw new AppError(`备份文件缺失或校验失败：${name}`);
  }
  const book = bookSchema.parse(parseJson(files["project.json"]));
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const referenced = assetIds(book);
  if (
    assets.size !== manifest.assets.length ||
    assets.size !== referenced.size ||
    Object.keys(files).filter((name) => name.startsWith("assets/")).length !== assets.size
  )
    throw new AppError("备份素材清单与项目引用不一致。");
  if (new Set(book.pages.map((page) => page.id)).size !== book.pages.length)
    throw new AppError("备份中的页面 ID 重复。");
  for (const id of referenced) {
    if (!assets.has(id) || !files[`assets/${id}.png`]) throw new AppError("备份缺少被引用的图片。");
  }
  for (const target of [...book.pages, book.cover]) {
    if (
      target.selectedAssetId &&
      !target.candidates.some((asset) => asset.id === target.selectedAssetId)
    )
      throw new AppError("备份选图不在对应候选中。");
    for (const asset of target.candidates) {
      if (JSON.stringify(asset) !== JSON.stringify(assets.get(asset.id)))
        throw new AppError("备份素材元信息不一致。");
    }
  }
  const versions = new Set(
    Object.keys(files)
      .filter((name) => name.startsWith("exports/"))
      .map((name) => name.split("/")[1]),
  );
  const snapshots = new Map<string, Book>();
  for (const version of versions) {
    for (const name of ["interior.pdf", "upload-notes.txt", "snapshot.json"]) {
      if (!files[`exports/${version}/${name}`]) throw new AppError("备份中的历史导出不完整。");
    }
    const snapshot = bookSchema.parse(parseJson(files[`exports/${version}/snapshot.json`]));
    if (snapshot.id !== book.id || snapshot.version !== Number(version.split("-")[1]))
      throw new AppError("备份中的历史快照归属或版本不一致。");
    snapshots.set(version, snapshot);
  }
  for (const [name, file] of Object.entries(files)) {
    if (name.endsWith(".pdf") && Buffer.from(file.subarray(0, 5)).toString() !== "%PDF-")
      throw new AppError("备份包含无法识别的 PDF 文件。");
  }
  return { files, book, assets, snapshots };
}

export async function restoreProject(bytes: Uint8Array, storage: Store = store): Promise<Book> {
  return storage.lock("archives", async () => {
    const { files, book, assets, snapshots } = unpack(bytes);
    for (const asset of assets.values()) {
      await validateImage(files[`assets/${asset.id}.png`], asset);
    }
    const newId = crypto.randomUUID();
    const ids = new Map([...assets.keys()].map((id) => [id, crypto.randomUUID()]));
    const restored = structuredClone(book);
    restored.id = newId;
    restored.name = `${book.name.slice(0, 190)}（恢复副本）`;
    restored.version = 0;
    restored.createdAt = restored.updatedAt = new Date().toISOString();
    restored.specConfirmed = false;
    restored.generationStyleConfirmed = false;
    restored.referenceAssetId = book.referenceAssetId ? ids.get(book.referenceAssetId)! : null;
    for (const page of restored.pages) page.id = crypto.randomUUID();
    for (const target of [...restored.pages, restored.cover]) {
      target.candidates = target.candidates.map((asset) => ({ ...asset, id: ids.get(asset.id)! }));
      target.selectedAssetId = target.selectedAssetId ? ids.get(target.selectedAssetId)! : null;
      target.imageConfirmed = false;
    }
    bookSchema.parse(restored);
    await mkdir(path.join(storage.root, ".restores"), { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(path.join(storage.root, ".restores", "restore-"));
    const moved: string[] = [];
    let exportsMoved = false;
    try {
      await mkdir(path.join(temporary, "assets"), { mode: 0o700 });
      for (const [oldId, asset] of assets) {
        const id = ids.get(oldId)!;
        await writeFile(path.join(temporary, "assets", `${id}.png`), files[`assets/${oldId}.png`], {
          mode: 0o600,
        });
        await writeFile(
          path.join(temporary, "assets", `${id}.json`),
          jsonBytes({ projectId: newId, asset: { ...asset, id } }),
          { mode: 0o600 },
        );
      }
      for (const [name, file] of Object.entries(files)) {
        if (!name.startsWith("exports/")) continue;
        const destination = path.join(temporary, name);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const content = name.endsWith("/snapshot.json")
          ? jsonBytes({ ...snapshots.get(name.split("/")[1])!, id: newId })
          : file;
        await writeFile(destination, content, { mode: 0o600 });
      }
      await mkdir(path.join(storage.root, "assets"), { recursive: true, mode: 0o700 });
      for (const id of ids.values()) {
        for (const extension of ["png", "json"]) {
          const destination = path.join(storage.root, "assets", `${id}.${extension}`);
          await rename(path.join(temporary, "assets", `${id}.${extension}`), destination);
          moved.push(destination);
        }
      }
      if (snapshots.size) {
        await mkdir(path.join(storage.root, "exports"), { recursive: true, mode: 0o700 });
        await rename(path.join(temporary, "exports"), path.join(storage.root, "exports", newId));
        exportsMoved = true;
      }
      await storage.atomic(`projects/${newId}.json`, restored);
      return restored;
    } catch (error) {
      await Promise.all(moved.map((file) => rm(file, { force: true })));
      if (exportsMoved)
        await rm(path.join(storage.root, "exports", newId), { recursive: true, force: true });
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
