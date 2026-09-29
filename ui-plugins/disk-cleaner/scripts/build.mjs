import { build } from "esbuild";
import { writeNotices } from "./licenses.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "ui"), { recursive: true });

const ui = await build({
  metafile: true,
  entryPoints: [join(root, "ui/main.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  outdir: join(dist, "ui"),
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = ui.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = ui.outputFiles.find((file) => file.path.endsWith(".css")).text;
// 面板体积小，内联成单个 HTML 资源；转义结束标签，避免提前闭合 <script>/<style>。
const escape = (text, tag) => text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
const template = await readFile(join(root, "ui/panel.html"), "utf8");
const html = template
  .replace("/*__PANEL_CSS__*/", () => escape(css, "style"))
  .replace("/*__PANEL_JS__*/", () => escape(js, "script"));
await writeFile(join(dist, "ui/panel.html"), html);

const server = await build({
  metafile: true,
  entryPoints: [join(root, "src/adapters/main.ts")],
  outfile: join(dist, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
process.stdout.write(`Disk cleaner panel: ${Math.round(Buffer.byteLength(html) / 1024)} KiB\n`);

await writeNotices([ui.metafile, server.metafile], join(dist, "THIRD_PARTY_NOTICES.txt"));
