# 思维图图谱视图 · 力导向改造记录与 handoff

> 原文件是「待办 + 设计」的交接文档（写于 2026-11-09 上午）。
> 现在这份文档记录**已实施的结果**、验证数据、以及换人接手时需要的全部事实。
> 上游事实参考：`docs/api-notes.md`（DSH 侧 API 侦察笔记）。

---

## 0. 一句话现状

`mind_map@0.1.66` 已被本地改造出 **canvas 图谱视图 + 持续力导向模拟**，
已装进 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\mind_map`，
在真实 GUI（63+ 卡 / 88 边）里验证通过：控制台无 error，拖动会带动全场重新平衡并落库。
**版本号保持 0.1.66 不变**（用户明确要求）。

---

## 1. 上一版「面板打不开」的根因（已修）

不是新功能写错，是**补丁脚本自身的 bug**：

```js
{
  label: "tap-bridge",
  find: "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);",
  replace: "  mindMapTapBridge.live = {...}; mindMapCanvasBridge.current = {...};",   // ← 被下一行覆盖
  replace: String.raw`          if (draggingCardId !== change.id) ...`              // ← 真正生效的那句
}
```

对象字面量里写了**两个 `replace:` 键**，后者赢。于是：
本该「插入 bridge 赋值」的锚点，变成了「把 `const savedCamera = ...` 这一行替换成拖动推挤代码」，
而那段代码引用的 `change` 在 `CanvasInner` 顶层作用域根本不存在 → 渲染期 `ReferenceError`
→ 整个地图面板子树不渲染 → `.tm_graphSurface` 数量 0、侧栏点「思维图」无反应。

**教训**：一个锚点只对应一个 edit，一条功能一个 `label`（脚本现在会校验 label 唯一、
`replace` 必须是字符串、且不允许 find === replace）。

---

## 2. 补丁脚本现在的用法（可二分）

```powershell
cd C:\Users\suma\Documents\DSH\mind_map

node apply-patch.mjs --list                  # 打印全部 label（client 48 条 / host 5 条）
node apply-patch.mjs                         # 从 .mindmap-graph-backup 重建 → 打全部补丁
node apply-patch.mjs --dry-run               # 只在内存里跑，打印体积变化
node apply-patch.mjs --only=css,module-block # 只打这几条（二分用）
node apply-patch.mjs --skip=card-tags-data   # 排除某几条（二分用）
node apply-patch.mjs --pkg=<插件目录>         # 给别的目录打补丁（默认 cwd）
node apply-patch.mjs --revert                # 从 .mindmap-graph-backup 还原
```

- 打完会写 `MIND_MAP_GRAPH_PATCH_V1` 标记；重复执行会提示「already patched」。
- 每次 apply 前会做**语法闸门**：client 用 `vm.Script` 解析（等价于宿主 `new Function`），
  host 用 `node --check`（受限沙箱里子进程拿不到管道会降级成提示，需要时在 shell 里单独 `node --check`）。
- 锚点不匹配会直接报错并打印锚点头部，不会半套改坏。

---

## 3. 已实现的功能

### 3.1 持续力导向模拟（用户的核心诉求）

在 `GraphCanvasSurface` 内维护 `simRef = { nodes: Map<id,{x,y,vx,vy}>, alpha }`，
每帧 `tickSim()`，退火到 `alpha ≤ 0.004` 才 `commitSim()` 一次性写回插件 store。

| 力 | 公式 | 参数 |
|---|---|---|
| 节点间斥力 | `a = charge / d²`，全对全，**超出 `repulsionRange` 才不推** | `charge = -320000`，`repulsionRange = 1150` |
| 边弹簧 | `a = (d − L) × k`，超过 `L × 1.35` 换硬弹簧 | `L = 330`，`k = 0.02`，硬弹簧 `0.3` |
| 重力 | `a = (centroid − p) × 0.003`（防止孤立簇飞走） | `0.003` |
| 积分 | `v = (v + a) × 0.5`，`p += v`，`|v| ≤ 45` | `velocityDecay = 0.5`（重阻尼：松手后停在原地，不再滑行） |
| 退火 | `alpha ×= 0.955`，`≤ 0.004` 停止 | 约 1.8 s 收敛（60 fps） |

- 单对节点平衡距离 ≈ 420 px（`k(d−L) = charge/d²`），所以「线段长度有限」。
- **阻尼是调过的**（2026-11-09 下午，用户反馈「挺滑的」）：`velocityDecay` 0.7 → **0.5**、`maxVelocity` 90 → **45**、
  `alphaDecay` 0.975 → **0.955**，拖动期热值 0.85/0.45/0.7 → **0.8/0.4/0.55**。同一套拖动测量（拖一张卡 250 px，
  采样 4 s）：残余总位移 147 px → 18–75 px，单节点单帧最大位移 2.0 px → 0.7–1 px，95% 运动完成时间 1.76 s → 0.8–1.3 s，
  `alpha` 收敛 3.5 s → 1.8 s，无震荡（峰数 0–1）。
- **现场调参**：`window.__mindMapDebug.settings` 就是模拟参数对象，改完立即生效，不用重打补丁；例如
  `__mindMapDebug.settings.velocityDecay = 0.4`（更黏）或 `0.6`（更飘）。刷新页面后回到代码里的值。
- **拖动时**：被拖的卡钉在指针下（不参与积分），其余节点继续流动；按下即 `reheat(0.85)`，
  拖动中把 alpha 兜在 0.45 以上，松手 `reheat(0.7)`。
- **静止时**：模拟不动、不写库，只有「有会话在跑」时才有动画帧（边框流光）。
- **重播种**：`⟲ 重新排布` 会把新坐标写进 store 并置 `reseed`，下一帧从 store 重新取点，
  否则运行中的模拟会无视外部写入（这个 bug 已修，实测点按钮后 65/65 张卡重排，最大位移 1327 px）。

### 3.2 其余九项（原清单全部落地）

| # | 功能 | 实现要点 |
|---|---|---|
| 1 | 悬停高亮 | 悬停卡描边 `#8ab4ff`、线宽 ×2；它的边加粗不透明，其余边 alpha 0.18、其余卡 0.45 |
| 2 | 边按类型分色 | `ws` 冷灰 / `tag` 蓝 / `lineage` 暖橙（`edge.type === "mindMap"` 判定血缘）/ `other` |
| 3 | LOD 三档 | `zoom>0.42` 全信息；`0.42–0.22` 只标题；`<0.22` 纯色块 |
| 4 | 归档灰化 | alpha 0.42 + 左下角「已归档」（只在「显示归档」时才看得到，因为默认隐藏） |
| 5 | 隐藏归档开关 | **默认隐藏**；`🗄 归档 / 🗄 已隐藏归档 N` 切换，`localStorage: dsh.mind_map.hide-archived.v1`（写 `1`=隐藏，`0`=显示） |
| 6 | 右键菜单 | canvas `contextmenu` → 复用插件自带 `openMenu(fakeEvent, "card"/"pane", id)`；假 event 只需 `clientX/clientY/preventDefault` |
| 7 | 双击空白新建会话 | 用当前相机换 flow 坐标 → `startSessionIn(folderAt(x,y))`（会关地图、进 shell 的新会话屏） |
| 8 | 拉线分叉 | **shift + 从卡片拖出**，画虚线橡皮筋，松手在空白处 → 造出与插件原生一致的 `PendingSpawn` → 复用 `SpawnPreview` 对话框 |
| 9 | 镜头缓动 | 自写 rAF 补间（250 ms ease-out cubic）；`fit` 首次瞬移、之后缓动 |
| 10 | 跳转居中 | 点状态栏（队列里的任务）的一条 → 镜头 320 ms 缓动，把那张卡平移到视口正中（见 3.8） |

