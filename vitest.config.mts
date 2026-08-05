import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const engineDir = fileURLToPath(new URL("./engine", import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the `@engine/*` path alias in tsconfig.json.
    alias: [{ find: /^@engine\//, replacement: `${engineDir}/` }],
  },
  test: {
    environment: "node",
    // Only the engine and its tooling are tested here. The Next.js site in app/, components/ and
    // lib/ is verified by `npm run build` and must never be pulled into a Vitest run.
    include: ["engine/**/*.test.ts", "tools/**/*.test.ts"],
  },
});
