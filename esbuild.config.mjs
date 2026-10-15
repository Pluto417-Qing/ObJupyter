import esbuild from "esbuild";

const production = process.argv.includes("production");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  platform: "node",
  format: "cjs",
  target: "es2022",
  sourcemap: production ? false : "inline",
  minify: production,
  external: ["obsidian", "electron"],
  loader: { ".py": "text" },
  logLevel: "info"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
