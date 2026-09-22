import {
  issueSchema,
  newPage,
  type Book,
  type BookPage,
  type Issue,
  type Job,
} from "@/domain/book";
import { reconcileBook } from "@/domain/print-spec";

export type BookEdit = (draft: Book) => void;
export type ExportTarget = "all" | "interior";

export function exportIssues(
  issues: Issue[],
  target: ExportTarget,
  serverIssues: Issue[] = [],
): Issue[] {
  const merged = [
    ...new Map(
      [...issues, ...serverIssues].map((issue) => [`${issue.code}:${issue.pageId || ""}`, issue]),
    ).values(),
  ];
  return target === "all"
    ? merged
    : merged.filter((issue) => !(issue.severity === "error" && issue.code.startsWith("cover-")));
}

export function issueStage(issue: Issue): 0 | 1 | 2 {
  if (["missing-image", "low-dpi", "review-image"].includes(issue.code)) return 1;
  if (
    issue.code.startsWith("cover-") ||
    issue.code === "text-overflow" ||
    issue.code === "missing-glyph"
  )
    return 2;
  return 0;
}

export function jobIsInFlight(job: Job): boolean {
  return (
    job.status === "queued" ||
    job.status === "running" ||
    (job.status === "paused" && job.items.some((item) => item.status === "running"))
  );
}

export function editBook(book: Book, edit: BookEdit): Book {
  const draft = structuredClone(book);
  edit(draft);
  return { ...reconcileBook(book, draft), version: book.version, updatedAt: book.updatedAt };
}

function mergeValue(sent: unknown, local: unknown, remote: unknown): unknown {
  if (JSON.stringify(sent) === JSON.stringify(local)) return remote;
  if (Array.isArray(sent) && Array.isArray(local) && Array.isArray(remote)) {
    return local.map((item) => {
      if (!item || typeof item !== "object" || !("id" in item)) return item;
      const before = sent.find((entry) => entry.id === item.id);
      const saved = remote.find((entry) => entry.id === item.id);
      return before && saved ? mergeValue(before, item, saved) : item;
    });
  }
  if (
    sent &&
    local &&
    remote &&
    typeof sent === "object" &&
    typeof local === "object" &&
    typeof remote === "object"
  ) {
    return Object.fromEntries(
      Object.keys(local).map((key) => [
        key,
        mergeValue(
          (sent as Record<string, unknown>)[key],
          (local as Record<string, unknown>)[key],
          (remote as Record<string, unknown>)[key],
        ),
      ]),
    );
  }
  return local;
}

export function mergeSavedBook(sent: Book, local: Book, remote: Book): Book {
  return {
    ...(mergeValue(sent, local, remote) as Book),
    version: remote.version,
    updatedAt: remote.updatedAt,
  };
}

export function movePage(pages: BookPage[], id: string, direction: -1 | 1): BookPage[] {
  const index = pages.findIndex((page) => page.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= pages.length) return pages;
  const result = [...pages];
  [result[index], result[destination]] = [result[destination], result[index]];
  return result;
}

export function duplicatePage(page: BookPage): BookPage {
  return {
    ...newPage(),
    kind: page.kind,
    title: page.title,
    text: page.text,
    prompt: page.prompt,
    layout: page.layout,
    fontSize: page.fontSize,
  };
}

export function generationTargets(book: Book, mode: "all" | "missing"): string[] {
  return book.pages
    .filter((page) => page.kind === "illustration" && (mode === "all" || !page.selectedAssetId))
    .map((page) => page.id);
}

export function cropStyle(
  asset: { width: number; height: number },
  rect: { width: number; height: number },
  zoom = 1,
  offsetX = 0.5,
  offsetY = 0.5,
) {
  const scale = Math.max(rect.width / asset.width, rect.height / asset.height) * zoom;
  const width = ((asset.width * scale) / rect.width) * 100;
  const height = ((asset.height * scale) / rect.height) * 100;
  return {
    width: `${width}%`,
    height: `${height}%`,
    left: `${(100 - width) * offsetX}%`,
    top: `${(100 - height) * offsetY}%`,
  };
}

export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: Issue[] = [],
  ) {
    super(message);
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = issueSchema.array().safeParse(data?.issues);
    throw new RequestError(
      data?.error || `请求失败（${response.status}），请检查本地服务。`,
      response.status,
      parsed.success ? parsed.data : [],
    );
  }
  if (!data) throw new RequestError("服务返回了无法读取的响应。", response.status);
  return data as T;
}

export function downloadDraft(book: Book) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(book, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${book.name || "book"}-local-draft.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
