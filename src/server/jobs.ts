import { z } from "zod";
import { type Book, type Job, type Settings } from "@/domain/book";
import { coverGeometry, pageGeometry, effectiveDpi, specKey, pageRange } from "@/domain/print-spec";
import { store } from "./store";
import { AppError } from "./errors";
import { generateImage, ProviderError } from "./provider";

const runtime = globalThis as unknown as {
  kdpJobs?: Map<string, Job>;
  kdpRecovery?: Promise<void>;
};
const active = (runtime.kdpJobs ??= new Map<string, Job>());

export function validateGeneration(
  book: Book,
  settings: Settings,
  targetIds: string[],
  sample: boolean,
) {
  if (!book.specConfirmed) throw new AppError("请先确认官方出版规格，再开始生图。");
  if (!settings.apiKey) throw new AppError("请先配置 API Key。");
  if (!settings.imageModel.trim()) throw new AppError("请填写生图模型。");
  if (book.referenceAssetId && !settings.referenceSupported)
    throw new AppError("当前模型未确认支持参考图，不能静默忽略已选参考图。");
  const [width, height] = settings.imageSize.split("x").map(Number);
  if (!width || !height || width * height > 50_000_000)
    throw new AppError("请求尺寸无效或超过本工具可处理的 5000 万像素上限。");
  for (const targetId of targetIds) {
    const page = book.pages.find((page) => page.id === targetId);
    const target = targetId === "cover" ? book.cover : page;
    if (!target) throw new AppError("生成目标不存在。");
    if (!target.prompt.trim()) throw new AppError("请先填写每个目标页面的画面描述。");
    if (page && page.kind !== "illustration") throw new AppError("纯文字或留白页无需生图。");
    const rect =
      targetId === "cover"
        ? coverGeometry(book.config, book.pages.length).image
        : pageGeometry(
            book.config,
            book.pages.length,
            book.pages.findIndex((page) => page.id === targetId),
            page!.layout,
          ).image;
    if (!sample && effectiveDpi({ width, height }, rect, page?.zoom || 1) < 300)
      throw new AppError(
        "当前请求像素不足以按所选版式印刷。请提升模型输出尺寸、缩小图片区域，或明确选择“仅低清试画”。",
      );
  }
  const range = pageRange(book.config);
  if (!sample && (book.pages.length < range.min || book.pages.length > range.max))
    throw new AppError(
      `当前 ${book.pages.length} 页不在所选印刷组合的 ${range.min}–${range.max} 页范围内。请先确定整本页面清单，或仅低清试画，避免无效生成。`,
    );
}
export async function recoverJobs() {
  if (!runtime.kdpRecovery)
    runtime.kdpRecovery = (async () => {
      for (const job of await store.jobs()) {
        if (
          (job.status === "running" ||
            job.status === "queued" ||
            job.items.some((item) => item.status === "running")) &&
          !active.has(job.id)
        ) {
          if (job.status !== "paused") job.status = "unknown";
          job.message =
            "应用曾重启，在途请求结果未知，未自动重发。请检查服务控制台；已完成图片保留。";
          job.items = job.items.map((item) =>
            item.status === "running" ? { ...item, status: "unknown" } : item,
          );
          await store.saveJob(job);
        }
      }
    })();
  return runtime.kdpRecovery;
}
export async function listJobs(projectId?: string) {
  await recoverJobs();
  return (await store.jobs()).filter((job) => !projectId || job.projectId === projectId);
}
export async function startJob(input: unknown) {
  const { operationId, projectId, targetIds, count, sample } = z
    .object({
      operationId: z.string().uuid(),
      projectId: z.string().uuid(),
      targetIds: z.array(z.string()).min(1).max(64),
      count: z.number().int().min(1).max(4).default(1),
      sample: z.boolean().default(false),
    })
    .parse(input);
  await recoverJobs();
  return store.lock("start-job", async () => {
    const fingerprint = JSON.stringify({ projectId, targetIds, count, sample });
    let previous: { fingerprint: string; jobId: string } | undefined;
    try {
      previous = await store.json(`operations/${operationId}.json`);
    } catch (error) {
      if (!(error instanceof AppError && error.status === 404)) throw error;
    }
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new AppError("同一次提交标识不能用于不同的生成内容。", 409);
      return store.json<Job>(`jobs/${previous.jobId}.json`);
    }
    if ([...active.values()].some((job) => job.projectId === projectId))
      throw new AppError("这本书已有生成任务，请等待完成或暂停。", 409);
    if (active.size >= 2) throw new AppError("已有两个任务运行，请稍后再试。");
    const book = await store.read(projectId),
      settings = await store.settings();
    const unique = [...new Set(targetIds)];
    if (unique.length * count > 128) throw new AppError("单次最多生成 128 张候选，请分批处理。");
    validateGeneration(book, settings, unique, sample);
    const items = unique.flatMap((targetId) =>
      Array.from({ length: count }, () => ({ targetId, status: "queued" as const })),
    );
    const job: Job = {
      id: crypto.randomUUID(),
      operationId,
      projectId,
      targetIds: unique,
      current: 0,
      status: "queued",
      items,
      createdAt: new Date().toISOString(),
      message: sample ? "低清试画：不保证可直接印刷。" : "结果仍会按实际像素重新检查。",
    };
    await store.saveJob(job);
    await store.atomic(`operations/${operationId}.json`, { fingerprint, jobId: job.id });
    active.set(job.id, job);
    void runJob(job, book, settings, sample)
      .catch(async () => {
        job.status = "failed";
        job.message = "任务停止，已完成素材保留；请检查磁盘和服务状态。";
        await store.saveJob(job).catch(() => {});
      })
      .finally(() => {
        active.delete(job.id);
      });
    return job;
  });
}
async function runJob(job: Job, snapshot: Book, settings: Settings, sample: boolean) {
  const reference = snapshot.referenceAssetId
    ? await store.assetBytes(snapshot.referenceAssetId)
    : undefined;
  if (job.status === "paused") {
    await store.saveJob(job);
    return;
  }
  job.status = "running";
  await store.saveJob(job);
  for (const item of job.items) {
    if ((job.status as Job["status"]) === "paused") break;
    const current = await store.read(job.projectId);
    if (
      !current.specConfirmed ||
      specKey(current.config) !== specKey(snapshot.config) ||
      current.style !== snapshot.style ||
      current.referenceAssetId !== snapshot.referenceAssetId
    ) {
      job.status = "paused";
      job.message = "规格或画风已改变，后续任务已停止；请重新确认。";
      break;
    }
    const target =
      item.targetId === "cover"
        ? snapshot.cover
        : snapshot.pages.find((page) => page.id === item.targetId);
    const live =
      item.targetId === "cover"
        ? current.cover
        : current.pages.find((page) => page.id === item.targetId);
    if (!target || !live || target.prompt !== live.prompt) {
      item.status = "failed";
      item.message = "页面已删除或画面描述改变，未发起请求。";
      continue;
    }
    try {
      validateGeneration(current, settings, [item.targetId], sample);
    } catch (error) {
      job.status = "paused";
      job.message = error instanceof Error ? error.message : "页面条件已变化，请重新确认。";
      break;
    }
    item.status = "running";
    await store.saveJob(job);
    if ((job.status as Job["status"]) === "paused") {
      item.status = "queued";
      await store.saveJob(job);
      break;
    }
    const prompt = `${snapshot.style}\n${target.prompt}\nNo typography, letters, captions, watermarks, or logos. Leave space for separately typeset text.`;
    try {
      const bytes = await generateImage(settings, prompt, reference);
      const asset = await store.addAsset(
        job.projectId,
        bytes,
        "generated",
        prompt,
        settings.imageModel,
      );
      const latest = await store.attach(job.projectId, item.targetId, asset);
      item.status = "completed";
      job.current += 1;
      const page = latest.pages.find((page) => page.id === item.targetId);
      const rectangle =
        item.targetId === "cover"
          ? coverGeometry(latest.config, latest.pages.length).image
          : pageGeometry(
              latest.config,
              latest.pages.length,
              latest.pages.findIndex((page) => page.id === item.targetId),
              page!.layout,
            ).image;
      const dpi = effectiveDpi(asset, rectangle, page?.zoom || 1);
      if (!sample && dpi < 299.95) {
        job.status = "paused";
        job.message = `模型实际返回 ${asset.width}×${asset.height}，仅约 ${Math.floor(dpi)} DPI。候选已保存，后续付费请求已暂停；请检查模型尺寸或调整版式。`;
        item.message = job.message;
        await store.saveJob(job);
        break;
      }
    } catch (error) {
      item.status = error instanceof ProviderError && error.uncertain ? "unknown" : "failed";
      item.message =
        error instanceof AppError
          ? error.message
          : "图片保存或处理失败。请检查磁盘，并先从服务控制台取回结果，避免重复计费。";
      job.status = item.status === "unknown" ? "unknown" : "paused";
      job.message = `${item.message} 后续请求已暂停；已完成素材保留，请先处理原因再发起新的任务。`;
      await store.saveJob(job);
      break;
    }
    await store.saveJob(job);
  }
  if (job.status === "running")
    job.status = job.items.every((item) => item.status === "completed") ? "completed" : "failed";
  await store.saveJob(job);
}
export async function pauseJob(id: string) {
  z.string().uuid().parse(id);
  const job = active.get(id);
  if (!job) throw new AppError("任务当前未在运行。");
  job.status = "paused";
  job.message = "已暂停后续请求；正在进行的请求仍可能完成并计费。";
  return store.saveJob(job);
}
