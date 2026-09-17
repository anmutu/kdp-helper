import { z } from "zod";
import { endpoint, readJson } from "@/server/http";
import { store } from "@/server/store";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      const { projectId, targetId, assetId } = z
        .object({
          projectId: z.string().uuid(),
          targetId: z.string().min(1).max(80),
          assetId: z.string().uuid(),
        })
        .parse(await readJson(request));
      return Response.json({
        book: await store.attachExisting(projectId, targetId, assetId, true),
      });
    }
    if (Number(request.headers.get("content-length")) > 34 * 1024 * 1024)
      throw new AppError("图片上传超过大小限制。", 413);
    const form = await request.formData();
    const file = form.get("file");
    const projectId = z.string().uuid().parse(form.get("projectId"));
    const targetId = z.string().parse(form.get("targetId"));
    const book = await store.read(projectId);
    if (
      !["cover", "reference"].includes(targetId) &&
      !book.pages.some((page) => page.id === targetId)
    )
      throw new AppError("导入目标不存在。");
    if (!(file instanceof File) || file.size > 32 * 1024 * 1024)
      throw new AppError("请选择不大于 32 MB 的图片。");
    const asset = await store.addAsset(projectId, Buffer.from(await file.arrayBuffer()), "import");
    return Response.json({ asset, book: await store.attach(projectId, targetId, asset) });
  });
}
