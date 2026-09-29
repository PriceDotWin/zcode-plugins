import cases from "../cases.json" with { type: "json" };

const modes = {
  direct: ["直接操作", "Interactive"],
  guided: ["配合操作", "Guided"],
  fixture: ["自动化专用", "Fixture only"],
  pending: ["待宿主实现", "Pending"],
};
export function mountCatalogue({ app, language, text, observe }) {
  const $ = (id) => document.getElementById(id);
  let selected = cases[0];
  let promptEdited = false;
  let sending = false;
  function prompt(tool, args) {
    return text(
      `演示 ${selected.id}「${selected.title.zh}」。请调用 showcase 的 ${tool}，参数 ${JSON.stringify(args)}。`,
      `Demonstrate ${selected.id}: ${selected.title.en}. Call ${tool} from showcase with ${JSON.stringify(args)}.`,
    );
  }
  function details() {
    const lang = language();
    const content = $("case-detail");
    content.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = `${selected.id} · ${selected.title[lang]} · ${text(...modes[selected.mode])}`;
    content.append(heading);
    for (const [label, value] of [
      [text("操作", "Action"), selected.steps[lang]],
      [text("预期", "Expected"), selected.expected[lang]],
    ]) {
      const p = document.createElement("p");
      p.textContent = `${label}: ${value}`;
      content.append(p);
    }
    if (selected.command) {
      const code = document.createElement("pre");
      code.textContent = selected.command;
      content.append(code);
    }
    if (!promptEdited)
      $("demo-prompt").value =
        selected.tool || selected.pageTool
          ? prompt(selected.tool || selected.pageTool, selected.args)
          : "";
    $("send-demo").disabled =
      sending ||
      !(selected.tool || selected.pageTool) ||
      !app.getHostCapabilities()?.message ||
      !$("demo-prompt").value.trim();
    $("demo-prompt").disabled = !(selected.tool || selected.pageTool);
    $("open-case").disabled = !selected.target || !document.getElementById(selected.target);
  }
  function render() {
    const query = $("case-search").value.toLowerCase().trim();
    const mode = $("case-mode").value;
    const visible = cases.filter(
      (item) =>
        (mode === "all" || mode === item.mode) &&
        `${item.id} ${item.title.zh} ${item.title.en} ${item.steps.zh} ${item.steps.en}`
          .toLowerCase()
          .includes(query),
    );
    $("case-count").textContent = `${visible.length} / ${cases.length}`;
    $("case-list").replaceChildren(
      ...visible.map((item) => {
        const button = document.createElement("button");
        button.dataset.caseId = item.id;
        button.textContent = `${item.id} · ${item.title[language()]}`;
        button.setAttribute("aria-current", String(selected.id === item.id));
        button.addEventListener("click", () => select(item.id));
        return button;
      }),
    );
    details();
  }
  function select(id) {
    const item = cases.find((entry) => entry.id === id);
    if (!item) return;
    selected = item;
    promptEdited = false;
    render();
  }
  $("case-search").addEventListener("input", render);
  $("case-mode").addEventListener("change", render);
  $("demo-prompt").addEventListener("input", () => {
    promptEdited = true;
    details();
  });
  $("open-case").addEventListener("click", () =>
    document.getElementById(selected.target)?.scrollIntoView({ block: "start" }),
  );
  $("send-demo").addEventListener("click", async () => {
    const value = $("demo-prompt").value.trim();
    if (!value || $("send-demo").disabled) return;
    sending = true;
    const caseId = selected.id;
    $("send-demo").disabled = true;
    try {
      await app.sendMessage({ role: "user", content: [{ type: "text", text: value }] });
      observe("demo/message-sent", { caseId });
    } catch (error) {
      observe("demo/message-error", { message: error.message });
    } finally {
      sending = false;
      details();
    }
  });
  $("failure-prepare").addEventListener("click", () => {
    select("SC35");
    const mode = $("failure-mode").value;
    const tool = mode === "inline" ? "show_failure" : `show_failure_${mode}`;
    $("demo-prompt").value = prompt(tool, { throwError: $("failure-throw").checked });
    promptEdited = true;
    $("demo-prompt").focus();
  });
  render();
  return { update: render, select };
}
