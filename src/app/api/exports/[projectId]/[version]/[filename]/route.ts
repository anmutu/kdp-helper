import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { endpoint } from "@/server/http";
import { store } from "@/server/store";
import { AppError } from "@/server/errors";
import { exportFileSchema, exportVersionSchema } from "@/domain/project-files";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; version: string; filename: string }> },
) {
  return endpoint(request, async () => {
    const { projectId, version, filename } = z
      .object({
        projectId: z.string().uuid(),
        version: exportVersionSchema,
        filename: exportFileSchema,
      })
      .parse(await context.params);
    await store.read(projectId);
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(store.root, "exports", projectId, version, filename));
    } catch {
      throw new AppError("导出文件不存在。", 404);
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": filename.endsWith(".pdf") ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  });
}
