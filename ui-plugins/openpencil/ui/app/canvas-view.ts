import { defineComponent, h, onBeforeUnmount, ref, watch } from "vue";
import type { Editor } from "@open-pencil/core/editor";
import { useCanvas, useCanvasDrop, useCanvasInput, useTextEdit } from "@open-pencil/vue";

/**
 * 画布组件：canvas 元素与 useCanvas 放在同一个组件里。
 * 不用 SDK 的 CanvasRoot + CanvasSurface 组合——CanvasSurface 经 templateRef 在自己 mounted 后才把 canvas 交给
 * CanvasRoot，而 CanvasRoot 的 kit-loader 在 onMounted 里发现 canvasRef 为空就直接返回，CanvasKit 永远不初始化。
 */
export const CanvasView = defineComponent({
  name: "CanvasView",
  props: {
    editor: { type: Object, required: true },
    onContextMenu: { type: Function, required: true },
    onReady: { type: Function, required: false },
  },
  setup(props) {
    const editor = props.editor as Editor;
    const canvasRef = ref<HTMLCanvasElement | null>(null);
    const { hitTestSectionTitle, hitTestComponentLabel, hitTestFrameTitle } = useCanvas(
      canvasRef,
      editor,
      {
        showRulers: false,
        onReady: () => (props.onReady as (() => void) | undefined)?.(),
      },
    );
    useCanvasInput(
      canvasRef,
      editor,
      hitTestSectionTitle,
      hitTestComponentLabel,
      hitTestFrameTitle,
    );
    useTextEdit(canvasRef, editor);
    useCanvasDrop(canvasRef, editor);
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      (props.onContextMenu as (e: MouseEvent) => void)(event);
    };
    watch(
      canvasRef,
      (canvas, previous) => {
        previous?.removeEventListener("contextmenu", onContext);
        canvas?.addEventListener("contextmenu", onContext);
      },
      { immediate: true },
    );
    onBeforeUnmount(() => canvasRef.value?.removeEventListener("contextmenu", onContext));
    return () =>
      h("canvas", { ref: canvasRef, class: "op-canvas", "data-testid": "op-canvas", tabindex: 0 });
  },
});
