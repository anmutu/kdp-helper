import { z } from "zod";
import { printConfigSchema } from "@/domain/book";
import { endpoint, readJson } from "@/server/http";
import { store } from "@/server/store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () => Response.json(await store.list()));
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const { name, config } = z
      .object({ name: z.string().trim().min(1).max(200), config: printConfigSchema.optional() })
      .parse(await readJson(request));
    return Response.json({ book: await store.create(name, config) }, { status: 201 });
  });
}
