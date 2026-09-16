import { z } from "zod";
import { endpoint, readJson } from "@/server/http";
import { store } from "@/server/store";
import { generateOutline } from "@/server/provider";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const { projectId, targetPages } = z
      .object({
        projectId: z.string().uuid(),
        targetPages: z
          .number()
          .int()
          .min(4)
          .max(60)
          .refine((pages) => pages % 2 === 0, { message: "目标页数必须为偶数。" }),
      })
      .parse(await readJson(request));
    const book = await store.read(projectId);
    if (!book.specConfirmed) throw new AppError("请先确认出版规格，再调用文字模型。");
    return Response.json({
      pages: await generateOutline(await store.settings(), book, targetPages),
    });
  });
}
