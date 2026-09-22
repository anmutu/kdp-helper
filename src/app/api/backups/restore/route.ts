import { BACKUP_LIMITS } from "@/domain/project-files";
import { restoreProject } from "@/server/backup";
import { endpoint, readBytes } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return endpoint(request, async () =>
    Response.json(
      { book: await restoreProject(await readBytes(request, BACKUP_LIMITS.archiveBytes)) },
      { status: 201 },
    ),
  );
}
