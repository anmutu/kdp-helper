import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Store } from "../src/server/store";
import { checkLocalRequest } from "../src/server/security";

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "kdp-test-"));
  roots.push(root);
  return new Store(root);
}
afterEach(async () => {
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
    expect(listing.map((item) => item.id)).toEqual([keeper.id]);
    await expect(store.asset(asset.id)).rejects.toThrow("不存在");
    expect((await store.asset(otherAsset.id)).projectId).toBe(keeper.id);
    await expect(store.delete(book.id)).rejects.toThrow("不存在");
  });
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
