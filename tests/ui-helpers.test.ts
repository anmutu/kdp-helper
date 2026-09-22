import { afterEach, describe, expect, it, vi } from "vitest";
import { newPage, type Issue, type Job } from "../src/domain/book";
import { createBook } from "../src/domain/print-spec";
import {
  duplicatePage,
  editBook,
  mergeSavedBook,
  movePage,
  generationTargets,
  cropStyle,
  jobIsInFlight,
  exportIssues,
  issueStage,
  request,
  RequestError,
} from "../src/components/workbench/ui-helpers";
import {
  prepareGenerationIntent,
  clearGenerationIntent,
} from "../src/components/workbench/generation-intent";

describe("workbench draft safety", () => {
  it("invalidates confirmations without inventing a server version", () => {
    const original = createBook("My book");
    original.specConfirmed = true;
    original.pages = [{ ...newPage(), imageConfirmed: true }];
    const edited = editBook(original, (draft) => {
      draft.config.bleed = true;
      draft.style = "A new style";
    });
    expect(edited.specConfirmed).toBe(false);
    expect(edited.pages[0].imageConfirmed).toBe(false);
    expect(edited.version).toBe(original.version);
    expect(original.config.bleed).toBe(false);
  });
  it("keeps typing during save while accepting reconciled confirmations", () => {
    const sent = createBook("Before");
    sent.specConfirmed = true;
    const local = { ...sent, name: "Typed during save" };
    const saved = { ...sent, version: 2, specConfirmed: false };
    expect(mergeSavedBook(sent, local, saved)).toMatchObject({
      name: "Typed during save",
      version: 2,
      specConfirmed: false,
    });
  });
  it("preserves newer page edits and server candidate metadata", () => {
    const sent = createBook("Book");
    sent.pages = [newPage()];
    const local = structuredClone(sent);
    local.pages[0].text = "Still typing";
    const saved = structuredClone(sent);
    saved.pages[0].imageConfirmed = true;
    expect(mergeSavedBook(sent, local, saved).pages[0]).toMatchObject({
      text: "Still typing",
      imageConfirmed: true,
    });
  });
  it("reorders only within the page list and preserves ids", () => {
    const pages = [newPage(), newPage(), newPage()];
    expect(movePage(pages, pages[1].id, -1).map((page) => page.id)).toEqual([
      pages[1].id,
      pages[0].id,
      pages[2].id,
    ]);
    expect(movePage(pages, pages[0].id, -1)).toEqual(pages);
  });
  it("never includes blank/text/reference targets in image batches", () => {
    const book = createBook("Book");
    book.pages = [newPage(), { ...newPage(), kind: "text" }, { ...newPage(), kind: "blank" }];
    expect(generationTargets(book, "all")).toEqual([book.pages[0].id]);
  });
  it("models cover crop offsets as remaining-space fractions", () => {
    expect(
      cropStyle({ width: 200, height: 100 }, { width: 100, height: 100 }, 2, 1, 0),
    ).toMatchObject({ width: "400%", height: "200%", left: "-300%", top: "0%" });
  });
  it("keeps a paused task locked until its already-sent request finishes", () => {
    const job: Job = {
      id: "job",
      projectId: "book",
      status: "paused",
      current: 0,
      createdAt: "",
      message: "",
      targetIds: ["cover"],
      items: [{ targetId: "cover", status: "running" }],
    };
    expect(jobIsInFlight(job)).toBe(true);
    expect(jobIsInFlight({ ...job, items: [{ targetId: "cover", status: "completed" }] })).toBe(
      false,
    );
  });
});

function intentStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("persistent generation intent", () => {
  const input = { projectId: "project", targetIds: ["page", "cover"], count: 1, sample: true };
  it("reuses the persisted UUID after a lost response and across fresh storage wrappers", () => {
    const storage = intentStorage();
    const first = prepareGenerationIntent(storage, input);
    const retry = prepareGenerationIntent(
      { ...storage },
      { ...input, targetIds: [...input.targetIds] },
    );
    expect(retry).toEqual(first);
    expect(first.operationId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(storage.values.size).toBe(1);
  });
  it("uses independent intents for changed parameters without losing the earlier uncertain request", () => {
    const storage = intentStorage();
    const original = prepareGenerationIntent(storage, input);
    for (const changed of [
      { ...input, projectId: "another" },
      { ...input, targetIds: ["cover"] },
      { ...input, count: 2 },
      { ...input, sample: false },
    ]) {
      expect(prepareGenerationIntent(storage, changed).operationId).not.toBe(original.operationId);
    }
    expect(prepareGenerationIntent(storage, input).operationId).toBe(original.operationId);
  });
  it("creates a new operation only after explicit successful acknowledgement clears the old intent", () => {
    const storage = intentStorage();
    const original = prepareGenerationIntent(storage, input);
    clearGenerationIntent(storage, original);
    expect(storage.values.size).toBe(0);
    expect(prepareGenerationIntent(storage, input).operationId).not.toBe(original.operationId);
  });
  it("does not erase a newer intent when an older response finishes", () => {
    const storage = intentStorage();
    const original = prepareGenerationIntent(storage, input);
    clearGenerationIntent(storage, original);
    const newer = prepareGenerationIntent(storage, input);
    clearGenerationIntent(storage, original);
    expect(prepareGenerationIntent(storage, input).operationId).toBe(newer.operationId);
  });
  it("fails closed when persistence is unavailable or corrupted", () => {
    const storage = intentStorage();
    expect(() =>
      prepareGenerationIntent(
        {
          ...storage,
          setItem: () => {
            throw new Error("Quota exceeded");
          },
        },
        input,
      ),
    ).toThrow(/本地存储/);
    prepareGenerationIntent(storage, input);
    const key = [...storage.values.keys()][0];
    storage.values.set(key, "broken");
    expect(() => prepareGenerationIntent(storage, input)).toThrow(/记录/);
  });
  it("persists only the explicit generation payload and operation id, never caller secrets", () => {
    const storage = intentStorage();
    prepareGenerationIntent(storage, {
      ...input,
      apiKey: "secret-must-not-persist",
    } as typeof input);
    expect([...storage.values.values()].join()).not.toContain("secret-must-not-persist");
  });
});

describe("export scope", () => {
  const issues: Issue[] = [
    { code: "cover-title", severity: "error", message: "封面未完成" },
    { code: "cover-dpi", severity: "error", message: "封面低清" },
    { code: "missing-image", severity: "error", message: "内页缺图" },
    { code: "spec-unconfirmed", severity: "error", message: "规格未确认" },
    { code: "human-review", severity: "warning", message: "人工审核仍必需" },
  ];
  it("keeps every error for a whole-book export", () => {
    expect(exportIssues(issues, "all")).toEqual(issues);
  });
  it("excludes only cover errors for interior-only export without dropping human review", () => {
    expect(exportIssues(issues, "interior").map((issue) => issue.code)).toEqual([
      "missing-image",
      "spec-unconfirmed",
      "human-review",
    ]);
    expect(issues).toHaveLength(5);
  });
  it("merges server checks without duplicate errors and locates layout issues", () => {
    const overflow: Issue = {
      code: "text-overflow",
      severity: "error",
      message: "第 7 页文字溢出",
      pageId: "page-seven",
    };
    expect(exportIssues(issues, "all", [issues[0], overflow])).toEqual([...issues, overflow]);
    expect(issueStage(overflow)).toBe(2);
    expect(issueStage({ ...overflow, code: "missing-glyph" })).toBe(2);
    expect(issueStage({ ...overflow, code: "missing-image" })).toBe(1);
    expect(issueStage({ ...overflow, code: "low-dpi" })).toBe(1);
    expect(issueStage({ ...overflow, code: "review-image" })).toBe(1);
    expect(issueStage(issues[0])).toBe(2);
    expect(issueStage(issues[3])).toBe(0);
  });
});

describe("structured request errors", () => {
  afterEach(() => vi.restoreAllMocks());
  it("preserves valid export issues for the workbench instead of only their message", async () => {
    const issues: Issue[] = [
      {
        code: "text-overflow",
        severity: "error",
        message: "第 7 页文字溢出",
        pageId: "page-seven",
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "正式导出被阻止", issues }, { status: 422 }),
    );
    await expect(request("/api/export")).rejects.toMatchObject({ status: 422, issues });
  });
  it("ignores malformed issue details without losing the original error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: "正式导出被阻止", issues: [{ code: 4, message: {} }] },
        { status: 422 },
      ),
    );
    await expect(request("/api/export")).rejects.toEqual(
      expect.objectContaining({ message: "正式导出被阻止", issues: [] }),
    );
    expect(new RequestError("失败", 500).status).toBe(500);
  });
});

describe("duplicate page", () => {
  it("copies content and layout but never the selection or its confirmation", () => {
    const page = newPage();
    page.kind = "illustration";
    page.title = "B — Bear";
    page.text = "一只熊。";
    page.prompt = "a friendly bear";
    page.layout = "full";
    page.fontSize = 28;
    page.candidates = [{ ...newPage(), id: page.id } as never];
    page.selectedAssetId = page.id;
    page.imageConfirmed = true;
    const copy = duplicatePage(page);
    expect(copy.id).not.toBe(page.id);
    expect(copy.kind).toBe("illustration");
    expect(copy.title).toBe("B — Bear");
    expect(copy.text).toBe("一只熊。");
    expect(copy.prompt).toBe("a friendly bear");
    expect(copy.layout).toBe("full");
    expect(copy.fontSize).toBe(28);
    expect(copy.candidates).toEqual([]);
    expect(copy.selectedAssetId).toBeNull();
    expect(copy.imageConfirmed).toBe(false);
  });
});
