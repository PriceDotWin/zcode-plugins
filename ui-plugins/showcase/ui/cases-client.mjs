import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { mountCatalogue } from "./lab-catalogue.mjs";
import { mountSampling } from "./lab-sampling.mjs";
import { mountStorage } from "./lab-storage.mjs";
import { mountPageTools } from "./lab-page-tools.mjs";

const app = new App(
  { name: "showcase-laboratory", version: "0.4.2" },
  { tools: {} },
  { autoResize: false },
);
const $ = (id) => document.getElementById(id);
const observations = [];
const language = () => (app.getHostContext()?.locale?.toLowerCase().startsWith("en") ? "en" : "zh");
const text = (zh, en) => (language() === "zh" ? zh : en);
const bootId = crypto.randomUUID();
let check = null;
let closed = false;
let count = 0;
let appliedCase = null;
const observe = (event, value) => {
  observations.push({ at: new Date().toISOString(), event, value });
  if (observations.length > 80) observations.shift();
  $("observations").textContent = observations.map((entry) => JSON.stringify(entry)).join("\n");
};
const catalogue = mountCatalogue({ app, language, text, observe });
const sampling = mountSampling({ app, text, observe });
const pageTools = mountPageTools({ app, text, observe });
mountStorage({ observe });
$("boot-id").textContent = bootId;
$("heap-bump").addEventListener("click", () => {
  $("heap-count").textContent = String(++count);
});
for (let i = 1; i <= 30; i++) {
  const line = document.createElement("p");
  line.textContent = `Showcase · ${String(i).padStart(2, "0")} · ${bootId.slice(0, 8)}`;
  $("heap-scroll").append(line);
}
function refresh() {
  const lang = language();
  if (app.getHostVersion())
    $("connection").textContent = text(
      "已连接官方 MCP Apps SDK · 仅一条页面连接",
      "Connected through the official MCP Apps SDK · one page connection",
    );
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en-US";
  document.documentElement.style.colorScheme =
    app.getHostContext()?.theme === "dark" ? "dark" : "light";
  for (const [name, value] of Object.entries(app.getHostContext()?.styles?.variables ?? {})) {
    if (typeof value === "string") document.documentElement.style.setProperty(name, value);
  }
  for (const node of document.querySelectorAll("[data-zh][data-en]"))
    node.textContent = node.dataset[lang];
  $("host-context").textContent = JSON.stringify(
    {
      host: app.getHostVersion(),
      capabilities: app.getHostCapabilities(),
      context: app.getHostContext(),
      bootId,
    },
    null,
    2,
  );
  catalogue.update();
  sampling.update();
}
app.ontoolinput = (input) => {
  observe("tool-input", input);
  if (input.arguments?.caseId && input.arguments.caseId !== appliedCase) {
    appliedCase = input.arguments.caseId;
    catalogue.select(appliedCase);
  }
};
app.ontoolresult = (result) => observe("tool-result", result);
app.ontoolcancelled = (result) => observe("tool-cancelled", result);
app.onhostcontextchanged = (context) => {
  observe("host-context-changed", context);
  refresh();
};
app.onteardown = async () => {
  closed = true;
  check?.abort();
  sampling.close();
  pageTools.close();
  resize.disconnect();
  return {};
};
for (const [id, mode] of [
  ["move-sidebar", "fullscreen"],
  ["move-inline", "inline"],
]) {
  $(id).addEventListener("click", async () => {
    try {
      observe("display-mode", await app.requestDisplayMode({ mode }));
    } catch (error) {
      observe("display-mode/error", { message: error.message });
    }
  });
}
$("check-start").addEventListener("click", async () => {
  if (check || closed) return;
  const controller = new AbortController();
  check = controller;
  $("check-start").disabled = true;
  $("check-cancel").disabled = false;
  $("check-status").dataset.phase = "running";
  $("check-status").textContent = text("真实检查进行中…", "Real check in progress…");
  try {
    const result = await app.callServerTool(
      { name: "cancellable_check", arguments: { durationMs: 10_000 } },
      { signal: controller.signal, timeout: 15_000 },
    );
    controller.signal.throwIfAborted();
    if (closed) return;
    $("check-status").dataset.phase = result.isError ? "error" : "complete";
    $("check-status").textContent = JSON.stringify(result);
    observe("check/result", result);
  } catch (error) {
    $("check-status").dataset.phase = controller.signal.aborted ? "cancelled" : "error";
    $("check-status").textContent =
      `${text("取消或失败", "Cancelled or failed")}: ${error.message ?? error}`;
    observe("check/error", { cancelled: controller.signal.aborted, message: error.message });
  } finally {
    check = null;
    $("check-start").disabled = closed;
    $("check-cancel").disabled = true;
  }
});
$("check-cancel").addEventListener("click", () => check?.abort());
$("export-observations").addEventListener("click", async () => {
  try {
    const result = await app.downloadFile({
      contents: [
        {
          type: "resource",
          resource: {
            uri: "ui://showcase/observations.json",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                version: "0.4.2",
                scope: "Current page observations only; not a complete acceptance report",
                bootId,
                observations,
              },
              null,
              2,
            ),
          },
        },
      ],
    });
    observe("export/result", result);
  } catch (error) {
    observe("export/error", { message: error.message });
  }
});
// 页面主动上报内容高度；不使用视口 scrollHeight 造成高度反馈回环。
const resize = new ResizeObserver(() => {
  if (!closed && app.getHostVersion())
    void app
      .sendSizeChanged({ height: Math.ceil(document.body.getBoundingClientRect().height) })
      .catch(() => {});
});
resize.observe(document.body);
window.showcaseReady = app
  .connect(new PostMessageTransport(window.parent, window.parent))
  .then(() => {
    refresh();
    $("connection").textContent = text(
      "已连接官方 MCP Apps SDK · 仅一条页面连接",
      "Connected through the official MCP Apps SDK · one page connection",
    );
    $("check-start").disabled = !app.getHostCapabilities()?.serverTools;
    $("export-observations").disabled = !app.getHostCapabilities()?.downloadFile;
    observe("connected", { bootId });
  })
  .catch((error) => {
    $("connection").textContent = error.message;
    observe("connection/error", { message: error.message });
    throw error;
  });
