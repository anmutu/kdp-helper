import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { newPage, type Book, type Job, type PrintConfig } from "../src/domain/book";
import { listJobs, pauseJob, recoverJobs, startJob } from "../src/server/jobs";
import { generateImage } from "../src/server/provider";
import { store } from "../src/server/store";

vi.mock("../src/server/provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/server/provider")>();
  return { ...original, generateImage: vi.fn(original.generateImage) };
});

const runtime = globalThis as unknown as {
  kdpJobs?: Map<string, Job>;
  kdpRecovery?: Promise<void>;
};
const originalRoot = store.root;
const releases: Array<() => void> = [];
let temporaryRoot: string;
let highResolution: Buffer;
let lowResolution: Buffer;

function deferred<Value>(fallback: Value) {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  releases.push(() => resolve(fallback));
  return { promise, release: (value = fallback) => resolve(value) };
}

async function makeBook(
  options: {
    pageCount?: number;
    ink?: PrintConfig["ink"];
    layout?: "caption" | "full";
  } = {},
) {
  const book = await store.create("Offline generation regression");
  return store.mutate(book.id, (current) => {
    current.config.bleed = true;
    current.config.ink = options.ink ?? "premium";
    current.specConfirmed = true;
    current.pages = Array.from({ length: options.pageCount ?? 24 }, (_, index) => ({
      ...newPage(),
      kind: index < 2 ? ("illustration" as const) : ("blank" as const),
      layout: options.layout ?? "full",
      prompt: `A friendly animal for page ${index + 1}`,
    }));
  });
}

function requestFor(book: Book, targetIds = book.pages.slice(0, 2).map((page) => page.id)) {
  return {
    operationId: crypto.randomUUID(),
    projectId: book.id,
    targetIds,
    count: 1,
    sample: false,
  };
}

async function settledJob(id: string) {
  await vi.waitFor(() => expect(runtime.kdpJobs?.has(id) ?? false).toBe(false), {
    timeout: 4000,
    interval: 10,
  });
  const job = (await store.jobs()).find((item) => item.id === id);
  expect(job).toBeDefined();
  return job!;
}

