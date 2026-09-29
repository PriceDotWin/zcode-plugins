import { h, type ComputedRef, type Ref, type VNodeChild } from "vue";
import { EDITOR_TOOLS, type Editor, type EditorState, type Tool } from "@open-pencil/core/editor";
import type { SceneNode } from "@open-pencil/scene-graph";
import type { Messages } from "#ui/i18n.ts";
import type { DocumentController } from "#ui/document.ts";
import { CanvasView } from "#ui/app/canvas-view.ts";
import type { MenuItem } from "#ui/app/context.ts";

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}
export interface DialogState {
  title: string;
  value: string;
  submit: (value: string) => void;
}
/** 壳的视图输入：状态引用 + 动作，纯渲染，不持有状态。 */
export interface PanelView {
  editor: Editor;
  state: EditorState;
  t: Ref<Messages>;
  theme: Ref<string>;
  documents: DocumentController;
  bridgeConnected: Ref<boolean>;
  files: Ref<Array<{ path: string; id?: string }>>;
  menu: Ref<MenuState | null>;
  dialog: Ref<DialogState | null>;
  notice: Ref<string | null>;
  rightTab: Ref<"layers" | "properties">;
  layers: ComputedRef<Array<{ node: SceneNode; depth: number }>>;
  pages: ComputedRef<Array<{ id: string; name: string }>>;
  selectedIds: ComputedRef<string[]>;
  selectedNode: ComputedRef<SceneNode | undefined>;
  actions: {
    openPath: (path: string) => void;
    refreshFiles: () => void;
    newDesign: () => void;
    runMenuItem: (item: MenuItem) => void;
    importImage: (event: Event) => void;
    updateSelected: (changes: Record<string, unknown>) => void;
    openContextMenu: (event: MouseEvent) => void;
    canvasReady: () => void;
  };
}
const HIDDEN_TOOLS = new Set(["SECTION", "POLYGON", "STAR", "PEN"]);
const button = (label: string, onClick: () => void, extra: Record<string, unknown> = {}) =>
  h("button", { class: "op-btn", type: "button", onClick, ...extra }, label);

