import { endpoint, readJson } from "@/server/http";
import { store } from "@/server/store";
import type { Settings } from "@/domain/book";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () => Response.json({ settings: await store.publicSettings() }));
}
export async function PUT(request: Request) {
  return endpoint(request, async () =>
    Response.json({
      settings: await store.saveSettings((await readJson(request)) as Partial<Settings>),
    }),
  );
}