beforeAll(async () => {
  highResolution = await sharp({
    create: { width: 3000, height: 3000, channels: 3, background: "#c5d1b0" },
  })
    .png()
    .toBuffer();
  lowResolution = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#c5d1b0" },
  })
    .png()
    .toBuffer();
});

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "kdp-jobs-test-"));
  store.root = temporaryRoot;
  runtime.kdpJobs?.clear();
  delete runtime.kdpRecovery;
  vi.mocked(generateImage).mockReset().mockResolvedValue(highResolution);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("External requests are forbidden in job tests")),
  );
  await store.saveSettings({
    baseUrl: "https://offline.invalid/v1",
    apiKey: "offline-test-key",
    imageModel: "offline-image-model",
    imageSize: "3000x3000",
    referenceSupported: false,
  });
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  try {
    await vi.waitFor(() => expect(runtime.kdpJobs?.size ?? 0).toBe(0), {
      timeout: 4000,
      interval: 10,
    });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete runtime.kdpRecovery;
    store.root = originalRoot;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

describe("generation specification and pixel gates", () => {
  it("keeps the returned low-resolution image but pauses paid work before the next request", async () => {
    const book = await makeBook();
    vi.mocked(generateImage).mockResolvedValue(lowResolution);

    const job = await settledJob((await startJob(requestFor(book))).id);
    const saved = await store.read(book.id);

    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(job.status).toBe("paused");
    expect(job.current).toBe(1);
    expect(job.items.map((item) => item.status)).toEqual(["completed", "queued"]);
    expect(saved.pages[0].candidates).toHaveLength(1);
    expect(saved.pages[0].candidates[0]).toMatchObject({
      width: 1024,
      height: 1024,
      source: "generated",
    });
    expect(saved.pages[0].selectedAssetId).toBeNull();
    expect(saved.pages[1].candidates).toHaveLength(0);
    const bytes = await store.assetBytes(saved.pages[0].candidates[0].id);
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1024, height: 1024 });
  });

  it("allows explicitly requested low-resolution samples to complete", async () => {
    const book = await makeBook();
    vi.mocked(generateImage).mockResolvedValue(lowResolution);

    const job = await settledJob((await startJob({ ...requestFor(book), sample: true })).id);

    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(job.status).toBe("completed");
    expect(job.items.map((item) => item.status)).toEqual(["completed", "completed"]);
  });

  it.each([
    { ink: "premium" as const, pageCount: 600 },
    { ink: "standard" as const, pageCount: 32 },
  ])("rejects $pageCount pages with $ink ink before creating paid work", async (options) => {
    const book = await makeBook(options);

    await expect(startJob(requestFor(book))).rejects.toMatchObject({ status: 400 });

    expect(generateImage).not.toHaveBeenCalled();
    expect(await store.jobs()).toEqual([]);
  });

  const changes: Array<{ name: string; edit: (book: Book) => void }> = [
    {
      name: "caption to full-bleed layout",
      edit: (book) => {
        book.pages[1].layout = "full";
      },
    },
    {
      name: "increased crop zoom",
      edit: (book) => {
        book.pages[1].zoom = 2;
      },
    },
    {
      name: "page count beyond the trim limit",
      edit: (book) => {
        while (book.pages.length < 600) book.pages.push({ ...newPage(), kind: "blank" });
      },
    },
  ];

  it.each(changes)("rechecks $name before sending the next paid request", async ({ edit }) => {
    const book = await makeBook({ layout: "caption" });
    await store.saveSettings({ imageSize: "2300x2300" });
    const firstImage = deferred(highResolution);
    vi.mocked(generateImage).mockImplementationOnce(() => firstImage.promise);
    const started = await startJob(requestFor(book));
    await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1));

    const edited = await store.read(book.id);
    edit(edited);
    await store.save(edited);
    firstImage.release();
    const job = await settledJob(started.id);

    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(job.status).toBe("paused");
    expect(job.items.map((item) => item.status)).toEqual(["completed", "queued"]);
    const saved = await store.read(book.id);
    expect(saved.pages[0].candidates).toHaveLength(1);
    expect(saved.pages[1].candidates).toHaveLength(0);
    expect(saved.pages.length).toBe(edited.pages.length);
    expect(saved.pages[1].layout).toBe(edited.pages[1].layout);
    expect(saved.pages[1].zoom).toBe(edited.pages[1].zoom);
  });
});

describe("paid operation idempotency", () => {
  it.each([undefined, "not-a-uuid"])(
    "rejects an invalid operationId (%s) before billing",
    async (operationId) => {
      const book = await makeBook();

      await expect(startJob({ ...requestFor(book), operationId })).rejects.toThrow();

      expect(generateImage).not.toHaveBeenCalled();
      expect(await store.jobs()).toEqual([]);
    },
  );

  it("replays a completed operation without creating a second candidate and persists its history", async () => {
    const book = await makeBook();
    const input = requestFor(book, [book.pages[0].id]);
    const original = await settledJob((await startJob(input)).id);
    delete runtime.kdpRecovery;

    const replayed = await startJob({ ...input, targetIds: [...input.targetIds] });
    await settledJob(replayed.id);

    expect(replayed.id).toBe(original.id);
    expect(replayed.status).toBe("completed");
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect((await store.read(book.id)).pages[0].candidates).toHaveLength(1);
    await store.atomic("jobs.json", []);
    delete runtime.kdpRecovery;
    const historical = await startJob({ ...input });
    expect(historical.id).toBe(original.id);
    expect(historical.status).toBe("completed");
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(await store.jobs()).toEqual([]);
    expect(await store.json(`jobs/${original.id}.json`)).toMatchObject({
      id: original.id,
      operationId: input.operationId,
      status: "completed",
    });
  });

  it("returns the original job when the same operation is replayed while running", async () => {
    const book = await makeBook();
    const input = requestFor(book, [book.pages[0].id]);
    const firstImage = deferred(highResolution);
    vi.mocked(generateImage).mockImplementationOnce(() => firstImage.promise);
    const original = await startJob(input);
    await vi.waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1));

    const replayed = await startJob({ ...input });

    expect(replayed.id).toBe(original.id);
    expect(generateImage).toHaveBeenCalledTimes(1);
    firstImage.release();
    expect((await settledJob(original.id)).status).toBe("completed");
  });

  it.each(["count", "sample", "targetIds", "projectId"] as const)(
    "rejects a changed %s for the same operationId with 409",
    async (field) => {
      const book = await makeBook();
      const input = requestFor(book, [book.pages[0].id]);
      const original = await settledJob((await startJob(input)).id);
      const projectId = field === "projectId" ? (await makeBook()).id : book.id;
      const changed = {
        ...input,
        projectId,
        ...(field === "count" ? { count: 2 } : {}),
        ...(field === "sample" ? { sample: true } : {}),
        ...(field === "targetIds" ? { targetIds: [book.pages[1].id] } : {}),
      };

      await expect(startJob(changed)).rejects.toMatchObject({ status: 409 });

      expect(generateImage).toHaveBeenCalledTimes(1);
      expect((await store.jobs()).map((job) => job.id)).toEqual([original.id]);
    },
  );
});

