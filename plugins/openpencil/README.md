# openpencil

通过官方插件市场安装并启用本插件；安装包自带必要运行时依赖，无需安装 npm 包。
在对话侧栏用 [OpenPencil](https://github.com/open-pencil/open-pencil)（MIT）编辑工作区里的 Figma `.fig` 设计稿；Agent 通过 OpenPencil 的 100+ 设计工具直接改面板里的活文档，用户右键把选区交给对话，按稿生成代码。

## 构建与加载

构建使用锁文件中固定的 OpenPencil 0.14.0 依赖；升级时需重新验证画布编辑、保存、字体和 WASM 加载。

```bash
pnpm build   # dist/server.mjs + dist/ui/*
pnpm --filter @zcode/plugin-openpencil test    # 单测
node ui-plugins/openpencil/scripts/smoke.mjs   # 真实拉起 stdio server 冒烟
```

源码开发时先在仓库根目录构建，再在插件商店添加 `dist/local-marketplace` 的绝对路径，安装并启用 `openpencil`。不要添加仓库根目录，其官方来源名称属于保留名称。源码更新后重新构建、刷新来源、重新安装插件，并在新会话测试。安装产物包含打包的 JS，以及 `dist/node_modules` 中所需的 css-tree、CanvasKit 和数据依赖，离开源码仓库也能启动。

启用后可发送：“新建设计稿 designs/landing.fig，放一个 hero 区块”。面板自动打开；手改 1.5 s 后自动保存，Agent 每步修改 200 ms 内落盘。画布右键：添加到对话上下文 / 让 ZCode 修改… / 根据选区生成代码。

## 结构

以下源码路径相对 `ui-plugins/openpencil/`；skill 位于 `plugins/openpencil/`。

- `src/adapters/server.ts`：自有工具（open/new/save/status/export/describe/convert）+ 上游 `registerTools` 透传；只有 open/new 声明面板 UI，其余工具复用已连接的编辑器；另提供 `panel` / `assets` / `design` 资源
- `src/adapters/upstream.ts`：进程内 `@open-pencil/mcp` `startServer()`（随机回环端口、token），工具经 `/rpc` 代理进面板
- `src/adapters/registry.ts`：文档登记表（path ↔ id ↔ revision ↔ owner），`fs.watch` 外部修改检测
- `ui/`：Vue 3 + `@open-pencil/vue` 自组壳；`ui/bridge.ts` 是上游自动化桥浏览器端的移植（v0.14.0，MIT）
- `skills/design/SKILL.md`：Agent 使用说明

## 已知边界（v1）

- 字体：内置 Inter / Noto Naskh Arabic；系统字体与在线字体未接入（CJK 会走上游替代逻辑）。
- 单文档：一个工作区同一时刻一个活编辑器；`.pen` 只读导入。
- 剪贴板读取、桌面拖拽进画布不可用（沙箱限制）；导出只写工作区 `exports/`。

## 独立仓库构建

在 zcode-plugins 根目录执行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:artifacts`。源码位于 `ui-plugins/openpencil`，可安装产物位于 `plugins/openpencil`；不要直接安装源码目录。`python3 scripts/build_dist.py` 生成 marketplace zip。运行需要 Node.js 24；不需要主应用源码或私有插件 SDK。
