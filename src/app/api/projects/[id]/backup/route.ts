import { endpoint } from "@/server/http";
import { backupProject } from "@/server/backup";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(request, async () => {
    const id = (await context.params).id;
    const bytes = await backupProject(id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="book-${id}.kdp.zip"`,
      },
    });
  });
}