### 3.3 隐藏归档会**重算连线**（而不是只把节点藏起来）

归档卡参与同一工作区链 / 同标签链的建链。如果只把节点 `hidden`，链就从中间断掉：A—B(归档)—C 藏了 B 之后
A 与 C 谁都不连，剩下的卡变成孤岛。所以两份图数据都按「当前可见集合」重算：

- `graphCardIds`（同工作区链的成员）先剔除 `hideArchivedOn && archivedSessionSet.has(sessionId)`；
- `graphTagGroups`（同标签链的成员）同样剔除，并在依赖里加入 `hideArchivedOn / archivedSessionSet`，
  切换开关立即重建边；
- 节点 `hidden`、`liveEdges`、`liveNodes` 的 memo 依赖也都带上这两个值。

实测（本机 65 卡，59 张属于已归档会话）：默认隐藏时可见 3 张、边 2 条（`9c0b→0f8f`、`0f8f→0556`，
中间那张归档卡被跳过后自动改接），**悬空边 0**；切到「显示归档」后可见 4 张、边 3 条（含 tag 边）。

### 3.5 侧栏席位（dsh-better-sidebar tab）

地图除了占中间栏，还能挂进 `dsh-better-sidebar` 的右栏，跟「文件 / Git / 上下文」同级：

- `apply()` 里用 `ctx.get("betterSidebar")` 拿到服务，`ctx.effect` 里 `registerTab({ id: "mind-map:map", title, order: 45, single: true, component })`。
  没有装 better-sidebar 时整段跳过，行为与之前完全一致。
- **坑**：侧栏 tab 自带的 `ctx` 没有 `sessions/workspaces` 的 inject，取 `ctx.workspaces` 会抛
  `cannot get property "workspaces" without inject`。所以标准 props 必须用 **apply() 拿到的那个 ctx** 造：
  `sessions` 取 `ctx.sessions.list`、`workspaces` 取 `ctx.workspaces.list`（两者都有 getSnapshot/subscribe），
  `sessionStatus` 取 `ctx.slots._rootBinding.hooks.sessionStatus`（私有字段，拿不到就省略）。
- 三个 hook 都是**保持原样的选择器 hook**：外壳传下来的 `useSessions/useWorkspaces/useSessionStatus`
  在组件里都是 `(state) => state` 这种恒等选择器，所以自造的 hook 只要把同一份快照原样返回即可
  （内部带缓存，避免 React 因新对象无限重渲染）。
- 侧栏里加了一颗 `⤢ 全屏`：打开中间栏面板；面板打开时侧栏 tab 渲染一行提示而不是第二张地图
  （`mapUi.open` 为真就换占位），保证同一时刻只有一个模拟在写位置。
- 底部那颗「思维图」按钮现在**优先开侧栏那一栏**（`service.openTab({type:"mind-map:map"})`），
  没有 better-sidebar 才退回中间栏面板。
- **重启后会自己回来**：better-sidebar 只按会话记已开的 tab，冷启动不回填，所以插件自己记一个
  `localStorage: dsh.mind_map.sidebar-tab.v1`（默认想开）：`apply()` 里检测到有当前会话就
  `openTab({type:"mind-map:map"})`；还没会话（停在新会话屏）就先订阅 store，等会话出现再开，
  最多等 120s。tab 的 `onOpen/onActivate` 置 `1`、`onClose` 置 `0`（关过就不再自动弹）。
- **没有当前会话时**：better-sidebar 不接受无会话的 tab，`openMindMapSidebar()` 会返回 false，
  底部按钮于是退回中间栏整屏面板（面板不依赖会话）。
- 侧栏宽度约 860px 时地图可用；窄到 380px 也能缩放浏览，但整理卡片建议点全屏。
- 调试钩子：`window.__mindMapCtx` 是 apply() 收到的 cordis ctx，用来在控制台查服务，
  `window.__mindMapDebug` 是模拟/相机探针（见 3.1）。

