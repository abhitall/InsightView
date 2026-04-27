// Builds the browser IIFE bundle that the test-site loads via <script>.
// Tree-shakes web-vitals, keeps the footprint tiny.
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await esbuild.build({
  entryPoints: ["src/iife-entry.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "InsightViewRUM",
  target: ["es2020"],
  outfile: "dist/insightview-rum.iife.js",
  sourcemap: true,
});

console.log("Built dist/insightview-rum.iife.js");
