import { endpoint } from "@/server/http";
import { listExports } from "@/server/exports";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  return endpoint(request, async () =>
    Response.json(await listExports((await context.params).projectId)),
  );
}