describe("pause, recovery, and uncertain responses", () => {
  it("does not overwrite a pause received while the reference image is still being prepared", async () => {
    const initial = await makeBook();
    const reference = await store.addAsset(initial.id, lowResolution, "import");
    const book = await store.attach(initial.id, "reference", reference);
    await store.saveSettings({ referenceSupported: true });
    const preparation = deferred<void>(undefined);
    const readAsset = store.assetBytes.bind(store);
    let preparing = false;
    vi.spyOn(store, "assetBytes").mockImplementation(async (id) => {
      if (id === reference.id) {
        preparing = true;
        await preparation.promise;
      }
      return readAsset(id);
    });
    const started = await startJob(requestFor(book));
    await vi.waitFor(() => expect(preparing).toBe(true));

    await pauseJob(started.id);
    expect(generateImage).not.toHaveBeenCalled();
    preparation.release();
    const job = await settledJob(started.id);

    expect(job.status).toBe("paused");
    expect(job.current).toBe(0);
    expect(job.items.map((item) => item.status)).toEqual(["queued", "queued"]);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("recovers a paused in-flight item as unknown without resending it or locking new work", async () => {
    const book = await makeBook();
    const input = requestFor(book);
    const interrupted: Job & { operationId: string } = {
      id: crypto.randomUUID(),
      operationId: input.operationId,
      projectId: book.id,
      targetIds: input.targetIds,
      current: 0,
      status: "paused",
      items: [
        { targetId: book.pages[0].id, status: "running" },
        { targetId: book.pages[1].id, status: "queued" },
      ],
      createdAt: new Date().toISOString(),
      message: "Paused while the first request was in flight",
    };
    await store.saveJob(interrupted);
    delete runtime.kdpRecovery;

    await recoverJobs();
    const recovered = (await listJobs(book.id)).find((job) => job.id === interrupted.id);

    expect(recovered?.status).toBe("paused");
    expect(recovered?.items.map((item) => item.status)).toEqual(["unknown", "queued"]);
    expect(runtime.kdpJobs?.size ?? 0).toBe(0);
    expect(generateImage).not.toHaveBeenCalled();
    const subsequent = await settledJob((await startJob(requestFor(book, [book.pages[1].id]))).id);
    expect(subsequent.status).toBe("completed");
    expect(generateImage).toHaveBeenCalledTimes(1);
    const saved = await store.read(book.id);
    expect(saved.pages[0].candidates).toHaveLength(0);
    expect(saved.pages[1].candidates).toHaveLength(1);
  });

  it("marks an oversized successful provider response unknown and stops the remaining paid requests", async () => {
    const actual =
      await vi.importActual<typeof import("../src/server/provider")>("../src/server/provider");
    vi.mocked(generateImage).mockImplementation(actual.generateImage);
    const fetch = vi.fn().mockResolvedValue(
      new Response("unread oversized result", {
        status: 200,
        headers: { "content-length": String(60 * 1024 * 1024) },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const book = await makeBook();

    const job = await settledJob((await startJob(requestFor(book))).id);

    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(job.status).toBe("unknown");
    expect(job.items.map((item) => item.status)).toEqual(["unknown", "queued"]);
    expect(job.current).toBe(0);
    expect(
      (await store.read(book.id)).pages.slice(0, 2).map((page) => page.candidates.length),
    ).toEqual([0, 0]);
  });
});
