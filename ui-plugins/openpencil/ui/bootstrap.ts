import { getClient } from "./client.ts";

(async () => {
  async function resource(name: string) {
    const r = await getClient().readResource("ui://openpencil/assets/" + name);
    if (!r.contents[0] || !("text" in r.contents[0]) || !r.contents[0].text)
      throw Error("Empty asset " + name);
    return r.contents[0].text;
  }
  const manifest = JSON.parse(await resource("assets.json"));
  const [css, ...parts] = await Promise.all([
    resource("panel.css"),
    ...manifest.scripts.map(resource),
  ]);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  document.getElementById("root")!.removeAttribute("style");
  const script = document.createElement("script");
  script.type = "module";
  script.textContent = parts.join("");
  document.body.append(script);
})().catch((e) => {
  document.getElementById("root")!.textContent =
    "设计稿编辑器加载失败 / Failed to load: " + e.message;
});
