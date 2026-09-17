import { mkdir, readFile, writeFile, rename, readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  assetSchema,
  bookSchema,
  type Asset,
  type Book,
  type Job,
  type PublicSettings,
  type Settings,
} from "@/domain/book";
import { createBook, reconcileBook } from "@/domain/print-spec";
import { AppError } from "./errors";
import { providerUrl } from "./security";

const identifier = z.string().uuid();
const settingsSchema = z.object({
  baseUrl: z.string().max(1000),
  apiKey: z.string().max(2000),
  imageModel: z.string().max(200),
  textModel: z.string().max(200),
  imageSize: z.string().regex(/^\d{3,5}x\d{3,5}$/),
  referenceSupported: z.boolean(),
});
const defaultSettings: Settings = {
  baseUrl: "https://api.coderplan.ai/v1",
  apiKey: "",
  imageModel: "gpt-image-2",
  textModel: "",
  imageSize: "1024x1024",
  referenceSupported: false,
};

export class Store {
  private locks = new Map<string, Promise<void>>();
  constructor(public root: string) {}
  async lock<Result>(key: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.locks.get(key) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, next);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }
  async json<Result>(file: string): Promise<Result> {
    try {
      return JSON.parse(await readFile(path.join(this.root, file), "utf8")) as Result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError("文件不存在。", 404);
      throw new AppError("本地文件读取失败，请保留文件并检查磁盘/备份。", 500);
    }
  }
  async atomic(file: string, value: unknown) {
    const destination = path.join(this.root, file);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const temp = `${destination}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, destination);
  }
  async list(): Promise<Book[]> {
    await mkdir(path.join(this.root, "projects"), { recursive: true, mode: 0o700 });
    const files = (await readdir(path.join(this.root, "projects"))).filter((file) =>
      file.endsWith(".json"),
    );
    const books = await Promise.all(files.map((file) => this.read(file.slice(0, -5))));
    return books.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  }
  async read(id: string) {
    identifier.parse(id);
    return bookSchema.parse(await this.json(`projects/${id}.json`));
  }
  async create(name: string) {
    const book = createBook(z.string().trim().min(1).max(200).parse(name));
    await this.atomic(`projects/${book.id}.json`, book);
    return book;
  }
  async delete(id: string) {
    identifier.parse(id);
    return this.lock(id, async () => {
      await this.read(id);
      let assetFiles: string[] = [];
      try {
        assetFiles = (await readdir(path.join(this.root, "assets"))).filter((file) =>
          file.endsWith(".json"),
        );
      } catch {
        assetFiles = [];
      }
      for (const file of assetFiles) {
        let meta: { projectId: string } | null = null;
        try {
          meta = await this.json<{ projectId: string }>(`assets/${file}`);
        } catch {
          meta = null;
        }
        if (meta?.projectId !== id) continue;
        await rm(path.join(this.root, "assets", file.replace(/\.json$/, ".png")), { force: true });
        await rm(path.join(this.root, "assets", file), { force: true });
      }
      await rm(path.join(this.root, "projects", `${id}.json`), { force: true });
    });
  }
  async canonicalize(book: Book) {
    if (new Set(book.pages.map((page) => page.id)).size !== book.pages.length)
      throw new AppError("页面 ID 重复。");
    for (const target of [...book.pages, book.cover]) {
      target.candidates = await Promise.all(
        target.candidates.map(async (asset) => {
          const stored = await this.asset(asset.id);
          if (stored.projectId !== book.id) throw new AppError("素材不属于此项目。");
          return stored.asset;
        }),
      );
      if (
        target.selectedAssetId &&
        !target.candidates.some((asset) => asset.id === target.selectedAssetId)
      )
        throw new AppError("选中的图片不在该页候选中。");
    }
    if (book.referenceAssetId && (await this.asset(book.referenceAssetId)).projectId !== book.id)
      throw new AppError("参考图不属于此项目。");
    return book;
  }
  async save(input: Book) {
    const next = bookSchema.parse(input);
    return this.lock(next.id, async () => {
      const previous = await this.read(next.id);
      if (previous.version !== next.version)
        throw new AppError(
          "其他操作更新了这本书，请先重新加载最新版本；当前修改尚未覆盖保存。",
          409,
        );
      const result = reconcileBook(previous, await this.canonicalize(next));
      await this.atomic(`projects/${result.id}.json`, result);
      return result;
    });
  }
  async mutate(id: string, operation: (book: Book) => void | Promise<void>) {
    identifier.parse(id);
    return this.lock(id, async () => {
      const book = await this.read(id);
      await operation(book);
      book.version += 1;
      book.updatedAt = new Date().toISOString();
      const result = bookSchema.parse(book);
      await this.atomic(`projects/${id}.json`, result);
      return result;
    });
  }
  async settings(): Promise<Settings> {
    try {
      return settingsSchema.parse(await this.json("settings.json"));
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return { ...defaultSettings };
      throw error;
    }
  }
  async publicSettings(): Promise<PublicSettings> {
    const { apiKey, ...settings } = await this.settings();
    return { ...settings, hasKey: !!apiKey };
  }
  async saveSettings(input: Partial<Settings>) {
    return this.lock("settings", async () => {
      const existing = await this.settings();
      const patch = settingsSchema.partial().parse(input);
      if (!patch.apiKey) delete patch.apiKey;
      const next = settingsSchema.parse({ ...existing, ...patch });
      next.baseUrl = providerUrl(next.baseUrl);
      await this.atomic("settings.json", next);
      return this.publicSettings();
    });
  }
  async addAsset(
    projectId: string,
    bytes: Buffer,
    source: Asset["source"],
    prompt = "",
    model = "",
  ) {
    await this.read(projectId);
    if (bytes.length > 32 * 1024 * 1024) throw new AppError("图片超过 32 MB，请先适当压缩。");
    let result;
    try {
      result = await sharp(bytes, { limitInputPixels: 50_000_000 })
        .rotate()
        .toColourspace("srgb")
        .png()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new AppError("无法读取图片，请使用有效的 PNG、JPEG 或 WebP 图片。");
    }
    const asset: Asset = {
      id: crypto.randomUUID(),
      width: result.info.width,
      height: result.info.height,
      mime: "image/png",
      createdAt: new Date().toISOString(),
      source,
      prompt,
      model,
    };
    await mkdir(path.join(this.root, "assets"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(this.root, "assets", asset.id + ".png"), result.data, {
      mode: 0o600,
    });
    await this.atomic(`assets/${asset.id}.json`, { projectId, asset });
    return asset;
  }
  async asset(id: string) {
    identifier.parse(id);
    const result = await this.json<{ projectId: string; asset: unknown }>(`assets/${id}.json`);
    return { projectId: result.projectId, asset: assetSchema.parse(result.asset) };
  }
  async assetBytes(id: string) {
    await this.asset(id);
    return readFile(path.join(this.root, "assets", id + ".png"));
  }
  async attach(projectId: string, targetId: string, asset: Asset) {
    return this.mutate(projectId, (book) => {
      if (targetId === "reference") {
        book.referenceAssetId = asset.id;
        book.pages.forEach((page) => {
          page.imageConfirmed = false;
        });
        book.cover.imageConfirmed = false;
        return;
      }
      const target =
        targetId === "cover" ? book.cover : book.pages.find((page) => page.id === targetId);
      if (!target) throw new AppError("找不到对应页面；素材仍保存在本机。");
      target.candidates.push(asset);
    });
  }
  async removeCandidate(projectId: string, targetId: string, assetId: string) {
    identifier.parse(assetId);
    const book = await this.mutate(projectId, (draft) => {
      const target =
        targetId === "cover" ? draft.cover : draft.pages.find((page) => page.id === targetId);
      if (!target) throw new AppError("找不到对应页面。");
      if (!target.candidates.some((asset) => asset.id === assetId))
        throw new AppError("该候选不在此目标的候选列表中。");
      target.candidates = target.candidates.filter((asset) => asset.id !== assetId);
      if (target.selectedAssetId === assetId) target.selectedAssetId = null;
    });
    const referenced =
      book.referenceAssetId === assetId ||
      book.cover.candidates.some((asset) => asset.id === assetId) ||
      book.pages.some(
        (page) =>
          page.selectedAssetId === assetId || page.candidates.some((asset) => asset.id === assetId),
      );
    if (!referenced) {
      await rm(path.join(this.root, "assets", `${assetId}.png`), { force: true });
      await rm(path.join(this.root, "assets", `${assetId}.json`), { force: true });
    }
    return book;
  }
  async jobs(): Promise<Job[]> {
    try {
      return await this.json<Job[]>("jobs.json");
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return [];
      throw error;
    }
  }
  async saveJob(job: Job) {
    return this.lock("jobs", async () => {
      const jobs = await this.jobs();
      const index = jobs.findIndex((item) => item.id === job.id);
      if (index >= 0) jobs[index] = job;
      else jobs.unshift(job);
      await this.atomic(`jobs/${job.id}.json`, job);
      await this.atomic("jobs.json", jobs.slice(0, 200));
      return job;
    });
  }
}

const runtime = globalThis as unknown as { kdpStore?: Store };
export const store = (runtime.kdpStore ??= new Store(
  process.env.KDP_DATA_DIR || path.join(process.cwd(), "data"),
));