### 3.5.1 左栏插件入口（sidebar.panellist）

「插件 / 自动化任务 / 上下文洞察 / 任务看板 / 记忆系统 / SSH」那一排是壳的 `sidebar.panellist`
插槽，**不会自动收录插件**——每个插件必须自己往里面注册一行。地图原来只挂了底部切换按钮
（`sidebar.footer.action`）和 better-sidebar 的右栏 tab，所以那一排里看不到它。

- `apply()` 里补一条 `registerSafely("sidebar.panellist", () => ctx.slots.register({ name:
  "sidebar.panellist", id: MAP_PANEL_ID, order: 35, label: () => t("map.title") },
  MindMapPanelIcon))`；补丁 label `panellist-seat`。
- 行的 `id` 必须等于 `main` 面板的 `key`（两者都是 `MAP_PANEL_ID`）：壳按 id 把行绑到同 key
  的 main 面板，点行就是切过去；行框 / 标签 / tooltip / 高亮 / 折叠轨道都由壳负责。
- 图标组件只画 glyph（`{ size }` → 16px SVG），带 `data-dsh-panel-entry` 供皮肤反查，
  与 dsh-ssh 的做法一致。
- 顺序落在「记忆系统」(30) 与「SSH」(40) 之间；实测渲染顺序：插件、自动化任务、上下文洞察、
  任务看板、记忆系统、**思维图**、SSH、更多。
- 改完 `node apply-patch.mjs` 重建，把 `client/client.js` 复制到
  `~/.dsh/profiles/desktop/vendor/mind_map/client/client.js`，**刷新页面即生效**（宿主没动）。

### 3.6 卡片上的实时活动（正在分析请求 / 正在思考 / 正在回复 / 正在执行）

卡片标题下面多一行活动摘要，颜色区分：灰蓝=正在分析请求、蓝=正在思考、绿=正在回复、琥珀=正在执行。

- **取数通道不是 `$on`**：客户端只转发 5 个 `api-session/*` 事件，`agent/*` 一个都没有。
  真正的通道是每会话一条 `remote.session.follow({address, activate:true, assistantStream:true, maxMessages:1})`
  异步流（返回的是 async **iterable**，要 `[Symbol.asyncIterator]()`）。
- 帧三种：`snapshot`（带 `assistantStream.activeAttempt.stream` 基线）、
  `assistant-stream`（`start|chunk|end`）、`event`（持久事件）。
- 文案来源：`reasoning-delta`→正在思考、`text-delta`→正在回复、`block-end` 用块全文覆盖；
  「正在执行」必须用持久事件 `tool/call`（`data.name` + `data.arguments` 是 JSON 字符串），
  `tool/result`/`step/end`/`frame.type==='end'` 分别清对应那半句。
- **兜底**：会话行 `running===true` 但流里还没有任何文本时显示「正在分析请求」——这正是
  发出去还没吐第一个 token 的那一段（也和外壳聊天区的状态一致）。
- **帧率 40–55/s**，所以模块内部只做 150ms 合并通知，画布靠 `subscribe()` 重绘，绝不逐帧 setState。
- 只在 `running===true` 的会话上开流，最多 8 条，`api-session/status` 转 false 立刻 abort。
- 接线：`ctx.get("remote")` + `ctx.get("remote.session")`（实测免 inject），拿不到再走
  `ctx.inject(["remote","remote.session"], cb)`；两条都失败就静默降级成原来的预览文本。
- 观察到的时序：attach 后第一条实时帧要等**下一个 attempt 开始**（实测约 10s），
  这中间就是「正在分析请求」兜住；`snapshot` 里的 `activeAttempt` 是**可选**的，
  没有它不代表没在跑。
- 模块单独成文件 `live-activity.js`（可 `node --check`、已跑过折叠逻辑单测），
  构建时由 apply-patch.mjs 读进来拼到模块块末尾；探针 `window.__mindMapLive`
  （`debug()` 看接线程/开流/有状态会话数，`textFor(sessionId)` 取那一行）。

### 3.7 顺带修掉的静默错值

图谱模式下 `<ReactFlow>` 没挂载，React Flow 的 `screenToFlowPosition` 会**原样返回 client 坐标**
（`client.js:7854`），`setCenter` 直接 `return false`。所以：

- 新增 `mindMapCanvasToFlow` 钩子（canvas 挂载时注册自己的屏幕→flow 换算），
  `openMenu` 算 flow 坐标时优先用它 → 右键菜单里「在此处新建/粘贴」才落在点击位置。
- 双击空白走 canvas 自己的换算，不依赖 React Flow。

### 3.8 跳转居中：点状态栏的一条，镜头滑到那张卡

**现象（2026-11-10 用户报）**：状态栏「队列中的任务」里点一条，本该跳到那张卡；
实际是画面不动，卡片出现在哪儿全看你之前把画布拖到了哪儿 ——「每次跳转位置都不一样」。

**根因**：跳转走的是插件原生的 `focusCard`，它只调 React Flow 的 `setCenter(...)`。
图谱模式下 React Flow **根本没挂载**（就是 3.7 那条 `return false`），所以每次点击都是空操作。

**改法**（`jump-center` 补丁 + 模块块里的 canvas 相机）：

- 模块块新增 `var mindMapCenterKick = { fn: null };` 这条桥，canvas 挂载时把
  `centerOnCard(cardId, { zoom })` 注册进去、卸载时置空（和 `mindMapFitKick` 同一套写法）。
- `centerOnCard` 的落点：`boxMap()` 里那张卡的实时矩形（模拟运行中的坐标、拖动预览都算），
  按 `x = clientWidth/2 - (box.x + box.w/2) * zoom` 反解镜头，**只和卡在哪有关，
  与当前视口被拖到过哪儿无关**；动画走已有那套 320 ms ease-out 相机补间。