function renderToolbar(v: PanelView) {
  const { editor, state, t } = v;
  return h("header", { class: "op-toolbar" }, [
    ...EDITOR_TOOLS.filter((tool) => !HIDDEN_TOOLS.has(tool.key)).map((tool) =>
      button(tool.label, () => editor.setTool(tool.key as Tool), {
        class: ["op-btn", "op-tool", state.activeTool === tool.key ? "is-active" : ""],
        title: `${tool.label} (${tool.shortcut})`,
        "data-testid": `op-tool-${tool.key.toLowerCase()}`,
      }),
    ),
    h("span", { class: "op-spacer" }),
    button("↶", () => editor.undoAction(), { title: t.value.undo }),
    button("↷", () => editor.redoAction(), { title: t.value.redo }),
    button("⤢", () => editor.zoomToFit(), { title: t.value.zoomFit }),
    h("label", { class: "op-btn op-file", title: t.value.importImage }, [
      "🖼",
      h("input", {
        type: "file",
        accept: "image/*",
        multiple: true,
        onChange: v.actions.importImage,
        style: "display:none",
      }),
    ]),
    v.pages.value.length > 1
      ? h(
          "select",
          {
            class: "op-select",
            value: state.currentPageId,
            onChange: (e: Event) => void editor.switchPage((e.target as HTMLSelectElement).value),
          },
          v.pages.value.map((p) =>
            h("option", { value: p.id, selected: p.id === state.currentPageId }, p.name),
          ),
        )
      : null,
  ]);
}
function renderLayers(v: PanelView) {
  return h(
    "ul",
    { class: "op-layers", "data-testid": "op-layers" },
    v.layers.value.map(({ node, depth }) =>
      h(
        "li",
        {
          class: ["op-layer", v.selectedIds.value.includes(node.id) ? "is-selected" : ""],
          style: { paddingLeft: `${8 + depth * 12}px` },
          "data-node-id": node.id,
          onClick: (e: MouseEvent) => v.editor.select([node.id], e.shiftKey),
        },
        [
          h("span", { class: "op-layer-type" }, node.type.slice(0, 1)),
          h("span", { class: "op-layer-name" }, node.name),
        ],
      ),
    ),
  );
}
function renderProperties(v: PanelView) {
  const { t } = v;
  const node = v.selectedNode.value;
  if (!node) {
    const count = v.selectedIds.value.length;
    return h(
      "div",
      { class: "op-empty" },
      count > 1 ? t.value.selected(count) : t.value.noSelection,
    );
  }
  const numberField = (label: string, key: "x" | "y" | "width" | "height" | "opacity", scale = 1) =>
    h("label", { class: "op-field" }, [
      h("span", label),
      h("input", {
        type: "number",
        value: Math.round((node[key] as number) * scale * 100) / 100,
        onChange: (e: Event) =>
          v.actions.updateSelected({ [key]: Number((e.target as HTMLInputElement).value) / scale }),
      }),
    ]);
  return h("div", { class: "op-props", "data-testid": "op-properties" }, [
    h("label", { class: "op-field op-field-wide" }, [
      h("span", t.value.name),
      h("input", {
        type: "text",
        value: node.name,
        onChange: (e: Event) => v.editor.renameNode(node.id, (e.target as HTMLInputElement).value),
      }),
    ]),
    h("div", { class: "op-grid" }, [
      numberField("X", "x"),
      numberField("Y", "y"),
      numberField("W", "width"),
      numberField("H", "height"),
    ]),
    numberField(t.value.opacity, "opacity", 100),
    h("div", { class: "op-meta" }, `${node.type} · ${node.id}`),
  ]);
}
function renderRight(v: PanelView) {
  const { t, rightTab } = v;
  const tab = (id: "layers" | "properties", label: string) =>
    button(label, () => (rightTab.value = id), {
      class: ["op-btn", "op-tab", rightTab.value === id ? "is-active" : ""],
    });
  return h("aside", { class: "op-right" }, [
    h("div", { class: "op-tabs" }, [
      tab("layers", t.value.layers),
      tab("properties", t.value.properties),
    ]),
    rightTab.value === "layers" ? renderLayers(v) : renderProperties(v),
  ]);
}
function renderStatus(v: PanelView) {
  const { t, documents } = v;
  const doc = documents.current.value;
  const labels: Record<string, string> = {
    idle: "",
    dirty: t.value.unsaved,
    saving: t.value.saving,
    saved: t.value.saved,
    error: `${t.value.saveFailed}: ${documents.error.value ?? ""}`,
    conflict: t.value.conflict,
    readonly: t.value.readOnly,
  };
  const online = v.bridgeConnected.value;
  return h("footer", { class: "op-status" }, [
    h(
      "span",
      { class: "op-doc", "data-testid": "op-document-path", title: doc?.path ?? "" },
      doc?.path ?? t.value.noDocument,
    ),
    h(
      "span",
      { class: ["op-save", `is-${documents.status.value}`], "data-testid": "op-save-status" },
      labels[documents.status.value],
    ),
    h("span", { class: "op-spacer" }),
    h(
      "span",
      {
        class: ["op-bridge", online ? "is-on" : ""],
        "data-testid": "op-bridge-status",
        title: online ? t.value.bridgeOnline : t.value.bridgeOffline,
      },
      "●",
    ),
  ]);
}
function renderConflict(v: PanelView) {
  const { t, documents } = v;
  if (documents.status.value !== "conflict") return null;
  return h("div", { class: "op-banner", "data-testid": "op-conflict-banner" }, [
    h("span", t.value.conflict),
    button(t.value.keepMine, () => void documents.resolveConflict("keep-mine"), {
      "data-testid": "op-conflict-keep",
    }),
    button(t.value.reload, () => void documents.resolveConflict("reload"), {
      "data-testid": "op-conflict-reload",
    }),
  ]);
}
function renderEmpty(v: PanelView) {
  const { t } = v;
  if (v.documents.current.value) return null;
  return h("div", { class: "op-overlay", "data-testid": "op-empty-state" }, [
    h("h2", t.value.noDocument),
    h("p", t.value.openHint),
    h(
      "ul",
      { class: "op-files" },
      v.files.value.map((file) =>
        h(
          "li",
          {},
          button(file.path, () => v.actions.openPath(file.path), {
            class: "op-btn op-link",
            "data-path": file.path,
          }),
        ),
      ),
    ),
    h("div", { class: "op-row" }, [
      button(t.value.refresh, v.actions.refreshFiles),
      button(t.value.newDesign, v.actions.newDesign, { "data-testid": "op-new-design" }),
    ]),
  ]);
}
function renderMenu(v: PanelView) {
  const menu = v.menu.value;
  if (!menu) return null;
  return h(
    "div",
    {
      class: "op-menu-backdrop",
      "data-testid": "op-menu-backdrop",
      onClick: () => (v.menu.value = null),
      onContextmenu: (e: Event) => e.preventDefault(),
    },
    [
      h(
        "ul",
        {
          class: "op-menu",
          style: { left: `${menu.x}px`, top: `${menu.y}px` },
          "data-testid": "op-context-menu",
        },
        menu.items.map((item) =>
          item.separator
            ? h("li", { class: "op-menu-sep" })
            : h(
                "li",
                {
                  class: ["op-menu-item", item.disabled ? "is-disabled" : ""],
                  "data-testid": item.testId,
                  onClick: () => v.actions.runMenuItem(item),
                },
                item.label,
              ),
        ),
      ),
    ],
  );
}
function renderDialog(v: PanelView) {
  const dialog = v.dialog.value;
  if (!dialog) return null;
  return h("div", { class: "op-menu-backdrop" }, [
    h("div", { class: "op-dialog", "data-testid": "op-dialog" }, [
      h("h3", dialog.title),
      h("textarea", {
        value: dialog.value,
        rows: 3,
        autofocus: true,
        "data-testid": "op-dialog-input",
        onInput: (e: Event) => (dialog.value = (e.target as HTMLTextAreaElement).value),
        onKeydown: (e: KeyboardEvent) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) dialog.submit(dialog.value);
          if (e.key === "Escape") v.dialog.value = null;
        },
      }),
      h("div", { class: "op-row" }, [
        button("OK", () => dialog.submit(dialog.value), { "data-testid": "op-dialog-submit" }),
        button("✕", () => (v.dialog.value = null)),
      ]),
    ]),
  ]);
}
export function renderPanel(v: PanelView): VNodeChild {
  return h("div", { class: "op-shell", "data-theme": v.theme.value }, [
    renderToolbar(v),
    h("div", { class: "op-body" }, [
      h("main", { class: "op-canvas-wrap" }, [
        h(CanvasView, {
          editor: v.editor,
          onContextMenu: v.actions.openContextMenu,
          onReady: v.actions.canvasReady,
        }),
        renderMenu(v),
        renderEmpty(v),
      ]),
      renderRight(v),
    ]),
    renderConflict(v),
    v.notice.value
      ? h("div", { class: "op-notice", "data-testid": "op-notice" }, v.notice.value)
      : null,
    renderDialog(v),
    renderStatus(v),
  ]);
}
