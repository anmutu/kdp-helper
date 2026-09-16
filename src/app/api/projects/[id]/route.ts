import { z } from "zod";
import { bookSchema } from "@/domain/book";
import { endpoint, readJson } from "@/server/http";
import { store } from "@/server/store";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
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