- 缩放：`clamp(当前 zoom, 0.62, 1.5)`。比 0.62 还远（默认 fit 常在 0.45 上下）就先拉到能看清
  标题+摘要的读数，本来就更近则保留，最多 1.5 不贴脸。
- `focusCard` 末尾多一句：`mindMapCenterKick.fn(cardId)`。白板模式下 canvas 没挂载、
  桥为 null，这行是空操作，行为不变。
- 探针：`window.__mindMapDebug.camera() / viewport() / box(cardId) / centerOn(cardId, zoom) / tweening()`。

**实测（真实 GUI，端口 9821，侧栏 417×782，zoom 0.45）**：
先把画布拖走 150,-100（卡片屏幕中心偏到 260,400），再点状态栏那条 → 镜头缓动后
`box` 中心换算回屏幕 = `(208.5, 391)`，与视口中心误差 **0.00 px / 0.00 px**，zoom 落到 0.62。

---

## 4. 验证记录（2026-11-09，真实 GUI，端口 8318）

| 项 | 结果 |
|---|---|
| 打开地图 | `.tm_graphSurface` = 1，`.tm_graphCanvas` = 1，控制台**无 error**（只有插件自己那句 `client bundle evaluated`） |
| 模拟收敛 | `alpha` 从 1.0 衰减到 `0.0039`（< `alphaMin`）后停止；65 节点全量 tick |
| 拖一张卡 | 被拖卡位移 355 px，**其余 64/64 张全部移动**，最大 585 px；松手 ~6 s 后落库 |
| 落库 | `~/.dsh/storages/mind_map.json` 的 `tables.cards[*].x/y` 更新，刷新后位置不变 |
| ⟲ 重新排布 | 65/65 张重排，最大 1327 px，然后重新收敛 |
| 右键菜单 | `.tm_menu` 出现，条目：置顶会话/标为未读/重命名/查看摘要/归档会话/删除会话/批量操作 |
| shift 拉线 | 弹出 `role=dialog` 的「连线分叉：开一个带上下文的新对话」，带父会话标题与三种注入模式；取消可正常关闭 |
| 隐藏归档 | **默认开启**：按钮显示「🗄 已隐藏归档 59」，可见卡 3 张、0 张归档；边重算为 2 条、悬空 0 |
| 显示归档 | 切回后可见 4 张（含 2 张灰化的「已归档」卡）、边 3 条（ws×2 + tag×1），与隐藏前一致 |
| 双击空白 | 地图关闭并进入新会话屏，无 error |
| 性能 | 拖动/缩放期间 `longtask` = 0；模拟是 O(n²)，65 节点约 2k 对/帧，可忽略 |

截图：`docs/shots/graph-force-hover.png`（悬停高亮 + 边分色）、`docs/shots/graph-force-lod.png`（远景 LOD）。

---

## 5. 安装 / 回滚

```powershell
$fork = "C:\Users\suma\Documents\DSH\mind_map"
$pkg  = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\mind_map"

# 安装（客户端改动刷新页面即生效；宿主改动要重启桌面端）
Copy-Item "$fork\client\client.js" "$pkg\client\client.js" -Force
Copy-Item "$fork\lib\index.js"    "$pkg\lib\index.js"    -Force
node --check "$pkg\client\client.js"

# 回滚到 0.1.66 原版（补丁脚本留下的原始备份）
Copy-Item "$pkg\client\client.js.mindmap-graph-backup" "$pkg\client\client.js" -Force
Copy-Item "$pkg\lib\index.js.mindmap-graph-backup"    "$pkg\lib\index.js"    -Force
```

`backups/` 里另存了本次改造**之前**那一版可用构建（`client-0.1.66-graph-v1.js`，
804,592 字符），需要回到「只有基础图谱、没有力导向」时用它。

> ⚠️ 升级插件前先 `--revert`，升级后删掉两个 `.mindmap-graph-backup` 再重新 apply。
> 新版本改结构时锚点断言会失败，按报错里的锚点头部重新定位。

---

## 6. 环境事实（省半小时）

| 项 | 值 |
|---|---|
| 插件安装路径 | `%USERPROFILE%\.dsh\profiles\desktop\node_modules\mind_map` |
| 当前构建 | `client/client.js` = **827,599 字符**（本仓库 `client/client.js` 同源） |
| 原始 0.1.66 备份 | 同目录 `client/client.js.mindmap-graph-backup`、`lib/index.js.mindmap-graph-backup` |
| 工作区旧脚本 | `C:\Users\suma\Documents\DSH\mind-map-graph\apply-patch.mjs` ← **已被本仓库取代**，仅作历史参考 |
| 数据文件 | `%USERPROFILE%\.dsh\storages\mind_map.json`（`tables.cards/digests/edges`） |
| GUI 鉴权 | `mind-map-graph\mint-cookie.mjs <host:port>` 生成签名 cookie，配合 Playwright `addCookies`；**DSH 每次重启端口都变** |
| 客户端改动生效 | 刷新页面即可（bundle 从磁盘读，按 rev 参数缓存） |
| 宿主改动（digest tags） | 需要重启桌面端 |
| 归档真源 | `workspaces.archivedSessionIds`（**session summary 里没有 archived 字段**） |

### 踩过的坑（别再踩）

1. **锚点 vs CRLF**：git 产物是 CRLF、npm 包是 LF，脚本先 `.replace(/\r\n/g,"\n")` 归一化。
2. **String.raw 模板里不能出现反引号**：注释里写 `` `moveCards` `` 会把 patch 脚本自己写坏。
3. **PowerShell 的 `cd` 不影响 `[System.IO.File]::ReadAllText(相对路径)`**，用绝对路径。
4. **别在渲染期引用后面才 `const` 定义的变量**（TDZ）：`archivedSessionSet` 一开始放在
   `liveEdges` 之后，而卡片节点的 memo 在它之前就用了 → 整面板崩。声明要放在第一个使用点之前。
