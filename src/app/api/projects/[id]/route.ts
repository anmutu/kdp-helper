import { z } from "zod";
import { bookSchema, type Job } from "@/domain/book";
import { endpoint, readJson } from "@/server/http";
import { store } from "@/server/store";
import { listJobs } from "@/server/jobs";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
function jobInFlight(job: Job) {
  return (
    job.status === "queued" ||
    job.status === "running" ||
    (job.status === "paused" && job.items.some((item) => item.status === "running"))
  );
}
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () =>
    Response.json({ book: await store.read((await context.params).id) }),
  );
}
export async function PUT(request: Request, context: Context) {
  return endpoint(request, async () => {
    const { book } = z.object({ book: bookSchema }).parse(await readJson(request));
    if (book.id !== (await context.params).id) throw new AppError("项目 ID 不一致。");
    return Response.json({ book: await store.save(book) });
  });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(request, async () => {
    const id = (await context.params).id;
    if ((await listJobs(id)).some(jobInFlight))
      throw new AppError("这本书还有进行中的生成任务；请先暂停或等待完成，再删除。", 409);
    await store.delete(id);
    return Response.json({ deleted: true });
  });
}
