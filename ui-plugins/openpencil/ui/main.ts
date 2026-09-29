import { createApp, shallowReactive } from "vue";
import { createDefaultEditorState, createEditor } from "@open-pencil/core/editor";
import { SceneGraph } from "@open-pencil/scene-graph";
import { installFetchShim, installWorkerShim } from "#ui/assets.ts";
import { configureFonts, loadFont } from "#ui/fonts.ts";
import { EDITOR_KEY } from "@open-pencil/vue";
import { PanelApp } from "#ui/app/panel.ts";

/** 面板入口：先装静态资源拦截与字体策略，再建 editor（状态与上游 app 一样用 shallowReactive 让 SDK 组合式 API 可响应）。 */
async function boot() {
  installFetchShim();
  await installWorkerShim();
  configureFonts();
  const graph = new SceneGraph();
  const state = shallowReactive({
    ...createDefaultEditorState(graph.getPages()[0].id),
    showRulers: false,
    numberFieldFocused: false,
    clipboardHTML: "",
    cursorCanvasX: null as number | null,
    cursorCanvasY: null as number | null,
    renameSelectionOpen: false,
    renameNodeId: null as string | null,
  });
  const editor = createEditor({
    graph,
    state,
    loadFont,
    getViewportSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
  });
  const app = createApp(PanelApp, { editor, state });
  // 根组件自己 provide 的值它的 setup 里 inject 不到（Vue 只查父级 provides），SDK 的
  // useMenuModel / useSelectionState 在根组件里就要用 editor，所以在 app 级注入。
  app.provide(EDITOR_KEY, editor);
  app.mount("#root");
}
void boot().catch((error) => {
  const root = document.getElementById("root");
  if (root)
    root.textContent = `设计稿编辑器启动失败 / Failed to start: ${error instanceof Error ? error.message : String(error)}`;
});
