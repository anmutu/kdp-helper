import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { newPage, type Book, type BookPage, type Settings } from "@/domain/book";
import { AppError } from "./errors";
import { providerUrl } from "./security";

export class ProviderError extends AppError {
  constructor(
    message: string,
    public uncertain = false,
  ) {
    super(message, 502);
    this.name = "ProviderError";
  }
}
async function readLimited(response: Response, max = 48 * 1024 * 1024) {
  if (Number(response.headers.get("content-length")) > max)
    throw new ProviderError("返回文件过大，已停止下载；请检查服务端任务结果。", true);
  if (!response.body) throw new ProviderError("服务没有返回内容。", true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new ProviderError("返回内容超过安全大小限制。", true);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
async function resultJson(response: Response) {
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "API Key 无效或无权限。",
      402: "服务额度不足。",
      403: "模型调用被拒绝，请检查权限。",
      429: "服务限流，请稍后手动重试。",
    };
    throw new ProviderError(
      messages[response.status] ||
        `AI 服务返回 HTTP ${response.status}，请检查模型、尺寸参数与服务控制台。`,
      response.status >= 500,
    );
  }
  try {
    return JSON.parse((await readLimited(response)).toString("utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("服务响应不是有效 JSON，调用结果未知；请先检查控制台。", true);
  }
}
function isPrivate(address: string) {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] >= 224 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.includes("::ffff:")
  );
}
async function downloadImage(location: string): Promise<Buffer> {
  let url = new URL(location);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" || url.username || url.password)
      throw new ProviderError("图片下载地址不安全，未访问；请从服务控制台手动取回。", true);
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.some((result) => isPrivate(result.address)))
      throw new ProviderError("服务返回了内网图片地址，已拒绝下载。", true);
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (response.status >= 300 && response.status < 400) {
      const redirect = response.headers.get("location");
      if (!redirect) break;
      url = new URL(redirect, url);
      continue;
    }
    if (!response.ok)
      throw new ProviderError(
        "图片生成响应已收到，但下载失败；请先从服务控制台取回，避免重复计费。",
        true,
      );
    return readLimited(response, 32 * 1024 * 1024);
  }
  throw new ProviderError("图片下载重定向过多，请从服务控制台取回。", true);
}

export async function generateImage(
  settings: Settings,
  prompt: string,
  reference?: Buffer,
): Promise<Buffer> {
  if (!settings.apiKey) throw new AppError("请先在设置中填写 API Key。");
  if (reference && !settings.referenceSupported)
    throw new AppError("当前配置尚未确认支持参考图，请先确认接口能力或移除参考图。");
  let body: BodyInit;
  let endpoint = "generations";
  const headers: Record<string, string> = { Authorization: `Bearer ${settings.apiKey}` };
  if (reference) {
    const form = new FormData();
    form.set("model", settings.imageModel);
    form.set("prompt", prompt);
    form.set("size", settings.imageSize);
    form.set("n", "1");
    form.set(
      "image",
      new Blob([new Uint8Array(reference)], { type: "image/png" }),
      "reference.png",
    );
    body = form;
    endpoint = "edits";
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ model: settings.imageModel, prompt, size: settings.imageSize, n: 1 });
  }
  let response: Response;
  try {
    response = await fetch(`${providerUrl(settings.baseUrl)}/images/${endpoint}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(240_000),
      redirect: "error",
    });
  } catch {
    throw new ProviderError(
      "连接中断或请求超时，服务可能已受理并计费。已停止自动重试，请先检查控制台结果。",
      true,
    );
  }
  const result = await resultJson(response);
  const data = z
    .array(z.object({ b64_json: z.string().optional(), url: z.string().optional() }))
    .safeParse(result.data);
  if (!data.success || !data.data[0])
    throw new ProviderError("服务未返回可读取的图片；请检查控制台，避免直接重复计费。", true);
  const image = data.data[0];
  if (image.b64_json) {
    const bytes = Buffer.from(image.b64_json, "base64");
    if (bytes.length > 32 * 1024 * 1024)
      throw new ProviderError("图片超过 32 MB，请从服务控制台取回。", true);
    return bytes;
  }
  if (image.url) {
    try {
      return await downloadImage(image.url);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("图片下载失败，请从服务控制台取回后导入。", true);
    }
  }
  throw new ProviderError("返回图片为空，结果未知。", true);
}

export async function generateOutline(
  settings: Settings,
  book: Book,
  targetPages: number,
): Promise<BookPage[]> {
  if (!settings.apiKey || !settings.textModel)
    throw new AppError("请配置 API Key 和文字模型，或直接手动填写页面。");
  if (!book.theme.trim()) throw new AppError("请先填写这本书的主题。");
  const prompt = `为一本儿童绘本起草逐页内容。主题：${book.theme}。读者：${book.audience}。正文语言：${book.language}。整本书恰好 ${targetPages} 页，页数必须是偶数，不要多也不要少。返回纯 JSON 对象 {"pages":[{"title":"","text":"","prompt":"英文插画描述","kind":"illustration或text"}]}。其中恰好一页是「关于这本书」版权页，其文字必须原样使用「请在此填写真实的版权信息和素材声明。」作为占位符。不生成其他版权声明，不添加虚假作者、授权、ISBN信息。图片描述不含画面内文字。内容是需作者审阅的草稿。`;
  let response: Response;
  try {
    response = await fetch(`${providerUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.textModel,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    });
  } catch {
    throw new ProviderError("文字请求超时或中断，请检查服务记录后再决定是否重试。", true);
  }
  const result = await resultJson(response);
  const choices = z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .safeParse(result.choices);
  if (!choices.success || !choices.data[0]) throw new ProviderError("文字模型未返回可读取内容。");
  try {
    const content = choices.data[0].message.content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const outline = z
      .object({
        pages: z
          .array(
            z.object({
              title: z.string().max(200),
              text: z.string().max(3000),
              prompt: z.string().max(12000).default(""),
              kind: z.enum(["illustration", "text"]).default("illustration"),
            }),
          )
          .min(1)
          .max(60),
      })
      .parse(JSON.parse(content));
    if (outline.pages.length !== targetPages)
      throw new ProviderError(
        `文字模型返回的页数为 ${outline.pages.length} 页，与要求的 ${targetPages} 页不一致。原书未被修改，未自动重试；请先检查服务记录，也可以手动填写页面。`,
      );
    return outline.pages.map((page) => ({ ...newPage(), ...page }));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("文字模型未遵循页面 JSON 格式，原书未被修改；可以手动填写或调整模型。");
  }
}
