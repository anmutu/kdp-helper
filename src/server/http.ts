import { ZodError } from "zod";
import { checkLocalRequest } from "./security";
import { AppError } from "./errors";

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
    return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
export async function readJson(request: Request) {
  if (Number(request.headers.get("content-length")) > 5 * 1024 * 1024)
    throw new AppError("请求内容过大。", 413);
  const text = await request.text();
  if (text.length > 5 * 1024 * 1024) throw new AppError("请求内容过大。", 413);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("请求不是有效 JSON。");
  }
}
