import { z } from "zod";

export const printConfigSchema = z
  .object({
    trim: z.enum(["8.25x8.25", "8.5x8.5", "8x10", "8.5x11"]),
    ink: z.enum(["black", "premium", "standard"]),
    bleed: z.boolean(),
    paper: z.enum(["white", "cream"]),
  })
  .refine((config) => config.ink === "black" || config.paper === "white", {
    message: "彩色墨水仅支持白纸。",
  });
export type PrintConfig = z.infer<typeof printConfigSchema>;
export const assetSchema = z.object({
  id: z.string().uuid(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mime: z.enum(["image/png", "image/jpeg"]),
  createdAt: z.string(),
  source: z.enum(["import", "generated"]),
  prompt: z.string().default(""),
  model: z.string().default(""),
});
export type Asset = z.infer<typeof assetSchema>;
export const pageSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  text: z.string().max(3000),
  prompt: z.string().max(12000),
  kind: z.enum(["illustration", "text", "blank"]),
  layout: z.enum(["caption", "full"]),
  fontSize: z.number().min(12).max(48),
  candidates: z.array(assetSchema).max(200),
  selectedAssetId: z.string().uuid().nullable(),
  imageConfirmed: z.boolean(),
  zoom: z.number().min(1).max(3),
  offsetX: z.number().min(0).max(1),
  offsetY: z.number().min(0).max(1),
  textColor: z.enum(["ink", "sepia", "navy", "slate", "warmgray"]).default("ink"),
});
export type BookPage = z.infer<typeof pageSchema>;
export const coverSchema = z.object({
  title: z.string().max(200),
  author: z.string().max(120),
  description: z.string().max(1500),
  prompt: z.string().max(12000),
  candidates: z.array(assetSchema).max(200),
  selectedAssetId: z.string().uuid().nullable(),
  imageConfirmed: z.boolean(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Cover = z.infer<typeof coverSchema>;
export const bookSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  name: z.string().min(1).max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  config: printConfigSchema,
  specConfirmed: z.boolean(),
  theme: z.string().max(5000),
  language: z.string().max(80),
  audience: z.string().max(200),
  style: z.string().max(5000),
  referenceAssetId: z.string().uuid().nullable(),
  pages: z.array(pageSchema).max(828),
  cover: coverSchema,
});
export type Book = z.infer<typeof bookSchema>;
export type Issue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  pageId?: string;
};
export type Rect = { x: number; y: number; width: number; height: number };
export type PageGeometry = {
  width: number;
  height: number;
  image: Rect;
  text: Rect;
  trim: Rect;
  safe: Rect;
};
export type Job = {
  id: string;
  operationId?: string;
  projectId: string;
  targetIds: string[];
  current: number;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "unknown";
  items: {
    targetId: string;
    status: "queued" | "running" | "completed" | "failed" | "unknown";
    message?: string;
  }[];
  createdAt: string;
  message: string;
};
export type PublicSettings = {
  baseUrl: string;
  imageModel: string;
  textModel: string;
  imageSize: string;
  hasKey: boolean;
  referenceSupported: boolean;
};
export type Settings = Omit<PublicSettings, "hasKey"> & { apiKey: string };
export type ExportResult = {
  version: string;
  draft: boolean;
  files: { name: string; url: string }[];
  issues: Issue[];
  createdAt: string;
};

export const defaultColorStyle =
  "温暖简洁的水彩插画，柔和自然的颜色，清晰的主体，统一的画风；图片内不绘制文字。";
export const defaultBlackWhiteStyle =
  "温暖简洁的黑白插画，清晰的轮廓与丰富的灰度层次，无彩色，主体突出，统一的画风；图片内不绘制文字。";
export function styleAfterInkChange(ink: PrintConfig["ink"], style: string) {
  if (ink === "black" && style === defaultColorStyle) return defaultBlackWhiteStyle;
  if (ink !== "black" && style === defaultBlackWhiteStyle) return defaultColorStyle;
  return style;
}

export function newPage(id = crypto.randomUUID()): BookPage {
  return {
    id,
    title: "",
    text: "",
    prompt: "",
    kind: "illustration",
    layout: "caption",
    fontSize: 22,
    candidates: [],
    selectedAssetId: null,
    imageConfirmed: false,
    zoom: 1,
    offsetX: 0.5,
    offsetY: 0.5,
    textColor: "ink",
  };
}
