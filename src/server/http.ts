import { ZodError } from "zod";
import { checkLocalRequest } from "./security";
import { AppError, ExportValidationError } from "./errors";

export async function endpoint(request: Request, operation: () => Promise<Response>) {
  try {
    checkLocalRequest(request);
    const response = await operation();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof ZodError
          ? `输入不符合要求：${error.issues
              .slice(0, 3)
              .map((issue) => issue.path.join(".") + " " + issue.message)
              .join("；")}`
          : "本地处理失败。请检查磁盘空间和项目文件；原有文件不会被自动清空。";
    return Response.json(
      {
        error: message,
        ...(error instanceof ExportValidationError ? { issues: error.issues } : {}),
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function readJson(request: Request) {
  const bytes = await readBody(request, 5 * 1024 * 1024, "请求内容过大。", "");
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new AppError("请求不是有效 JSON。");
  }
}

export async function readBytes(request: Request, limit: number): Promise<Buffer> {
  return readBody(request, limit, "上传文件超过大小限制。", "请选择备份文件。");
}

async function readBody(
  request: Request,
  limit: number,
  tooLargeMessage: string,
  emptyMessage: string,
): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError(tooLargeMessage, 413);
  if (!request.body) {
    if (emptyMessage) throw new AppError(emptyMessage);
    return Buffer.alloc(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new AppError(tooLargeMessage, 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}
