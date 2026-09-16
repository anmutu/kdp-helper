import { endpoint, readJson } from "@/server/http";
import { startJob } from "@/server/jobs";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () =>
    Response.json({ job: await startJob(await readJson(request)) }, { status: 202 }),
  );
}
