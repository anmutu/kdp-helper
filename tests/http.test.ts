import { describe, expect, it } from "vitest";
import { readJson } from "../src/server/http";

describe("bounded JSON request bodies", () => {
  it("stops reading a chunked body after the 5 MiB limit", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 10) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://127.0.0.1:3210/api/test", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: string });

    await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
    expect(pulls).toBeLessThan(10);
    expect(cancelled).toBe(true);
  });
});
