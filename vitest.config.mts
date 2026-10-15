import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    name: "python-source-as-text",
    enforce: "pre",
    transform(source, id) {
      if (id.endsWith(".py")) return { code: `export default ${JSON.stringify(source)};`, map: null };
      return null;
    }
  }],
  test: { environment: "node" }
});
