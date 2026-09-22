import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/server/store";
import { listExports } from "../src/server/exports";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("persistent export history", () => {
  it("reads existing export snapshots, sorts newest first and skips temporary or broken versions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kdp-history-"));
    roots.push(root);
    const store = new Store(root);
    const original = await store.create("History");
    const current = await store.save({ ...original, name: "Changed book" });
    const older = "print-0-1700000000000-abcdef01";
    const newer = "draft-1-1700000001000-abcdef02";
    const broken = "print-1-1700000002000-abcdef03";
    for (const [version, snapshot] of [
      [older, original],
      [newer, current],
    ] as const) {
      const directory = path.join(root, "exports", current.id, version);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "interior.pdf"), "%PDF-1.7\nexample");
      await writeFile(path.join(directory, "upload-notes.txt"), "Test notes");
      await store.atomic(`exports/${current.id}/${version}/snapshot.json`, snapshot);
      if (version === older) await writeFile(path.join(directory, "cover.pdf"), "%PDF-1.7\ncover");
    }
    await mkdir(path.join(root, "exports", current.id, broken), { recursive: true });
    await mkdir(path.join(root, "exports", current.id, ".incomplete.tmp"), { recursive: true });
    const result = await listExports(current.id, store);
    expect(result.items.map((item) => item.version)).toEqual([newer, older]);
    expect(result.items[0]).toMatchObject({ draft: true, current: true, target: "interior" });
    expect(result.items[1]).toMatchObject({ draft: false, current: false, target: "all" });
    expect(result.items[1].files.map((file) => file.name)).toEqual([
      "interior.pdf",
      "cover.pdf",
      "upload-notes.txt",
    ]);
    expect(result.problems.map((problem) => problem.version)).toEqual([broken]);
  });

  it("returns an empty history for a new project but rejects a missing project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kdp-history-"));
    roots.push(root);
    const store = new Store(root);
    const book = await store.create("New book");
    expect(await listExports(book.id, store)).toEqual({ items: [], problems: [] });
    await expect(listExports(crypto.randomUUID(), store)).rejects.toThrow("不存在");
  });
});
