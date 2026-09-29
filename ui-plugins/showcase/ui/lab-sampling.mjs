const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=";
export function mountSampling({ app, text, observe }) {
  const $ = (id) => document.getElementById(id);
  const history = [];
  let active = null;
  let closed = false;
  function update() {
    const supported = Boolean(app.getHostCapabilities()?.sampling) && !closed;
    $("sampling-capability").textContent = supported
      ? text(
          "宿主声明 sampling；可请求当前任务模型。",
          "The host declares sampling for the current task model.",
        )
      : text(
          "当前任务未提供 sampling，发送已禁用。",
          "Sampling is unavailable for this task; sending is disabled.",
        );
    for (const id of ["sampling-send", "sampling-reject"])
      $(id).disabled = !supported || Boolean(active);
    for (const id of ["sampling-reset", "sampling-prompt", "sampling-image", "sampling-invalid"])
      $(id).disabled = Boolean(active);
    $("sampling-cancel").disabled = !active;
    $("sampling-history").textContent = history
      .map((message) => `${message.role}: ${JSON.stringify(message.content)}`)
      .join("\n\n");
  }
  function status(phase, message) {
    $("sampling-status").dataset.phase = phase;
    $("sampling-status").textContent = message;
  }
  async function run(invalid) {
    if (active || closed || !app.getHostCapabilities()?.sampling) return;
    const prompt = $("sampling-prompt").value.trim();
    if (!invalid && !prompt) return;
    const user = { role: "user", content: [{ type: "text", text: prompt || "Explain 1 + 1." }] };
    if ($("sampling-image").checked)
      user.content.push({ type: "image", mimeType: "image/png", data: PNG });
    const request = { messages: [...history, user], maxTokens: 512, includeContext: "none" };
    if (invalid === "temperature") request.temperature = 0.5;
    if (invalid === "tools") request.tools = [];
    if (invalid === "audio")
      request.messages = [
        { role: "user", content: { type: "audio", mimeType: "audio/wav", data: "AAAA" } },
      ];
    const controller = new AbortController();
    active = controller;
    status("running", text("模型请求进行中…", "Sampling in progress…"));
    update();
    observe("sampling/start", {
      completedHistoryMessages: history.length,
      image: $("sampling-image").checked,
      rejectionCase: invalid ?? null,
    });
    try {
      const reply = await app.createSamplingMessage(request, {
        signal: controller.signal,
        timeout: 65_000,
      });
      // 用户取消后即使底层晚回成功也不得写入本页历史；失败的 user 消息同样不入历史。
      controller.signal.throwIfAborted();
      if (closed || active !== controller) return;
      if (invalid) {
        status(
          "unexpected",
          text(
            "意外接受：请核对宿主能力是否已更新。",
            "Unexpected acceptance: check whether host support has changed.",
          ),
        );
      } else {
        history.push(user, { role: "assistant", content: reply.content });
        $("sampling-prompt").value = "";
        status("complete", `${text("模型", "Model")}: ${reply.model} · ${reply.stopReason ?? ""}`);
      }
      observe("sampling/result", reply);
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const phase = cancelled ? "cancelled" : invalid ? "rejected" : "error";
      status(
        phase,
        `${cancelled ? text("已取消", "Cancelled") : text("请求拒绝或失败", "Rejected or failed")}: ${error.message ?? error}`,
      );
      observe(`sampling/${phase}`, { code: error.code, message: error.message ?? String(error) });
    } finally {
      if (active === controller) active = null;
      update();
    }
  }
  $("sampling-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void run();
  });
  $("sampling-cancel").addEventListener("click", () => active?.abort());
  $("sampling-reject").addEventListener("click", () => {
    void run($("sampling-invalid").value);
  });
  $("sampling-reset").addEventListener("click", () => {
    if (active) return;
    history.length = 0;
    status("idle", text("本页对话已清空。", "Page conversation cleared."));
    update();
  });
  return {
    update,
    close() {
      closed = true;
      active?.abort();
    },
  };
}
