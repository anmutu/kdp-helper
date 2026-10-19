import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  // 多个套件做真实 PDF/ZIP/字体嵌入等重 IO 测试，CI 免费跑机器性能波动大，
  // 显式给足全局超时（各用例仍可用更短的超时覆盖）。
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
