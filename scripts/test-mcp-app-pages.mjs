// Browser protocol regression: real plugin artifacts and official App/AppBridge.
// This fixture does not claim to exercise the desktop sandbox security policy.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = await build({
  stdin: {
    contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { z } from "zod";
const rpc = async (method, args) => {
  const response = await fetch('/rpc', { method: 'POST', body: JSON.stringify({ method, args }) });
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
};
const bridge = new AppBridge(null, { name: 'page-test', version: '1' }, {
  serverTools: {}, serverResources: {}, updateModelContext: {}, message: {},
  experimental: { 'zcode/widgetState': {} },
}, { hostContext: { theme: 'dark', locale: 'en-US', displayMode: 'fullscreen', 'zcode/widgetState': { restored: true } } });
window.initializations = 0;
bridge.onreadresource = (args) => rpc('readResource', args);
bridge.oncalltool = (args) => rpc('callTool', args);
bridge.onupdatemodelcontext = async () => ({});
bridge.onmessage = async () => ({});
bridge.onsizechange = () => {};
bridge.setRequestHandler('ui/set-widget-state', { params: z.object({ widgetState: z.unknown() }), result: EmptyResultSchema }, async (params) => { window.savedState = params.widgetState; return {}; });
bridge.oninitialized = async () => {
  window.initializations++;
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult(await rpc('initial', {}));
};
const frame = document.querySelector('iframe');
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
window.bridge = bridge;
frame.src = '/panel';
`,
    resolveDir: root,
    sourcefile: "host-test.mjs",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
);
try {
  for (const short of ["blender", "excalidraw", "openpencil"]) {
    const temporary = await mkdtemp(join(tmpdir(), "mcp-app-page-"));
    const plugin = join(root, "plugins", short);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(plugin, "dist/server.mjs")],
      cwd: temporary,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: temporary,
        ZCODE_WORKSPACE_ROOT: temporary,
        ZCODE_PLUGIN_DATA: join(temporary, "data"),
        ZCODE_BLENDER_FAKE_ENGINE: "1",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "page-test", version: "1" });
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    let server;
    try {
      console.log(`Starting browser protocol check: ${short}`);
      page.on("pageerror", (error) => console.error(`Browser error (${short}): ${error.message}`));
      await client.connect(transport);
      const create = {
        blender: { name: "new_scene", arguments: { path: "page.blend" } },
        excalidraw: {
          name: "create_diagram",
          arguments: { id: "page", title: "Page", elements: [] },
        },
        openpencil: { name: "new_design", arguments: { path: "page.fig" } },
      }[short];
      const initial = await client.callTool(create);
      assert.ok(!initial.isError, JSON.stringify(initial));
      const panel = await client.readResource({ uri: `ui://${short}/panel.html` });
      server = createServer(async (request, response) => {
        try {
          if (request.url === "/") {
            response.setHeader("Content-Type", "text/html");
            response.end(
              '<iframe style="border:0;width:100%;height:780px"></iframe><script type="module" src="/host.js"></script>',
            );
          } else if (request.url === "/host.js") {
            response.setHeader("Content-Type", "text/javascript");
            response.end(host.outputFiles[0].text);
          } else if (request.url === "/panel") {
            response.setHeader("Content-Type", "text/html");
            response.end(panel.contents[0].text);
          } else if (request.url === "/rpc" && request.method === "POST") {
            let body = "";
            for await (const chunk of request) body += chunk;
            const { method, args } = JSON.parse(body);
            const result =
              method === "initial"
                ? initial
                : method === "readResource"
                  ? await client.readResource(args)
                  : method === "callTool"
                    ? await client.callTool(args)
                    : null;
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(result));
          } else response.writeHead(404).end();
        } catch (error) {
          response
            .writeHead(500, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: error.message }));
        }
      });
      await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
      await page.goto(`http://127.0.0.1:${server.address().port}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForFunction(() => window.initializations === 1, null, { timeout: 15000 });
      const frame = page.frames().find((item) => item !== page.mainFrame());
      await frame.waitForFunction((name) => Boolean(window[`__${name}Panel`]), short, {
        timeout: 30000,
      });
      assert.deepEqual(
        await frame.evaluate(() => window.__pluginClient.toolOutput),
        initial.structuredContent,
      );
      assert.equal(await frame.evaluate(() => window.__pluginClient.theme), "dark");
      await frame.evaluate(() =>
        window.__pluginClient.setWidgetState({ restored: false, edited: true }),
      );
      assert.deepEqual(await page.evaluate(() => window.savedState), {
        restored: false,
        edited: true,
      });
      await page.evaluate(() => window.bridge.sendToolCancelled({ reason: "stopped" }));
      await frame.waitForFunction(() => window.__pluginClient.toolCancelled?.reason === "stopped");
      assert.equal(await page.evaluate(() => window.initializations), 1);
      console.log(
        `PASS official App/AppBridge ${short}: one connection, initial result, theme, widget state, cancellation`,
      );
    } catch (error) {
      console.error(`Failed ${short}: ${error.stack}`);
      throw error;
    } finally {
      await page.close();
      if (server) {
        server.closeAllConnections();
        await new Promise((accept) => server.close(accept));
      }
      await client.close();
      await rm(temporary, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
