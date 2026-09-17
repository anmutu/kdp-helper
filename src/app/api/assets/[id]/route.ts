import { z } from "zod";
import { endpoint, readJson } from "@/server/http";
import { store } from "@/server/store";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(
    request,
    async () =>
      new Response(new Uint8Array(await store.assetBytes((await context.params).id)), {
        headers: { "Content-Type": "image/png", "Content-Security-Policy": "default-src 'none'" },
      }),
  );
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const { projectId, targetId } = z
      .object({ projectId: z.string().uuid(), targetId: z.string().min(1).max(80) })
      .parse(await readJson(request));
    return Response.json({
      book: await store.removeCandidate(projectId, targetId, (await context.params).id),
    });
  });
}
