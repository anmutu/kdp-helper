import { z } from "zod";
import { endpoint, readJson } from "@/server/http";
import { listJobs, pauseJob } from "@/server/jobs";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(request, async () =>
    Response.json({
      jobs: await listJobs(new URL(request.url).searchParams.get("projectId") || undefined),
    }),
  );
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const { id } = z
      .object({ id: z.string().uuid(), action: z.literal("pause") })
      .parse(await readJson(request));
    return Response.json({ job: await pauseJob(id) });
  });
}
