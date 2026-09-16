import { endpoint } from "@/server/http";
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
