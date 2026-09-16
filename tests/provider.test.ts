import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImage, ProviderError } from "../src/server/provider";
import { validateGeneration } from "../src/server/jobs";
import { createBook } from "../src/domain/print-spec";
import { newPage, type Settings } from "../src/domain/book";
const settings: Settings = {
  baseUrl: "https://example.com/v1",
  apiKey: "secret",
  imageModel: "my-image-model",
  textModel: "",
  imageSize: "1024x1024",
  referenceSupported: false,
};
afterEach(() => vi.unstubAllGlobals());
describe("generation safety", () => {
  it("never retries an uncertain billed request", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network disconnected"));
    vi.stubGlobal("fetch", fetch);
    await expect(generateImage(settings, "A bear")).rejects.toMatchObject({ uncertain: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("decodes a result and explicitly requests only one candidate", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await generateImage(settings, "A bear")).toString()).toBe("image");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      n: 1,
      size: "1024x1024",
      prompt: "A bear",
    });
  });
  it("redacts upstream errors rather than exposing keys or response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("secret credential", { status: 401 })),
    );
    try {
      await generateImage(settings, "test");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as Error).message).not.toContain("secret");
    }
  });
  it("requires spec confirmation and adequate requested pixels before spending", () => {
    const book = createBook("test");
    book.pages = [{ ...newPage(), prompt: "bear" }];
    expect(() => validateGeneration(book, settings, [book.pages[0].id], true)).toThrow("规格");
    book.specConfirmed = true;
    expect(() => validateGeneration(book, settings, [book.pages[0].id], false)).toThrow("像素");
    expect(() => validateGeneration(book, settings, [book.pages[0].id], true)).not.toThrow();
  });
});
