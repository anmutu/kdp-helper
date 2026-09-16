import { AppError } from "./errors";

export function checkLocalRequest(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
    throw new AppError("此工具仅允许本机访问。", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== `${url.protocol}//${host}`)
    throw new AppError("不接受来自其他网站的请求。", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("不接受跨站请求。", 403);
}

export function providerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("请填写有效的服务地址。");
  }
  if (url.username || url.password || url.search || url.hash)
    throw new AppError("服务地址不能包含凭据、参数或片段。");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new AppError("远程 AI 服务必须使用 HTTPS；HTTP 仅允许本机。");
  return url.toString().replace(/\/+$/, "");
}
