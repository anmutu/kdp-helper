import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Store } from "../src/server/store";
import { checkLocalRequest } from "../src/server/security";
import { newPage, type Book } from "../src/domain/book";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "kdp-test-"));
  roots.push(root);
  return new Store(root);
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("local persistence and request boundary", () => {
  it("persists books and refuses stale overwrites", async () => {
    const store = await setup();
    const book = await store.create("My book");
    const saved = await store.save({ ...book, name: "New name" });
    expect(saved.version).toBe(1);
    await expect(store.save({ ...book, name: "stale" })).rejects.toThrow("其他操作");
    expect((await new Store(store.root).read(book.id)).name).toBe("New name");
  });
  it("keeps API keys out of public settings", async () => {
    const store = await setup();
    await store.saveSettings({ apiKey: "secret-not-for-client" });
    expect((await store.publicSettings()).hasKey).toBe(true);
    expect(JSON.stringify(await store.publicSettings())).not.toContain("secret-not-for-client");
  });
  it("rejects path traversal and fails closed for damaged books", async () => {
    const store = await setup();
    await expect(store.read("../settings")).rejects.toThrow();
    const book = await store.create("My book");
    const file = path.join(store.root, "projects", book.id + ".json");
    await writeFile(file, "broken");
    await expect(store.read(book.id)).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("broken");
  });
  it("lists healthy projects and reports damaged files without changing them", async () => {
    const store = await setup();
    const healthy = await store.create("Healthy book");
    const damaged = await store.create("Damaged book");
    const invalid = await store.create("Invalid schema");
    const damagedFile = `projects/${damaged.id}.json`;
    await writeFile(path.join(store.root, damagedFile), "broken");
    await store.atomic(`projects/${invalid.id}.json`, { id: invalid.id });
    const listing = await store.list();
    expect(listing.projects.map((book) => book.id)).toEqual([healthy.id]);
    expect(listing.problems.map((problem) => problem.file).sort()).toEqual(
      [damagedFile, `projects/${invalid.id}.json`].sort(),
    );
    expect(listing.problems.every((problem) => problem.message.includes("原文件"))).toBe(true);
    expect(await readFile(path.join(store.root, damagedFile), "utf8")).toBe("broken");
    expect(await store.read(healthy.id)).toEqual(healthy);
  });
  it("deletes a project and only its own assets, keeping other books and exports", async () => {
    const store = await setup();
    const book = await store.create("要删的书");
    const keeper = await store.create("保留的书");
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const asset = await store.addAsset(book.id, bytes, "import");
    const otherAsset = await store.addAsset(keeper.id, bytes, "import");
    await store.delete(book.id);
    await expect(store.read(book.id)).rejects.toThrow("不存在");
    const listing = await store.list();
    expect(listing.projects.map((item) => item.id)).toEqual([keeper.id]);
    expect(listing.problems).toEqual([]);
    await expect(store.asset(asset.id)).rejects.toThrow("不存在");
    expect((await store.asset(otherAsset.id)).projectId).toBe(keeper.id);
    await expect(store.delete(book.id)).rejects.toThrow("不存在");
  });
  it("removes a candidate with its files, but keeps files still referenced elsewhere", async () => {
    const store = await setup();
    const book = await store.create("候选删除");
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const asset = await store.addAsset(book.id, bytes, "import");
    await store.attach(book.id, "cover", asset);
    const page = { ...newPage(), kind: "illustration" as const };
    await store.mutate(book.id, (draft) => {
      draft.pages.push(page);
    });
    await store.attach(book.id, page.id, asset);
    await store.mutate(book.id, (draft) => {
      draft.cover.selectedAssetId = asset.id;
    });
    const updated = await store.removeCandidate(book.id, "cover", asset.id);
    expect(updated.cover.candidates).toEqual([]);
    expect(updated.cover.selectedAssetId).toBeNull();
    expect((await store.read(book.id)).pages[0].candidates.map((item) => item.id)).toEqual([
      asset.id,
    ]);
    await store.asset(asset.id);
    const orphaned = await store.addAsset(book.id, bytes, "generated");
    await store.attach(book.id, page.id, orphaned);
    await store.removeCandidate(book.id, page.id, orphaned.id);
    await expect(store.asset(orphaned.id)).rejects.toThrow("不存在");
  });
  it("requires a new style confirmation when a reference image changes", async () => {
    const store = await setup();
    const book = await store.create("参考图换风格");
    await store.mutate(book.id, (draft) => {
      draft.generationStyleConfirmed = true;
    });
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const asset = await store.addAsset(book.id, bytes, "import");
    const updated = await store.attach(book.id, "reference", asset);
    expect(updated.generationStyleConfirmed).toBe(false);
  });
  it("never leaves a dangling cover when reuse races candidate cleanup", async () => {
    const store = await setup();
    const book = await store.create("Concurrent reuse");
    const page = newPage();
    await store.mutate(book.id, (draft) => {
      draft.pages.push(page);
    });
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const asset = await store.addAsset(book.id, bytes, "import");
    await store.attach(book.id, page.id, asset);
    const lock = store.lock.bind(store);
    let reuse: Promise<Book> | undefined;
    vi.spyOn(store, "lock").mockImplementationOnce(async (key, operation) => {
      const result = await lock(key, operation);
      reuse = store.attachExisting(book.id, "cover", asset.id, true);
      await reuse.catch(() => undefined);
      return result;
    });
    await store.removeCandidate(book.id, page.id, asset.id);
    expect(reuse).toBeDefined();
    const latest = await store.read(book.id);
    if (latest.cover.selectedAssetId === asset.id) {
      await expect(store.assetBytes(asset.id)).resolves.toBeInstanceOf(Buffer);
    } else {
      await expect(reuse).rejects.toThrow("不存在");
      expect(latest.cover.candidates).toEqual([]);
    }
  });
  it.each(["existing", "reference", "candidate"])(
    "revalidates %s attachments after a queued deletion wins the project lock",
    async (mode) => {
      const store = await setup();
      const book = await store.create("Queued attachment");
      const page = newPage();
      await store.mutate(book.id, (draft) => {
        draft.pages.push(page);
      });
      const bytes = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const asset = await store.addAsset(book.id, bytes, "import");
      await store.attach(book.id, page.id, asset);
      const lock = store.lock.bind(store);
      vi.spyOn(store, "lock").mockImplementationOnce(async (key, operation) => {
        await store.removeCandidate(book.id, page.id, asset.id);
        return lock(key, operation);
      });
      const attachment =
        mode === "existing"
          ? store.attachExisting(book.id, "cover", asset.id, true)
          : store.attach(book.id, mode === "reference" ? "reference" : "cover", asset);
      await expect(attachment).rejects.toThrow("不存在");
      const latest = await store.read(book.id);
      expect(latest.cover.candidates).toEqual([]);
      expect(latest.cover.selectedAssetId).toBeNull();
      expect(latest.referenceAssetId).toBeNull();
    },
  );
  it("rejects remote hosts and cross-site writes", () => {
    expect(() =>
      checkLocalRequest(
        new Request("http://evil.example/api/settings", { headers: { host: "evil.example" } }),
      ),
    ).toThrow();
    expect(() =>
      checkLocalRequest(
        new Request("http://127.0.0.1:3210/api/settings", {
          method: "POST",
          headers: { host: "127.0.0.1:3210", origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      checkLocalRequest(
        new Request("http://127.0.0.1:3210/api/settings", {
          method: "POST",
          headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" },
        }),
      ),
    ).not.toThrow();
  });
});

describe("reuse existing illustration on cover", () => {
  it("attaches an in-project asset, selects it, and refuses foreign assets", async () => {
    const store = await setup();
    const book = await store.create("复用测试");
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#dddddd" },
    })
      .png()
      .toBuffer();
    const asset = await store.addAsset(book.id, bytes, "generated");
    const updated = await store.attachExisting(book.id, "cover", asset.id, true);
    expect(updated.cover.candidates.map((item) => item.id)).toEqual([asset.id]);
    expect(updated.cover.selectedAssetId).toBe(asset.id);
    expect(updated.cover.imageConfirmed).toBe(true);
    const again = await store.attachExisting(book.id, "cover", asset.id, true);
    expect(again.cover.candidates).toHaveLength(1);
    const foreign = await store.addAsset((await store.create("另一本")).id, bytes, "import");
    await expect(store.attachExisting(book.id, "cover", foreign.id, true)).rejects.toThrow(
      "不属于此项目",
    );
  });
});