5. **后台标签页会把 rAF 节流到 ~1 fps**：自动化验证必须先 `page.bringToFront()`，
   否则会误判成「模拟几乎不动」（本项目曾因此以为力常数太小）。
6. Playwright 浏览器进程可能自己重启成 `about:blank`，抓错误前先确认页面。
7. 点地图里的「归档会话」会 `removeCard`（不是打标记）；灰化/隐藏只影响**在别处归档但卡还在板子上**的会话。

---

## 7. 已知边界 / 后续可做

- 图谱模式与白板共用 `cards.x/y`：切回白板会被槽位重排覆盖，再回图谱会重跑一次全量排布。
- 边不做避障路由（会从卡片上方掠过），属性能取舍。
- 卡片集合变化时，CanvasInner 的旧自动排布仍会算一次并写库；运行中的模拟会忽略这次写入，
  只是白算一点 CPU。要更省可以给 `graphAutoRef` 加短路。
- 力常数是按 224×120 卡片、几十个节点调的；节点上到几百时 O(n²) 与绘制会成为瓶颈，
  届时再考虑 Barnes–Hut 四叉树 + 视口剔除。
- `window.__mindMapDebug`（`alpha()/size()/nodes()/reheat()/draws()`）是给验证脚本用的只读探针，
  UI 不读它；不想要可以删掉 `__mindMapDebug` 那段（在 `apply-patch.mjs` 的 canvas mount effect 内）。

---

## 8. 改名记录（2026-11-09：dsh-talk-map → mind_map）

四层一起改了，改完在真实 GUI 验证：地图照常、65 张卡 / 65 条摘要完好。

| 层 | 旧 | 新 | 备注 |
|---|---|---|---|
| 包/项目名 | `dsh-talk-map` | `mind_map` | 仓库目录 `Documents\DSH\mind_map`；`cordis.patch.yml` 的 `id: mind-map` |
| 存储单元 | `talk_map` | `mind_map` | `~/.dsh/storages/mind_map.json` |
| 浏览器偏好键 | `dsh.talk-map.*` | `dsh.mind_map.*` | 客户端启动时把旧键一次性复制到新键（不删旧键） |
| 内部标识 | `talkMap*` / `TalkMap*` / `talk-map:map` | `mindMap*` / `MindMap*` / `mind-map:map` | 探针改名：`__mindMapCtx` / `__mindMapLive` / `__mindMapDebug` |

改名靠 `apply-patch.mjs` 的 `RENAME_PAIRS` + `renameAll()`：**先给 pristine 源改名，再匹配锚点**
（锚点本身也已经是新名字）。这张替换表必须用字符串拼接写（`"tal" + "k-map"`），否则再跑一次
全库改名会把表项改成恒等映射——第一次就踩了这个坑。

### 8.1 崩溃根因：存储单元的 unit 头

换名时只把 `talk_map.json` 复制成 `mind_map.json`，文件里的 `unit.name` 还是 `talk_map`，宿主启动即：

```
dsh: fatal load failure: StorageError: unit 'mind_map': missing or foreign unit header
  at parse (@deepseek-ai/dsh-storage-json/lib/index.js:104)
  at openSingleUnit (…:195)
```

