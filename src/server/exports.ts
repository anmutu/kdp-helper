import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { bookSchema } from "@/domain/book";
import { BACKUP_LIMITS, exportVersionSchema, type ExportHistory } from "@/domain/project-files";
import { AppError } from "./errors";
import { store, type Store } from "./store";

export async function readBoundedFile(file: string, limit: number): Promise<Buffer> {
  const info = await lstat(file);
  if (!info.isFile()) throw new AppError("项目文件类型不合法，不读取链接或目录。");
  if (info.size > limit) throw new AppError("文件超过安全大小限制，请手工备份数据目录。", 413);
  const bytes = await readFile(file);
  if (bytes.length > limit) throw new AppError("文件超过安全大小限制。", 413);
  return bytes;
}

export async function listExports(
  projectId: string,
  storage: Store = store,
): Promise<ExportHistory> {
  z.string().uuid().parse(projectId);
  const book = await storage.read(projectId);
  const directory = path.join(storage.root, "exports", projectId);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { items: [], problems: [] };
    throw new AppError("无法读取导出历史，请检查数据目录权限。", 500);
  }
  const result: ExportHistory = { items: [], problems: [] };
  for (const entry of entries) {
    if (!entry.isDirectory() || !exportVersionSchema.safeParse(entry.name).success) continue;
    try {
      const base = path.join(directory, entry.name);
      const snapshot = bookSchema.parse(
        JSON.parse(
          (
            await readBoundedFile(path.join(base, "snapshot.json"), BACKUP_LIMITS.jsonBytes)
          ).toString("utf8"),
        ),
      );
      const [, revision, timestamp] = entry.name.split("-");
      if (snapshot.id !== projectId || snapshot.version !== Number(revision))
        throw new AppError("导出快照与版本目录不一致。");
      const createdAt = new Date(Number(timestamp)).toISOString();
      const files = ["interior.pdf", "upload-notes.txt"];
      const names = await readdir(base);
      if (names.includes("cover.pdf")) files.splice(1, 0, "cover.pdf");
      for (const name of files) {
        const info = await lstat(path.join(base, name));
        if (!info.isFile() || !info.size) throw new AppError("导出文件不完整。");
      }
      result.items.push({
        version: entry.name,
        draft: entry.name.startsWith("draft-"),
        sourceVersion: snapshot.version,
        pageCount: snapshot.pages.length,
        target: files.includes("cover.pdf") ? "all" : "interior",
        createdAt,
        current: JSON.stringify(snapshot) === JSON.stringify(book),
        files: files.map((name) => ({
          name,
          url: `/api/exports/${projectId}/${entry.name}/${name}`,
        })),
      });
    } catch {
      result.problems.push({
        version: entry.name,
        message: "此版本文件缺失或快照损坏，原文件已保留。",
      });
    }
  }
  result.items.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  return result;
}
