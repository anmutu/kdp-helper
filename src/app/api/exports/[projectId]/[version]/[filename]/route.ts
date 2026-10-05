import path from "node:path";
import { z } from "zod";
import { endpoint } from "@/server/http";
import { store } from "@/server/store";
import { AppError } from "@/server/errors";
import { exportFileSchema, exportVersionSchema, EXPORT_LIMITS } from "@/domain/project-files";
import { readBoundedFile } from "@/server/exports";
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
      bytes = await readBoundedFile(
        path.join(store.root, "exports", projectId, version, filename),
        EXPORT_LIMITS.fileBytes,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new AppError("导出文件不存在。", 404);
      throw error;
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": filename.endsWith(".pdf") ? "application/pdf" : "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  });
}
