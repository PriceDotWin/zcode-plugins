import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "dist"), { recursive: true });
// resources.mjs 按 import.meta.url 读取页面；合并到 dist/server.mjs 后页面也必须随入口搬迁。
await cp(resolve(root, "ui"), resolve(root, "dist/ui"), { recursive: true });
const client = await build({
  entryPoints: [resolve(root, "ui/cases-client.mjs")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  write: false,
  legalComments: "inline",
});
const page = await readFile(resolve(root, "ui/cases.html"), "utf8");
await writeFile(
  resolve(root, "dist/ui/cases.html"),
  page
    .replace("__SHOWCASE_STYLES__", await readFile(resolve(root, "ui/cases.css"), "utf8"))
    .replace("__SHOWCASE_CLIENT__", () =>
      client.outputFiles[0].text.replaceAll("</script", "<\\/script"),
    ),
);
await build({
  entryPoints: [resolve(root, "server.mjs")],
  outfile: resolve(root, "dist/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "linked",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
