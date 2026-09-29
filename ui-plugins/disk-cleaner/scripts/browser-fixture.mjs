import { createServer } from "node:http";
import { link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MiB = 1024 * 1024;

/**
 * 真实打包 server + 官方 AppBridge，经隔离 iframe 与页面 App 通信。只扫描自动生成的临时目录，
 * 回收站替换为隔离目录，不触碰用户文件与真实回收站。
 */
export async function startFixture() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temp = await realpath(await mkdtemp(join(tmpdir(), "disk-cleaner-browser-")));
  const target = join(temp, "target");
  const trash = join(temp, "trash");
  await mkdir(join(target, "videos", "raw"), { recursive: true });
  await mkdir(join(target, "downloads"), { recursive: true });
  await mkdir(join(target, "project", ".git"), { recursive: true });
  await writeFile(join(target, "videos", "raw", "clip-4k.mov"), Buffer.alloc(6 * MiB));
  await writeFile(join(target, "videos", "trip.mp4"), Buffer.alloc(4 * MiB));
  await writeFile(join(target, "downloads", "installer.dmg"), Buffer.alloc(3 * MiB));
  await writeFile(join(target, "downloads", "backup.zip"), Buffer.alloc(2 * MiB));
  await writeFile(join(target, "project", ".git", "pack.bin"), Buffer.alloc(5 * MiB));
  await writeFile(join(target, "shared.iso"), Buffer.alloc(2 * MiB));
  await link(join(target, "shared.iso"), join(temp, "shared-copy.iso"));
  await writeFile(join(target, "notes.txt"), "small");

  const client = new Client({ name: "disk-cleaner-browser", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist/server.mjs")],
    cwd: temp,
    env: { ...process.env, ZCODE_DISK_CLEANER_TEST_TRASH: trash },
    stderr: "pipe",
  });
  await client.connect(transport);
  const html = await readFile(join(root, "dist/ui/panel.html"), "utf8");
  const host = await build({
    stdin: {
      contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
const rpc = async (method, args) => {
  const response = await fetch('/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method,args})});
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
};
const params = new URLSearchParams(location.search);
let context = { theme: params.get('theme') === 'dark' ? 'dark' : 'light', locale: params.get('locale') || 'zh-CN', displayMode: 'fullscreen' };
const bridge = new AppBridge(null, {name:'disk-cleaner-browser',version:'1'}, {serverTools:{},serverResources:{}}, {hostContext:context});
window.__heights = [];
window.__initializations = 0;
bridge.oncalltool = (args) => rpc('callTool', args);
bridge.onreadresource = (args) => rpc('readResource', args);
bridge.onsizechange = ({height}) => window.__heights.push(height);
bridge.oninitialized = async () => {
  window.__initializations++;
  await bridge.sendToolResult(await rpc('callTool', {name:'get_status',arguments:{}}));
};
window.__setGlobals = (patch) => { context = {...context, ...patch}; bridge.setHostContext(context); };
window.__sendToolResult = (result) => bridge.sendToolResult(result);
const frame = document.querySelector('iframe');
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.src = '/panel';
`,
      resolveDir: root,
      sourcefile: "browser-host.mjs",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          '<style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe></iframe><script type="module" src="/host.js"></script>',
        );
      } else if (url.pathname === "/host.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(host.outputFiles[0].text);
      } else if (url.pathname === "/panel") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(html);
      } else if (request.method === "POST" && url.pathname === "/rpc") {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > MiB) throw new Error("Request too large");
        }
        const { method, args } = JSON.parse(body);
        const result =
          method === "readResource"
            ? await client.readResource(args)
            : method === "callTool"
              ? await client.callTool(args)
              : null;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result));
      } else if (url.pathname === "/favicon.ico") response.writeHead(204).end();
      else response.writeHead(404).end();
    } catch (error) {
      response
        .writeHead(500, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    client,
    target,
    trash,
    async close() {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await client.close();
      await rm(temp, { force: true, recursive: true });
    },
  };
}

if (process.argv.includes("--serve")) {
  const fixture = await startFixture();
  console.log(`${fixture.url}  (target: ${fixture.target})`);
  const stop = async () => {
    await fixture.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
