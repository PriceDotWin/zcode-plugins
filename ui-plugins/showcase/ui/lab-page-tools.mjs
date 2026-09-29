export function mountPageTools({ app, text, observe }) {
  const status = document.getElementById("page-tool-status");
  const finish = document.getElementById("page-tool-finish");
  let pending = null;
  let closed = false;
  app.onlisttools = async () => ({
    tools: [
      {
        name: "page_edit",
        description:
          "Edit the visible Showcase lab note. With delayed=true, wait for the user to click Complete in the page; stopping the model turn cancels without changing the note. Only affects the demo page.",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", minLength: 1, maxLength: 160 },
            delayed: { type: "boolean" },
          },
          required: ["key"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
      },
    ],
  });
  app.oncalltool = async (params, extra) => {
    const args = params.arguments ?? {};
    if (
      closed ||
      params.name !== "page_edit" ||
      typeof args.key !== "string" ||
      !args.key.trim() ||
      args.key.length > 160 ||
      (args.delayed !== undefined && typeof args.delayed !== "boolean") ||
      Object.keys(args).some((key) => !["key", "delayed"].includes(key))
    ) {
      return {
        isError: true,
        content: [{ type: "text", text: "Invalid or unavailable Showcase page tool" }],
      };
    }
    if (pending)
      return {
        isError: true,
        content: [{ type: "text", text: "Another page edit is awaiting completion" }],
      };
    const signal = extra.mcpReq?.signal;
    signal?.throwIfAborted();
    status.dataset.phase = "running";
    status.textContent = text(
      "模型已调用页面工具；等待页面完成。",
      "The model called the page tool; waiting for page completion.",
    );
    observe("page-tool/start", { key: args.key, delayed: Boolean(args.delayed) });
    try {
      if (args.delayed)
        await new Promise((resolve, reject) => {
          const abort = () => reject(new Error("Page edit cancelled"));
          pending = { resolve, reject: abort };
          signal?.addEventListener("abort", abort, { once: true });
          pending.cleanup = () => signal?.removeEventListener("abort", abort);
          finish.disabled = false;
        });
      // 先确认调用仍有效再写页面便签，停止回合不能留下迟到写入。
      signal?.throwIfAborted();
      if (closed) throw new Error("Page closed");
      document.getElementById("page-note").textContent = args.key;
      status.dataset.phase = "complete";
      status.textContent = text("便签已由模型工具更新。", "The model tool updated the note.");
      observe("page-tool/complete", { key: args.key });
      return {
        content: [{ type: "text", text: `Showcase note: ${args.key}` }],
        structuredContent: { key: args.key },
      };
    } catch (error) {
      status.dataset.phase = "cancelled";
      status.textContent = text(
        "页面工具已取消，便签未改变。",
        "Page tool cancelled; the note was not changed.",
      );
      observe("page-tool/cancelled", { message: error.message });
      throw error;
    } finally {
      pending?.cleanup();
      pending = null;
      finish.disabled = true;
    }
  };
  finish.addEventListener("click", () => pending?.resolve());
  return {
    close() {
      closed = true;
      pending?.reject();
    },
  };
}