→ host 进程 exit 1 → 桌面端崩（日志：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-host.log`）。

**正确做法**：`node migrate-storage.mjs <旧单元> <新单元>` —— 复制的同时改写 `unit.name`，旧文件保留；
`--dry-run` 先看表计数。当前 `mind_map.json` 的 `unit = {"name":"mind_map","version":1}`，
`cards=65 / digests=65` 已验证。

### 8.2 侧栏「v2」重启后不见的根因

自动恢复原先订阅 `betterSidebar.subscribe` 等「会话出现」，但它**只在 tab 注册表变化时通知**，
不会在会话切换时触发；冷启动首次 `openTab` 时还没有当前会话（better-sidebar 的 tab 必须挂会话），
那次调用被静默忽略，之后再也不重试 → 重启后右栏空着。

改成**有上限轮询**（1.5s × 16 次）：每次重试 `openTab`，直到 `MapSidebarTab` 的 effect 把
`mindMapSidebarSeat.mounted` 置 true（那栏真的挂出来了）或用户关掉（偏好置 0）为止。

### 8.3 安装布局（重要）

```
~\.dsh\profiles\desktop\
├─ package.json          dependencies: "mind_map": "file:./vendor/mind_map"
│                        dsh.profile.bundles: … "mind_map"
├─ vendor\mind_map\   ← 真正的安装源（client + lib + package.json + cordis.patch.yml）
└─ node_modules\mind_map  → junction 指向 vendor\mind_map
```

以后更新只改 `vendor\` 一处；client 半刷新页面即生效，宿主 `lib/` 改动仍需重启桌面端。
旧包目录留作 `node_modules\dsh-talk-map.migrated`（回滚用，不参与加载）。

---

## 9. 子代理（subagent）上板（2026-11-09）

之前 `placeableSessionIds()` 明确排除了 `origin === 'subagent'` 的会话，所以派生的子 agent 从不出现在地图上。
现在它们按「真会话」处理，但执行完就和归档一样对待：

| 行为 | 规则 |
|---|---|
| 上板 | 非 blank 的子代理会话都建卡（44/44 实测全上板） |
| 归属 | 子会话没有 workspace：映射到**父会话所在分组**，所以在白板里落进同一个文件夹 |
| 落点 | 父卡在板上 → 落在父卡右侧；父卡不在 → 沿血缘往上找最近的祖先卡；都没有 → 排到板子右侧的「子代理带」 |
| 运行中 | 正常亮度，卡片左下角标「子代理 · 运行中」，并且**照常显示实时活动**（正在思考/正在执行） |
| 已结束 | alpha 0.42（和归档一致），角标「子代理 · 已完成」，参与同一个隐藏开关 |
| 隐藏 | `🗄 显示全部 / 已隐藏 N` 同时盖住「已归档会话」和「已跑完的子代理」；隐藏时同工作区链/同标签链按可见集合重算（不穿过后台卡片） |

实现全是补丁里的 label：`subagent-placeable`（放开过滤）、`subagent-workspace`（挂到父分组）、
`subagent-place-cards`（补卡与落点）、`subagent-data`（卡片 data 里的 `subagent`/`subagentFinished`）、
绘制里 `dormant` 分支、以及 `archivedCardCount` 把两类一起计数。

实测（109 张卡 = 65 普通 + 44 子代理）：隐藏态可见 3 张、已跑完子代理可见 0 张；
切「显示全部」后已跑完子代理出现且是灰的；运行中的探针子代理（`probe-child`）在隐藏态也可见，
卡片上显示「正在分析请求」。

---

## 10. 连线改成「同组全连接」（2026-11-09）

原来是「同组按更新时间只连相邻两点」+「一对卡只保留一条边」，所以会出现「A 和 C 明明同组却没有线」。
现在：

- **同工作区 / 同标签组内任意两点都连线**（全连接，clique），不再是链。
- **不再因为「这一对已经连过」就跳过**：同一对可能既是同工作区又是同标签，两条都保留；
  血缘边（父→子/分叉）也照旧独立存在。
- 边 id 里带上关系本身（`graph-tag-<标签>-A-B`），所以同一对共享多个标签时是几条独立边，不会撞 id。
- **弹簧按度数归一**：`k *= 2/(degA+degB)`。不归一的话，一个 20 人的组等于给每个节点挂 19 根弹簧，
  整组会被压成一个点；归一后每组的总弹力与原来的链式布局大致持平。

实测（109 张卡：65 会话 + 44 子代理）：

| 视图状态 | 边数 | 构成 |
|---|---|---|
| 默认（聚焦 + 已隐藏） | 7 | ws 3 / tag 1 / 血缘 3 |
| 显示全部（仍聚焦） | 159 | ws 106 / tag 49 / 血缘 4 |
| 关闭聚焦 + 显示全部（全量） | **1556** | ws 1106 / tag 423 / 血缘 27 |

`duplicateIds = 0`；1556 条边下 rAF 仍是 60 帧/秒（`alpha` 已收敛）。

> 取舍：全量视图会变成「毛球」——这是全连接的几何必然。如果嫌密，可选的降级方案有：
> 只对成员数 ≤ N 的组全连接、大组退回链式；或按「共同组数」过滤（只画共享 ≥2 个组的对）。
> 目前按用户要求保持全连接。

### 9.1 子代理不挂「待查看」灯（2026-11-09 追加）

状态栏（`statusRail.title` = 「队列中的任务」）的灯由 `glowOf()` 决定，其中 `done`（待查看）来自
`completionUnread` 或插件自己持久化的 `finished` 集合（`dsh.mind_map.lamp-state.v1`）。
子代理**永远不会成为主视图**，所以它们一跑完就必然进 `finished`，于是 45 个子代理会一直挂在状态栏里
——而"去读一个子代理会话"本身没有意义（结果写在父会话里）。

现在 `glowOf()` 在 `done` 分支对 `origin === "subagent"` 直接返回 `undefined`，卡片 `data.done` 同样关掉；
运行中 / 等你回复 / 异常终止 三种灯照旧。

实测：跑一个即答子代理（`probe-lamp`），它在持久化的 `finished` 里被记为 1 条（就是它），
但状态栏 `entries` 只有父会话那一条 `running`，`subagentDoneLamps = 0`。
`finished` 集合本身不清理（保留历史），只是不再渲染成灯。

### 9.2 侧栏 tab 时有时无的两个根因（2026-11-09 追加）

用户反馈「重启后右侧又没有思维图」。查下来是两件事叠在一起：

1. **服务获取没有重试**。`ctx.get("betterSidebar")` 在启动早期可能还没注册好，旧代码 `return` 掉了 ——
   那一整个页面生命周期就再也不注册这个 tab（连「+」菜单里都不会出现）。现在改成每 500ms 重试、
   最多 60 次（约 30s），拿到服务后再 `registerTab`。
2. **「上次关过就不再自动弹」的偏好反而在跟用户作对**。现在**启动必定尝试打开**那一栏（忽略该偏好），
   关闭只对当前这次会话生效；偏好键仍会写（`dsh.mind_map.sidebar-tab.v1`），仅作诊断用。

开 tab 本身也还是「轮询到真的挂载为止」（`MapSidebarTab` 的 effect 置 `mounted`，1.2s × 20 次），
因为 better-sidebar 的 `openTab` 在面板/会话还没就绪时会静默失败。

实测：新窗口 + 清掉偏好 → tab 注册、地图挂载、左下入口在、无 console error；
把偏好手动写成 `0` 再刷新 → **仍然自动打开**（旧行为下这里会空着）。

---

## 11. 部署到远端 DSH（10.10.40.32，2026-11-10）

远端环境：Ubuntu 24.04，DSH **0.2.2-rc.1**，`dsh` 来自 linuxbrew（node 24.10），跑 user systemd 服务
`dsh.service`（`dsh web`，监听 127.0.0.1:3080），profile = **web**，已装 `dsh-better-sidebar@0.30.1`。

安装步骤（不走 registry，用本地打出来的 tgz）：

```powershell
# 本机
cd C:\Users\suma\Documents\DSH\mind_map
npm pack --pack-destination $env:TEMP\mind_map-pack
# 上传到远端的稳定路径（不要放 /tmp，重启会被清）
```

```bash
# 远端
mkdir -p ~/.dsh/profiles/web/vendor
cp /tmp/mind_map-0.1.66.tgz ~/.dsh/profiles/web/vendor/
export PATH=/home/linuxbrew/.linuxbrew/bin:$PATH
dsh plugin --profile web add file:/home/mgter/.dsh/profiles/web/vendor/mind_map-0.1.66.tgz \
  --registry=https://registry.npmmirror.com
