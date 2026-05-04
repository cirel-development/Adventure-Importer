import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-adventure/bundle-schema": path.resolve(
        __dirname,
        "../../packages/bundle-schema/src/index.ts"
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
