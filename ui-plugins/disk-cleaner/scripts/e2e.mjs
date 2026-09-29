import assert from "node:assert/strict";
import { access, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";

const fixture = await startFixture();
const artifacts = resolve(
  process.env.DISK_CLEANER_E2E_ARTIFACTS || join(tmpdir(), "disk-cleaner-e2e"),
);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
);
const errors = [];
const open = async (query = "", viewport = { width: 1000, height: 820 }) => {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await page.goto(`${fixture.url}/${query}`);
  await page.waitForFunction(() => window.__initializations === 1);
  const frame = page.frames().find((item) => item !== page.mainFrame());
  assert.ok(frame, "official App iframe exists");
  return { page, frame };
};
const names = (page) => page.locator("tbody .file-name").allTextContents();
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const noOverflow = async (page, label) =>
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `${label}: horizontal overflow`,
  );

try {
  // 1. 中文浅色：扫描、筛选、选择、取消确认、确认移动、结果、重扫。
  const { page: outer, frame: page } = await open();
  await page.getByText("选择一个目录开始分析").waitFor();
  await page.getByLabel("目录", { exact: true }).fill(fixture.target);
  await page.getByLabel("大于").selectOption({ label: "1 MB" });
  await page.getByRole("button", { name: "扫描" }).click();
  await page.locator("tbody tr").first().waitFor();
  assert.deepEqual(await names(page), [
    "clip-4k.mov",
    "trip.mp4",
    "installer.dmg",
    "backup.zip",
    "shared.iso",
  ]);
  assert.ok(
    !(await page.locator("tbody").textContent()).includes("pack.bin"),
    ".git contents are never listed",
  );
  assert.ok(
    await page.getByRole("checkbox", { name: "shared.iso" }).isDisabled(),
    "hard-linked files cannot be selected",
  );
  await page.getByText("按目录").waitFor();
  await outer.screenshot({ path: join(artifacts, "zh-light-scanned.png"), fullPage: true });

  await page.getByLabel("搜索路径").fill("TRIP");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  await page.getByLabel("搜索路径").fill("");
  await page.getByLabel("全部类型").selectOption({ label: "视频" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);
  assert.deepEqual(await names(page), ["clip-4k.mov", "trip.mp4"]);

  await page.getByRole("checkbox", { name: "选择本页" }).check();
  await page.getByText("已选 2 个 · 10.0 MB").waitFor();
  await page.getByRole("button", { name: "检查并清理" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("将把 2 个文件（10.0 MB）移入系统回收站。").waitFor();
  assert.ok(
    (await dialog.textContent()).includes(join(fixture.target, "videos", "raw", "clip-4k.mov")),
    "plan lists full paths",
  );
  await outer.screenshot({ path: join(artifacts, "zh-light-plan.png") });
  await dialog.getByRole("button", { name: "取消" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.ok(await exists(join(fixture.target, "videos", "trip.mp4")), "cancel moves nothing");

  await page.getByRole("button", { name: "检查并清理" }).click();
  await dialog.getByRole("button", { name: "移入回收站" }).click();
  await dialog.getByText("已移入回收站 2 个文件，共 10.0 MB。").waitFor();
  assert.equal(await dialog.locator(".outcome.moved").count(), 2);
  assert.ok(!(await exists(join(fixture.target, "videos", "trip.mp4"))));
  assert.equal((await readdir(fixture.trash)).length, 2);
  await dialog.getByRole("button", { name: "完成" }).click();
  await page.locator("tr.removed").nth(1).waitFor();
  assert.ok(await page.getByRole("checkbox", { name: "trip.mp4" }).isDisabled());

  await page.getByLabel("全部类型").selectOption({ label: "全部类型" });
  await page.getByRole("button", { name: "重新扫描" }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
  assert.deepEqual(await names(page), ["installer.dmg", "backup.zip", "shared.iso"]);
  assert.ok(
    (await outer.evaluate(() => window.__heights.length)) > 0,
    "panel reports intrinsic height",
  );
  await noOverflow(page, "zh desktop");

  // 2. 英文深色：面板读取现有扫描状态；宿主推送主题/语言变化后即时切换。
  const { page: outerDark, frame: dark } = await open("?theme=dark&locale=en-US");
  await dark.getByRole("columnheader", { name: "File" }).waitFor();
  assert.equal(await dark.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(
    await dark.getByLabel("Larger than").inputValue(),
    String(1024 * 1024),
    "draft follows the current scan",
  );
  const background = await dark.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(background, "rgb(255, 255, 255)");
  await outerDark.screenshot({ path: join(artifacts, "en-dark.png"), fullPage: true });
  await outerDark.evaluate(() => window.__setGlobals({ theme: "light", locale: "zh-CN" }));
  await dark.getByRole("columnheader", { name: "文件" }).waitFor();
  assert.equal(await dark.evaluate(() => document.documentElement.dataset.theme), "light");

  // 3. 窄屏：无横向溢出，日期列隐藏。
  const { page: outerNarrow, frame: narrow } = await open("?locale=en-US", {
    width: 380,
    height: 760,
  });
  await narrow.locator("tbody tr").first().waitFor();
  await noOverflow(narrow, "narrow");
  assert.ok(!(await narrow.locator("td.date").first().isVisible()));
  await outerNarrow.screenshot({ path: join(artifacts, "en-narrow.png"), fullPage: true });

  // 模型侧新扫描后推送旧输出，页面必须重新读取 owner，不能采用通知中的历史快照。
  await fixture.client.callTool({
    name: "scan_directory",
    arguments: { path: fixture.target, minBytes: 2 * 1024 * 1024 },
  });
  await outerDark.evaluate(() =>
    window.__sendToolResult({
      content: [],
      structuredContent: { scan: { root: "/stale-output", minBytes: 1 } },
    }),
  );
  await dark.waitForFunction(
    () => document.querySelector("select")?.value === String(2 * 1024 * 1024),
  );
  assert.equal(await dark.getByLabel("目录", { exact: true }).inputValue(), fixture.target);
  for (const host of [outer, outerDark, outerNarrow])
    assert.equal(
      await host.evaluate(() => window.__initializations),
      1,
      "one App connection per page",
    );
  assert.deepEqual(errors, []);
  process.stdout.write(`disk cleaner e2e: ok (screenshots in ${artifacts})\n`);
} finally {
  await browser.close();
  await fixture.close();
}
