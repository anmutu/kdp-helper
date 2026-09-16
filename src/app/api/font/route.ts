import { readFile } from "node:fs/promises";
import path from "node:path";
import { endpoint } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return endpoint(
    request,
    async () =>
      new Response(
        new Uint8Array(
          await readFile(path.join(process.cwd(), "assets/fonts/NotoSansCJKsc-Regular.otf")),
        ),
        { headers: { "Content-Type": "font/otf" } },
      ),
  );
}
