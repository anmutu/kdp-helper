import { z } from "zod";
import { endpoint, readJson } from "@/server/http";
import { exportBook } from "@/server/pdf";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const { projectId, draft, reviewed, target } = z
      .object({
        projectId: z.string().uuid(),
        draft: z.boolean(),
        reviewed: z.boolean().default(false),
        target: z.enum(["all", "interior"]).default("all"),
      })
      .parse(await readJson(request));
    return Response.json({ export: await exportBook(projectId, draft, reviewed, target) });
  });
}
