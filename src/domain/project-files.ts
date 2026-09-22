import { z } from "zod";
import type { ExportResult } from "./book";

export const exportVersionSchema = z
  .string()
  .max(100)
  .regex(/^(?:draft|print)-\d+-\d+-[a-f0-9]{8}$/);
export const exportFileSchema = z.enum(["interior.pdf", "cover.pdf", "upload-notes.txt"]);
export const BACKUP_LIMITS = {
  archiveBytes: 256 * 1024 * 1024,
  fileBytes: 128 * 1024 * 1024,
  jsonBytes: 16 * 1024 * 1024,
  entries: 4096,
} as const;

export type ExportHistoryItem = Omit<ExportResult, "issues"> & {
  sourceVersion: number;
  pageCount: number;
  target: "all" | "interior";
  current: boolean;
};
export type ExportHistory = {
  items: ExportHistoryItem[];
  problems: { version: string; message: string }[];
};
