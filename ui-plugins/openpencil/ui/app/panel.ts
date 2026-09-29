import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from "vue";
import type { Editor, EditorState } from "@open-pencil/core/editor";
import { useMenuModel, type MenuEntry } from "@open-pencil/vue";
import { call, host, onHostGlobals } from "#ui/host.ts";
import { messagesFor, type Messages } from "#ui/i18n.ts";
import { createDocumentController } from "#ui/document.ts";
import { connectBridge, type Bridge } from "#ui/bridge.ts";
import { selectionContext, type MenuItem } from "#ui/app/context.ts";
import { renderPanel, type DialogState, type MenuState, type PanelView } from "#ui/app/views.ts";
import type { BridgeEndpoint, DesignRef } from "#openpencil/contract.ts";

/** 壳的根组件：持有面板状态与动作，渲染交给 views.ts。 */
export const PanelApp = defineComponent({
  name: "OpenPencilPanel",
  props: { editor: { type: Object, required: true }, state: { type: Object, required: true } },
  setup(props) {
    const editor = props.editor as Editor;
    const state = props.state as EditorState;
    const t = ref<Messages>(messagesFor(host().locale ?? undefined));
    const theme = ref(host().theme === "dark" ? "dark" : "light");
    const documents = createDocumentController(editor, state);
    const bridgeConnected = ref(false);
    let bridge: Bridge | null = null;
    const files = ref<Array<{ path: string; id?: string }>>([]);
    const menu = ref<MenuState | null>(null);
    const dialog = ref<DialogState | null>(null);
    const notice = ref<string | null>(null);
    const rightTab = ref<"layers" | "properties">("layers");
    const canvasReady = ref(false);
    const menuModel = useMenuModel();

    const layers = computed(() => {
      void state.sceneVersion;
      return editor.getLayerTree();
    });
    const pages = computed(() => {
      void state.sceneVersion;
      return editor.graph.getPages().map((p) => ({ id: p.id, name: p.name }));
    });
    const selectedIds = computed(() => {
      void state.sceneVersion;
      void state.renderVersion;
      return [...state.selectedIds];
    });
    const selectedNode = computed(() =>
      selectedIds.value.length === 1 ? editor.graph.getNode(selectedIds.value[0]) : undefined,
    );

    async function refreshFiles() {
      const result = await call<{ documents: Array<{ path: string; id?: string }> }>(
        "list_designs",
      ).catch(() => ({
        documents: [],
      }));
      files.value = result.documents;
    }
    async function openPath(path: string) {
      const result = await call<{ document: DesignRef }>("open_design", { path });
      await documents.load(result.document);
    }
    async function createDesign(path: string) {
      const result = await call<{ document: DesignRef }>("new_design", { path });
      await documents.load(result.document);
      await refreshFiles();
    }
    function showNotice(text: string) {
      notice.value = text;
      setTimeout(() => {
        if (notice.value === text) notice.value = null;
      }, 2500);
    }
    async function addToContext() {
      const doc = documents.current.value;
      if (!doc) return;
      const { text, structuredContent } = selectionContext(editor, state, doc, bridge);
      await host().updateModelContext({ content: [{ type: "text", text }], structuredContent });
      showNotice(t.value.contextAdded);
    }
    function askZcode() {
      const doc = documents.current.value;
      if (!doc) return;
      dialog.value = {
        title: t.value.askZcodePrompt,
        value: "",
        submit: (value) => {
          dialog.value = null;
          const { text, structuredContent } = selectionContext(editor, state, doc, bridge);
          void host().sendFollowUpMessage({
            prompt: `${value.trim()}\n\n${text}\n\nEdit the selected nodes in place with the design tools (document_id ${doc.id}); call get_selection or get_node first if you need more detail, and keep everything else unchanged.`,
            structuredContent,
          });
        },
      };
    }
    function codegen() {
      const doc = documents.current.value;
      if (!doc) return;
      const { text, structuredContent } = selectionContext(editor, state, doc, bridge);
      void host().sendFollowUpMessage({
        prompt: `Generate production code for the selected design nodes.\n\n${text}\n\nUse get_node / node_tree for structure, list_variables for design tokens, export_design with format "jsx" as a starting point, and export_design png to visually verify. Match this project's stack and write the files into the workspace.`,
        structuredContent,
      });
    }
    function openContextMenu(event: MouseEvent) {
      const hasSelection = state.selectedIds.size > 0;
      const upstream: MenuItem[] = menuModel.canvasMenu.value.map((entry: MenuEntry) =>
        "separator" in entry && entry.separator
          ? { label: "", separator: true }
          : {
              label: (entry as { label: string }).label,
              action: (entry as { action?: () => void }).action,
              disabled: (entry as { disabled?: boolean }).disabled,
            },
      );
      const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
      menu.value = {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
        items: [
          {
            label: t.value.addToContext,
            action: () => void addToContext(),
            disabled: !hasSelection,
            testId: "op-menu-add-context",
          },
          {
            label: t.value.askZcode,
            action: askZcode,
            disabled: !hasSelection,
            testId: "op-menu-ask-zcode",
          },
          {
            label: t.value.codegen,
            action: codegen,
            disabled: !hasSelection,
            testId: "op-menu-codegen",
          },
          { label: "", separator: true },
          ...upstream,
        ],
      };
    }
    function runMenuItem(item: MenuItem) {
      menu.value = null;
      if (!item.disabled) item.action?.();
    }
    async function importImage(event: Event) {
      const input = event.target as HTMLInputElement;
      const picked = [...(input.files ?? [])];
      input.value = "";
      if (picked.length === 0) return;
      const cx = (-state.panX + window.innerWidth / 2) / state.zoom;
      const cy = (-state.panY + window.innerHeight / 2) / state.zoom;
      await editor.placeImageFiles(picked, cx, cy);
    }
    function updateSelected(changes: Record<string, unknown>) {
      const node = selectedNode.value;
      if (node) editor.updateNodeWithUndo(node.id, changes);
    }
    function newDesign() {
      dialog.value = {
        title: t.value.newDesignPrompt,
        value: "designs/untitled.fig",
        submit: (value) => {
          dialog.value = null;
          void createDesign(value.trim());
        },
      };
    }

    onMounted(async () => {
      const stop = onHostGlobals(() => {
        t.value = messagesFor(host().locale ?? undefined);
        theme.value = host().theme === "dark" ? "dark" : "light";
        // 面板已开时 Agent 又调了 open_design / new_design：结果经 surface 投喂到 toolOutput。
        const output = host().toolOutput as { document?: DesignRef } | undefined;
        if (output?.document?.id && output.document.id !== documents.current.value?.id)
          void documents.load(output.document).catch(() => undefined);
      });
      onBeforeUnmount(stop);
      const status = await call<{
        document: DesignRef | null;
        bridge: BridgeEndpoint;
        live: boolean;
      }>("get_design_status");
      const output = host().toolOutput as { document?: DesignRef } | undefined;
      const initial = output?.document ?? status.document;
      // 先载入初始文档再注册桥；否则首个编辑命令会在桥在线、current 仍为空时进入并失败。
      if (initial) await documents.load(initial).catch((e) => (documents.error.value = String(e)));
      bridge = connectBridge({
        editor,
        state,
        documents,
        endpoint: status.bridge,
        onConnection: (connected) => {
          bridgeConnected.value = connected;
        },
      });
      await refreshFiles();
      window.__openpencilPanel = {
        editor,
        state,
        documents,
        get bridgeConnected() {
          return bridgeConnected.value;
        },
        get canvasReady() {
          return canvasReady.value;
        },
        openPath,
        addToContext,
        askZcode,
        codegen,
        flush: () => documents.save(),
      };
    });
    onBeforeUnmount(() => {
      documents.flush();
      bridge?.disconnect();
      const doc = documents.current.value;
      if (doc)
        void call("report_panel_state", {
          documentId: doc.id,
          live: false,
          dirty: documents.isDirty(),
        }).catch(() => undefined);
    });

    const view: PanelView = {
      editor,
      state,
      t,
      theme,
      documents,
      bridgeConnected,
      files,
      menu,
      dialog,
      notice,
      rightTab,
      layers,
      pages,
      selectedIds,
      selectedNode,
      actions: {
        openPath: (path) => void openPath(path),
        refreshFiles: () => void refreshFiles(),
        newDesign,
        runMenuItem,
        importImage: (event) => void importImage(event),
        updateSelected,
        openContextMenu,
        canvasReady: () => {
          canvasReady.value = true;
        },
      },
    };
    return () => renderPanel(view);
  },
});