systemctl --user restart dsh
```

要点：

- `dsh plugin … add` 就是「在 profile 目录里跑 pnpm add」，所以 tarball 里的 `dependencies.zod` 会被一起装；
  并且因为包里有 `dsh.bundle`，CLI 会**自动把它加进 `dsh.profile.bundles`**（这次实测确实自动加了）。
- 重启用 **user 级** systemd（不需要 sudo）：`systemctl --user restart dsh`。
- 访问地址带一次性 token：`journalctl --user -u dsh | grep "dsh web:"` 里看。

验收（本次实测）：

| 项 | 结果 |
|---|---|
| 服务 | `systemctl --user is-active dsh` = active，127.0.0.1:3080 返回 200 |
| 客户端 bundle | 聚合 `/plugins/??…` URL 里已含 `mind_map/client.js` |
| 配置 | `dsh --profile web --dump-config` 命中 3 处 mind-map |
| 界面 | `mind-map:map` tab 注册、右栏自动出现「思维图」、画布正常出卡、**0 console error** |
| 数据 | 远端新建 `~/.dsh/storages/mind_map.json`（unit mind_map v1，55 卡） |

> 远端还留着旧的 `talk_map.json`（11-06，7KB），没动。要搬旧位置/摘要：
> `node migrate-storage.mjs talk_map mind_map --force`（会改写 unit 头、保留旧文件）。

---

## 12. 最终定名：mind_map / 思维图（2026-11-10）

再改一次名，这次是最终形态：

| 层 | 最终值 |
|---|---|
| 仓库 / npm 包 | **mind_map**（GitHub: `MGter/mind_map`，本地目录 `Documents\DSH\mind_map`） |
| 界面名 | **思维图**（i18n `map.title` / `map.toggle`，**不再带 ·v2**） |
| cordis 插件行 | `id: mind_map` / `name: mind_map` |
| 侧栏 tab id | `mind_map:map`（面板 id 同） |
| 存储单元 | `mind_map`（不变，数据零迁移） |
| 浏览器偏好键 | `dsh.mind_map.*`（启动时把 `dsh.talk-map.*` 与上一版 `dsh.mind-map.*` 一次性迁过来） |

实现方式：`RENAME_PAIRS` 增加 `["对话地图","思维图"]`、`[" ·v2",""]`、`["·v2",""]`，
第一对目标改成 `mind_map`；源码侧另有一次性替换（`dsh-mind-map`→`mind_map`、`dsh.mind-map.`→`dsh.mind_map.`、
CSS module 文件改名 `mind_map.module.css`）。`mind-map.module.css` 之类的旧文件名/注释仍在注释里出现，
不影响产物（产物里 `dsh-talk-map` / `dsh-mind-map` / `对话地图` / `·v2` 计数全为 0）。

### 12.1 安装形态（本机 + 远端）

- 本机：`~\.dsh\profiles\desktop\vendor\mind_map`（源）＋ `node_modules\mind_map`（junction），
  dependency `"mind_map": "file:./vendor/mind_map"`，bundles 里 `mind_map`。**换包名后要重启桌面端**。
- 远端 10.10.40.32（profile web）：`~/.dsh/profiles/web/vendor/mind_map-0.1.66.tgz`，
  `dsh plugin --profile web add file:…` + `systemctl --user restart dsh`。
  ⚠️ 同名同版本 tgz 覆盖后 pnpm 会信任 lockfile 不重装 —— 必须**先删 `node_modules/mind_map`
  与 lockfile 里的条目**（或换文件名）再 add，否则装回去的还是旧内容。

### 12.2 已知小尾巴

- 改名**之前**已经开着的侧栏 tab，标题是 better-sidebar 创建时存下的旧文案
  （「对话地图 ·v2」/「思维图 ·v2」），关掉再开就是「思维图」；better-sidebar 没有枚举
  已开 tab 的公开 API，暂不自动刷新。

---

## 13. 全局视图：跨对话保持同一张图 + 重排后自动缩放（2026-11-10）

用户要的是「一套全局的思维图」：在不同对话之间跳，图不跟着换。三处配合实现：

1. **聚焦锚点钉住**（`dsh.mind_map.focus-anchor.v1`）：以前每次渲染都取 `currentSessionId()` 当锚点，
   一跳会话就换中心。现在锚点持久化，只有板上没这张卡、或用户**点一次「聚焦」按钮**时才重新锚定。
2. **成员没变就不重排**（`dsh.mind_map.layout-signature.v1`）：面板重挂时如果可见集合和上次收敛时一致，
   就不重跑布局、不动镜头，直接按原样画。
3. **切对话自动开栏**：tab 在 better-sidebar 里按会话存，切过去没有「已开」记录；现在监听
   `subscribeState` 的 sessionId 变化补开一次，外加 2 秒轮询兜底。

配合相机持久化（`dsh.mind_map.graph-camera.v1`），切换对话后看到同一张图、同一个缩放位置。

### 13.1 「⟲ 重新排布」后自动缩放到合适大小

`mindMapFitKick` 钩子：重排写完坐标先 fit 一次（250ms 缓动），收敛提交后再 fit 一次。
实测（7 张可见卡）：重排后 zoom 0.168 → 0.176，可见卡 7/7 全在视野内。

### 13.2 如果还不够「全局」

当前是「每个会话一个 tab，但内容/镜头/布局完全一致」。要做到**同一个 React 实例**常驻（连一帧都不闪），
需要把 `MapCanvas` 挂到自建持久 root + 按需把 DOM 搬进侧栏占位（createPortal / DOM move），
要引入 `react-dom/client` 并自己管容器尺寸——目前没做，因为切会话时状态已从持久化恢复，肉眼无差别。

### 13.3 真·单实例（2026-11-10 追加）

上一版是「每个会话一个 tab + 持久化恢复」，用户实测拖动后跳会话仍会弹回。改为**真单实例**：

- 用 `require("react-dom/client").createRoot` 在模块里创建**一个**持久 root，渲染 `<MapCanvas />`；
  组件（力导向模拟、相机、悬停、选中）**永不卸载**。
- 侧栏 tab 只渲染一个空的占位 `.tm_sbHost`；tab 挂载时把宿主节点 `appendChild` 进去（DOM 搬移，
  React 实例不变），切会话 = 关 tab + 开 tab = 换占位，**不是重建**。
- 中间栏「全屏」时把宿主摘下来（同一时刻只一处可见），返回时再挂回去；状态照样保留。
- `createRoot` 不可用时自动回退成原来的内联渲染（`mindMapSingleton.supported` 判定）。

实测：给宿主节点打 `data-probe="instance-1"`，拖动卡片→关掉 tab→重开，标记仍在、
相机字符串一模一样、卡片坐标（177,722）没回弹、可见集合不变。

### 13.4 「跳转时卡死」的排查结论（2026-11-10）

现象：切对话时思维图有时候整个界面卡住。排查步骤与结论：

1. 单实例本身没问题：全屏开关往返、关 tab 再开，宿主节点标记（`data-probe`）一直在，
   相机/坐标不变，60fps。
2. **连续调用 `openTab` 是元凶**：连打 6 次 `betterSidebar.openTab({type:"mind_map:map"})`
   之后，整页帧率从 **60 → 1 fps** 并且**不恢复**；把地图宿主从 DOM 里摘掉（地图完全不渲染）
   帧率仍然是 1 —— 说明不是我们的地图在烧 CPU，而是 better-sidebar 自己进入了每帧重排/重算
   的状态（同一类型 tab 被反复打开时触发）。
3. 我们的「切会话自动补开」正好会走到这条路径：切几次会话 = 连打几次 `openTab`。

修复：

- **开栏限流**：`mindMapSidebarSeat.lastOpenAt`，8 秒内最多真正调用一次 `openTab`（`opens` 计数可观测）。
- **已在屏就别开**：`document.querySelector('.tm_sbPanel .tm_graphSurface')` 存在时直接返回 true，
  不再产生新 tab。
- **轮询幂等**：`window.__mindMapWatchTimer` 先清再设，模块被重复求值也不会叠加定时器。
- **detached 时不画不跑**：`animate()` 里 `root.isConnected !== true` 直接返回，宿主被摘下
  （全屏接管、换占位过渡）时不再往 0 尺寸容器里循环绘制。

代价：切对话后如果 8 秒内又切一次，那一栏可能暂时是空的（防卡死优先）。

### 13.5 彻底不自动开栏：改为「点我打开」占位按钮（2026-11-10）

既然连打开栏会把 better-sidebar 拖进 1fps，那就**一次都不自动开**：

- 删掉启动时的自动 `openTab`、会话切换的补开、以及 2 秒轮询（`ensureSeat` 整个移除）。
- 右栏没有思维图时，右上角浮出一个占位按钮 `🧠 打开思维图`（`data-mind-map-launcher`，
  1.5 秒巡检一次显隐）；**只有点它**才调用 `openTab`，并且 1.5 秒内连点只算一次。
- `registerTab` 照旧注册（这样「+」菜单和左下入口都在），只是不再主动打开。

实测：新开页面 `mindMapSidebarSeat.opens = 0`（旧版启动即 1）；手动摘掉面板后按钮
`display: flex`；点一下 `opens` 变 1，全程 60fps 无卡顿。

### 13.6 同一会话出现多张卡（2026-11-10 修复）

现象：某个只有 2 个子代理的会话，在地图上冒出 4~5 张子代理卡。

排查：直接读 `~/.dsh/storages/mind_map.json`，按 `sessionId` 分组 ——
`4150cc42…` 有 **5 张**卡、`0a55f112…` 有 2 张，全盘 120 张卡里有两个 session 重复。
原因：**两套补卡逻辑并存**——上游的自动同步（每个工作区补缺卡）和我加的子代理补卡
（`subagent-place-cards`）都在「发现没有卡就建一张」，两边各建一次；加上卡片写入是异步的，
新挂载时前一次还没落库，就会再建一张。

修复：模块级 `mindMapDedupeCards()` —— 读 `canvas.get().cards`，按 `sessionId` 分组，
只保留 `createdAt` 最小的那张，其余 `canvas.removeCard()`（连线随卡删除）；启动后
2.5s / 7s 各跑一次（store 是异步加载的）。

实测：120 → **115** 张卡，图上 `sessionId` 重复数 **0**，无 console 报错。
（注意：子代理再生子代理是**不同 session**，各自一张卡是对的，不算重复。）

### 13.7 「点了打不开」的三重兜底（2026-11-10）

占位按钮点了却没反应，最可能是**当前没有选中会话**：better-sidebar 的 tab 必须挂在会话上，
`openTab` 在没有会话时静默失败（返回 false，页面上什么都不发生）。补了三层：

1. `mindMapOpenSidebarTab` 返回 false 时，**兜底切到中间栏全屏面板**（`openMapPanel()`，不依赖会话）。
2. 点按钮后 2.2 秒还看不到 `.tm_sbPanel .tm_graphSurface`，再兜一次中间栏。
3. **自愈挂载**：每 1.5 秒巡检——面板在、但地图宿主没挂进去（换占位漏挂 / 被摘下），就补挂一次；
   宿主还没创建过则顺手 `createRoot` 建出来。

实测：强制把宿主节点从 DOM 里摘掉，4 秒内自动挂回（canvas 810px 复原）；全程无 console 报错。