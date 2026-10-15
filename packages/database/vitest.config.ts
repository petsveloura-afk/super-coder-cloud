import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DB tests share one throwaway database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
