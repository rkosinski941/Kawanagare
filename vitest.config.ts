import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
