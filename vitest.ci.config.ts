import { defineConfig } from "vitest/config";

/** CI-only cases. Kept out of `npm test` so the M1 suite stays the spec's 18 tests. */
export default defineConfig({
  test: {
    include: ["test/ci/**/*.test.ts"],
    testTimeout: 300000,
    hookTimeout: 300000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
