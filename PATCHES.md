# 本地改造记录（非上游内容）

上游：`github.com/Tasihi89/mind_map`（npm `mind_map`）。
本目录是 link 进 desktop profile 的本地副本，以下改动都在上游 0.1.0 基础上手工完成。

## 先读这条

**作者发新版时不要直接更新。** 本目录已经和上游差了很多版本、也改了核心代码，
升级会把下面整份改造覆盖掉。做法：先拉到临时目录做 diff 评估（改了哪些文件、
有没有和本改造打架），评估结论出来再决定合并方式。

## 怎么构建

上游的 `tsdown.config.ts` 没打进 npm 包，所以这个 checkout 原来**无法重建**
`client/client.js`，只能手改打包产物。现在有了一条可复现的替代链路：

```bash
npm run build:client        # scripts/build-client.mjs → client/client.js
npm run harness             # http://127.0.0.1:8791/test/index.html 离线测试台
```

`scripts/build-client.mjs`（esbuild）复刻了宿主要的契约：

- 单行 loader 抬头 `window.__ModuleLoader__.load({ id, factory })` + `factory` 返回 `module.exports`；
- `react` / `react-dom` / `react/jsx-runtime` 保持 external（宿主 `require` 注入）；
- 每个 `.css` 编译成内联 `<style data-plugin-css>` 虚拟模块（等价宿主的 `\0dsh-css:`），
  class / `@keyframes` 加 `tm_` 前缀，`styles.x` 名字表与 CSS 一起生成；
- 产物里不允许出现绝对构建路径（脚本自带断言）。

宿主侧 `lib/index.js` 原本没碰过；**2026-10-26 起动过一次**（上游这个包不附带
`tsdown.config.ts`，宿主半没法重新构建，只能手改打包产物）：新增 `POST /mind-map/last-user`
路由（卡片正文用），以及给 `runtime` 注入 `sessionQuery` 的那个 `ctx.inject` 块
（`scripts/_.host-sessionquery.mjs` 是当时插 inject 的一次性脚本，带幂等判断）。
`src/host/routes.ts`、`src/index.ts` 已按同一份逻辑同步，将来能重建宿主时以 src 为准。

### 硬规矩：运行中的宿主不能看到 client.js 变化

2026-10-26 三次崩溃全部同一个出口，最后一次拿到了实证：

`
dsh-app://app/plugins/??mind_map/client.js&rev=...:10
[mind_map] client bundle evaluated 2026-10-26T15:20:25.257Z   ← 求值成功
→ 23:22 重载: mind_map: import failed → web boot 判定失败 → 退出
`

- **bundle 本身没问题**（求值成功，语法校验也通过）；
- 问题是**我在宿主运行期间重建了 `client/client.js`**：只要这个文件变了，下一次重载就加载不进来，而宿主把"有插件没激活"当致命错误直接退出；
- 装插件/启用插件只是**触发那次重载**，真正的前提是"文件被换过"。

从流程上根治：

- `node scripts/build-client.mjs` → 只写 `client/client.dev.js`（测试台 `test/index.html` 加载它），**绝不碰** `client/client.js`；
- `node scripts/build-client.mjs --publish` → 才原子替换 `client/client.js`；
- 规则：**publish 之后必须重启宿主**，且重启前不要再 publish 第二次。
- `.gitignore` 忽略 dev 产物。
### 崩溃兜底：一个插件不许拖死整个 boot

宿主对"有插件没激活"的判定是**致命**的：装完插件会触发一次整页重载，重载里
`mind_map: import failed` 会让它直接退出（`~/.dsh` 外层的
`logs/crash-*-web-boot.log` 里只有一句汇总，拿不到具体异常）。

冷启动能过、重载过不了——所以 bundle 的**求值阶段**必须绝对安全：

- 打包器在 factory 外面套了 `try/catch`：任何求值异常都降级成**惰性模块**
  （`{ name, apply() {} }`）并 `console.error` 出原因，绝不向外抛；
- 新增 `test/bundle-smoke.mjs`：在**同一个 realm 里连续求值两次**（模拟重载），
  断言两次都不抛、两次都注册了同一个 id——这条是"模块作用域可重入"的守门人；
- 注意：这只是**把致命变可恢复**，根因（为什么重载时这一个 entry 建不出 fiber）还没定位，
  需要那次重载的 renderer 控制台原始异常才能修。
**改完必须重启 DSH**：client bundle 在宿主启动时汇总下发，F5 拿不到新文件。

## 离线测试台（`test/`）

`test/index.html` + `test/harness.js` 用真浏览器加载**构建产物**，喂假 cordis context
（sessions / workspaces / connection / uiWorkspace）和假 `/mind-map/*` 接口，不重启、
不动真实数据就能验证交互：

- `window.__harness.nodeBoxes()` — 卡片 / 工作区的屏幕坐标（布局断言用）
- `window.__harness.posts` — 客户端发出的每个 POST body（持久化断言用）
- `window.__harness.log` — `startSession` / `openSession` 调用记录

`test/` 不在 `files` 白名单里，不会随包发布。

## 改了些什么

### 1. 顶部：返回 / 语言 / 关闭

`MapOverlay.tsx`：删掉标题（`思维图`）和会话计数徽标。左上「‹ 返回」（38px 高），
右上 语言 + ✕（34~38px）。返回与 ✕ 同动作。

表头**不再沿用遮罩层的 top inset**（`--dsh-frame-overlay-top`）——那是给浮在标题栏
下面的 overlay 用的，放到主面板里纯属在顶上留一条死白，已去掉。

快捷键那个 `⌥F` 药丸按钮已按要求删除（`alt+F` 这个绑定本身还在，只是没按钮了）。
曾经加过的 ⛶ 全屏按钮也因效果问题移除了。

### 2. 工作区 = 可伸缩的文件夹，卡片按固定槽位吸附

新增 `src/client/grid-layout.ts`（纯函数，可单测）：

- 文件夹宽度决定列数（`colsForWidth`），卡片落在 272×176 的槽位上，**永不重叠**；
- 尺寸以用户为准：至少一列、至少一行；装不下就折叠（见 2b），不再自动长高；
- **顺序 = 画布阅读序**：拖动可以改位置/顺序；**活跃会话会自动顶到开头**
  ——某个会话的 `updatedAt` 往前跳（刚发完消息、刚开始跑）就把它的卡提到本文件夹
  置顶块之后的第一个位置，只提一次；置顶的卡永远在前；新导入的卡不算"活跃"；
- 位移动画由 CSS 完成：`.react-flow__node` 有 200ms `transform` 过渡，被拖的那张卡
  带 `tmDragging` 类例外（1:1 跟手）。

**八个把手**（`WsFrame.tsx` + CSS）：四边 + 四角都能拉，西/北边拖动时原点跟着走、
对面那条边不动；拉到最小尺寸时按你正在拖的那条边为锚点夹紧。

`MapCanvas.tsx`：

- 渲染位置由布局推导（`cardLayout`），拖动中只有被拖的卡用真实坐标；
- 一个「对齐 effect」在非手势期间把推导结果批量写回 store（`canvas.moveCards`，
  一次 undo 帧、一次 POST）；拖动 / 伸缩进行中不写，避免和指针打架；
- 右侧 / 底部 / 右下角三个把手（`WsFrame.tsx`）拖动即伸缩，**伸缩过程中成员跟着
  实时重排**，松手才落盘；拖标题只改文件夹矩形，成员按槽位自动跟随（不再逐张平移）；
- `LAYOUT_VERSION` 3 → 4：首次打开时给有卡片的组补一个矩形，随后卡片被吸到槽位上。

### 2a. 打开即自动同步，新会话进开头

每次打开地图，每个已在地图上的工作区都会自动把"还没有卡片"的会话补进来——
**补到文件夹最前面**（它等同"刚发了一条消息"，不是排到队尾）；同一批里按 `updatedAt`
从新到旧。右键那条手动同步已移除。

### 2a2. 打开时也会给"新工作区"长出文件夹

自动同步原来只往**已有文件夹**里补会话；新出现的工作区（导入会话、换了 cwd）没有文件夹，那张卡就无处可放、等于看不见。现在打开地图时：

- 扫出"有会话但没有文件夹"的工作区（最多 6 个，每个最多 9 张卡）；
- 在现有文件夹**下方**留出空位，新建一个文件夹（`fitRect` 按卡片算尺寸）并落盘；
- 新文件夹不会叠在已有文件夹上（探针断言：`新文件夹不和已有文件夹重叠`）。
### 2b. 装不下 → 右下角堆叠格子 + 抽屉

文件夹尺寸现在**完全由用户决定**（不再为了装下卡片自动长高）：

- 可见容量 = 列数 × 行数（`capacityFor`），超出的卡片折叠；
- 最后一个可见格子变成**堆叠格**（`StackNode.tsx`）：两张错位的垫片 + 最新一张折叠卡
  的标题 + `+N` 计数，位于文件夹右下角；
- 点它打开**抽屉**（`StackDrawer.tsx`）：列出这个工作区**全部**对话，卡片按 **1:1**
  （224px，就是地图点「1:1」时的大小）排成**多列网格**（`auto-fill`，1120px 宽的面板
  一般能放 4 列；面板宽度 `min(1120px, 94%)`、高度 84%），滚轮一格翻**一行**
  （原生 non-passive 监听 + `scrollBy` + `scroll-snap`），点卡片进对话，Esc / 点背景 / ✕ 收起；
- 折叠的卡只是 `hidden` 节点：连线、选中、位置都还在，把文件夹拉大就自动回到网格。

### 2b2. 「待发送」黄标

对话的输入框里还有没发出去的文字时，卡片（和抽屉里的同一张）右下角多一枚**黄色**胶囊
「待发送」，和状态胶囊并存。

数据来源：宿主把每个会话的草稿持久化在 `localStorage["dsh.conversation.<sessionId>"]`
（`{ draft: string | { text, references }, view }`），没有对应的 client service 或投影，
所以 `src/client/draft-watch.ts` 直接读同一份存储；同一文档内的写入不会触发 `storage`
事件，于是面板开着时每 1.5 秒重读一次（内容没变不 publish）。清空/发出后灰标自动消失。

### 2b3. 跨重启保留灯的状态

草稿本来就在 localStorage（上面那条），另外三类**只存在于客户端订阅里的灯**也落到了本地，
放在 `dsh.mind_map.lamp-state.v1`（`src/client/state-persist.ts`；不改宿主 schema，
`MapGlobal` 是 zod 校验的、未知字段会被丢掉）：

| 状态 | 怎么来 | 重启后 |
|---|---|---|
| 已完成待读（绿） | running → 不在跑 的跳变 | 保留；你点开 / 它又跑起来 / 变成等你回复 时清除 |
| 异常终止（红） | 宿主 `api-session/error` | 保留；同上清除 |
| 已中断（暗琥珀小标） | `beforeunload` 时仍在跑的会话 | 保留；重启后它若已不在跑，就显示「已中断」 |

两个细节：
- **恢复出来的标记**在同一次会话里观察到 `retainedBy.mainView > 0`（也就是正好开在屏幕上）
  会立刻清掉——避免每次启动都把上次的绿标全糊一遍；运行期新产生的标记不受这条影响
  （这正是"从对话打开地图"那种情况不被误清的原因）。
- 写入是 250ms 防抖 + `beforeunload` 强制 flush；超过 14 天的旧标记在读取时丢弃。

### 2b4. 卡片正文 = 用户最后发的那句话

原来的正文是宿主用 LLM 生成的摘要。现在**不再显示摘要**，改成**你最后一次发进去的那句话**
（最多 240 字），「重新生成摘要」的按钮和右键菜单项也一起去掉了。

- 数据来源：宿主侧的 `POST /mind-map/last-user`（`{sessionIds}` → `{texts}`），直接读会话
  表面里的 `user/message`（跳过 `source.kind === 'tool'` 的工具结果，最后一条胜出），
  不花钱、不等模型；
- **判据只有一条：`source.kind === 'user'`。真实日志里宿主给每条用户消息都标了来源：
  `time-context`（Time sampled…）、`runtime-context`（Current runtime context…）、
  `dsh-mnemon`（MNEMON 快照 / [MNEMON] Search Documents…）、`skill-catalog`（system-reminder）、
  `model-selection`（[model changed: …]）、`dsh-rewind`（(empty message)）、
  `compact-checkpoint`（automatically generated checkpoint…）、`user-approval`（审批策略变更）、
  `tool-jobs`（background job …）、`tool`（工具结果）——**只有 `user` 是人写的**。
  所以不再靠正则猜文本：新版本宿主再造什么类型，都自动被排除；
- 离线普查脚本 `scripts/_.audit-previews.mjs`：遍历全部会话（跳过 `origin: subagent` 的子代理会话），
  打印每张卡会显示的正文；当前结果 **19 个人类会话 0 条可疑**；
- 缓存存**原文**、渲染前才清洗，规则一变旧缓存也跟着变；- 客户端：卡片一出现就**立刻踢一次**请求，之后每 1.5s 轮询补齐。**不要用 debounce**——
  真实应用每秒都在刷新会话列表，每次刷新都会重置定时器，请求永远发不出去（这条踩过一次：
  测试台补了"列表高频刷新"的判别用例，旧代码返回 `null`、新代码通过）；
- 宿主：每个会话读一次 surface 约 250ms，**改成并发**（`Promise.all`），21 张卡从 ~5s 降到
  几百毫秒；
- **本地缓存（关键）**：正文落在 `localStorage["dsh.mind_map.previews.v1"]`，
  `sessionId → { text, stamp }`（stamp 就是会话的 `updatedAt`，最多 300 条，超出按 stamp 淘汰）。
  打开地图时**先用缓存画**（`useState(readPreviewTexts)`，同步、零等待），
  再只对 stamp 变了的会话去宿主补一次并写回缓存——"打开就有 + 后台同步"，不是每次全量重拉；
  判别用例：把接口拖到 2s，热缓存下 500ms 内卡片已有正文（冷缓存则没有，但 2s 后仍会被刷新填上）。

### 2b5. 压暗 / 粒子

（粒子汇入效果试过两版都嫌廉价，**已整体删除**，探针里有「粒子效果已移除」的断言。）

- **没有任何状态的卡片**（无灯、无待发送、无已中断）整体压暗到 `opacity: .62`，鼠标悬浮
  140ms 内回到 1；**堆叠格子也一样压暗**（里面有东西在报状态时，只把 `+N` 徽标染成琥珀色，
  不整块发亮）；
- **运行中**：白光调亮（内描边 .34 / 16px .2 / 40px .1）+ 外沿流光环。
  （试过"粒子汇入"，看着廉价，已整体删除，探针里也加了"粒子效果已移除"的断言。）

### 2c. 灯：运行中"流光"，其余"呼吸"

`mind-map.module.css`：

- **running**：卡片本体是**恒定白光**（内描边 + 光晕，**没有呼吸动画**）；真正的信号是卡片
  外沿一圈 **2px 光环**，用 `conic-gradient` +
  `mask-composite: exclude` 抠成环，然后**只让渐变的起始角转动**
  （`@property --tm-ring-angle` + `@keyframes mindmap-ring-sweep`）——所以是"光在环上跑"，
  不是"框在自转"。这个坑踩过一次：最初给 `::after` 加 `transform: rotate()`，转的是圆角矩形本身。
- **waiting / error / done**：都是**呼吸灯**（琥珀 3.4s / 红 1.9s / 绿 2.8s）。

**状态文字跟灯同步**：卡片右下角的胶囊由 `glow` 决定文字与颜色，不再各自为政：

| lamp | 文字 | 颜色 |
|---|---|---|
| running（微弱白光 + 流光环） | 正在运行 | 白 `#fff` |
| waiting（琥珀呼吸） | 等你回复 | 琥珀 `rgb(245,178,46)` |
| done（绿呼吸） | 待查看 | 绿 `rgb(52,199,89)` |
| error（红呼吸） | 异常终止 | 红 `rgb(242,78,78)` |

抽屉里的卡片复用同一套（`LAMP_CHIP` 由 `SessionCard.tsx` 导出）。

### 3. 双击 / 右键：都以点击处的工作区为准

- 双击空白canvas：新对话（工作区选择器默认值不变）；
- 双击某个工作区的**任何部分**（标题、边框、透明内部）：**跳转到系统的新建对话页面**，
  并把该工作区带上（`uiWorkspace.startSession(workspaceId)`）；
- **右键同样**：文件夹内透明处右键 → 菜单项直接写成「新对话（日常任务）」；文件夹标签
  右键的菜单也加了「新对话」，落到该工作区；
- 地图里**不再有内嵌草稿面板**（`DraftCard.tsx` 已删除）：模式（标准/创造/自定义/…）、
  模型、发送全交给系统那个页面，所以模式列表就是系统那套，不会只有两个；
  同时也不会再出现"发送后没反应"——那是草稿面板用 `startSession` 只预填不发送导致的。

### 3b. 右键菜单：置顶 / 归档 / 删除 / 批量

- **置顶 / 取消置顶**：调 `uiWorkspace.pinSession/unpinSession`，和侧栏的置顶是**同一个**
  pin（状态来自 `workspaces.list.pinnedSessionIds`，双向同步）；被置顶的卡片在文件夹里
  永远排最前，活跃提前不会顶掉它；
- **归档**：`uiWorkspace.archiveSession(id, { stopActivity: true })`，成功后卡片离开地图；
- **删除会话**：POST `dsh-session-recycle-bin/api`（`{action:'trash'|'trashMany'}`）——
  和回收站插件自己的删除对话框走同一个 Host 路由，进同一个回收站、同样可还原；
- **批量操作**：进入批量模式后**每张卡右上角出现勾选框**，单击卡片即勾选（再点取消），
  勾中的框变实心打勾；底部工具条给出「归档 / 删除 / 取消」，删除一次提交 `trashMany`。

### 3c. 单击卡片即跳转

`onNodeClick` 里 sessionCard 直接 `openSession`（原先是双击）。批量模式下卡片的点击被
`onPick` 接管（`stopPropagation`），所以勾选不会误跳转。因为单击不再用于"选中卡片"，
删除/归档等动作走右键菜单。

### 3d. 只有工作区能上色

卡片不再有颜色；**工作区**有：左键点标题栏或边框选中后，画布左上角弹出颜色工具条，
改的是 `wsColors[workspaceId]`，只渲染在**边框 + 标题栏**上——**文件夹内部的填充区域
不跟着变色**（内部始终保持画布底色，颜色不会洗到卡片上）。选别的对象或按 Esc 取消选中，
工具条随之消失。

### 3f2. 置顶的卡片：原样显示 + 置顶图标

- **不压暗**：`quiet` 的判定里加了 `pinned !== true`——置顶是你主动做的选择，不该被淡掉；
- **图标**：标题前 11px 的图钉（内联 SVG，`data-mindmap-pin`），抽屉里的同一张也用（📌），标题 `card.pinned`。
### 3f. 当前对话的卡片：四角瞄镜

打开地图时，**你原来所在的那个对话**的卡片四角各画一个 **13px 的白色 L 形角标**
（`.cardReticle` 里 4 个 `i`，每个只留两条边），外面再加一层 `drop-shadow` 柔光——
像瞄镜那样只框住四角，不是整圈边框。它同时不参与"无状态压暗"。

会话 id 来自宿主持久化的 `localStorage["dsh.sessions.current"]`（`openMapPanel()` 在
切面板**之前**先记一份，`currentSessionId()` 每次渲染再实时读一次兜底——面板选中后这个键可能被改写）。

### 3g. 右键：标为未读

卡片右键多一项「标为未读」，效果和"跑完没人看"完全一样（绿光 + 待查看胶囊），
数据走 `sessionActivity.markFinished()`，同样落盘、同样在点开对话时清除。

同时**删掉了**右键菜单里的「打开对话」（左键单击已经能开）和「从地图移除」
（删除会话/归档已覆盖）。

### 3e. 标题栏盖过顶边把手

`.wsFrameLabel` 给了 `z-index: 5`（把手 2~3）：标题栏和顶边把手重叠的那一小块，拖动
永远是**移动整个工作区**，不会被顶边把手截走；要调高度用顶边左右两段或上方两角。

### 4. 地图从"全屏遮罩"改成"主面板窗口"（修 unread 不发光的 bug）

原来注册在 `shell.overlay`（覆盖全屏），对话一直挂在下面 = 一直被当成"你在看"，
所以开着地图时完成的会话永远不会变成待读，卡片也就不发光。

现在注册进 `main` 槽位（`key: 'mind-map'`），和插件市场、回收站、Plugins 页同一个座位：

- 打开 = `ctx.layout.selectPanel('mind-map')`，关闭 = `selectPanel(null)`（回对话）；
- 侧栏按钮 / 快捷键 / 左返回 / 右上 ✕ / Esc 全部走这一条通道；
- 地图在时**没有会话被选中**，宿主自己的 unread 逻辑因此正常工作，卡片能亮；
- 点在卡片上打开对话：先 `openSession`，再 `selectPanel(null)`；
- 面板挂载/卸载就是真实开关状态，`mapUi.open` 只是它的镜像（侧栏按钮高亮用）。

### 4c. "跑完了没人看"：地图自己的待读投影

宿主只在会话**不在主视图**时才把它标成 unread。可"从某个对话里打开地图"时，那个会话
仍是当前会话（宿主眼里你还在看它），于是它跑完之后不会变待读，卡片也就不亮。

所以插件自己记一份（`src/client/session-activity.ts`）：

- 地图开着时盯每个会话的 `running`，**running → 不在跑** 就算"刚跑完"，标成待读；
- 这个标记只在**地图开着**的观察里产生；地图关着时的完成仍交给宿主自己的 unread；
- 清除时机：它又跑起来 / 变成等你回复 / **你从地图里点开了它** / 会话被删；
- 灯序不变（error > waiting > running > done），`done` = 宿主的 `completionUnread`
  **或** 地图自己的 finished 集合。

### 4b. 侧栏跟着地图收放

`ctx.layout` 只有 `toggleSidebar()`、没有读状态的口子，所以由侧栏底部这个插件自己的
按钮回报 `wide`（它本来就从 owner props 拿到）：地图打开时若侧栏是展开的，就收起一次性；
面板卸载（返回 / ✕ / Esc / 点卡片进对话 / 发消息离开）时再展开回来。用户本来就把侧栏
收成轨道的话，不动它。

### 4d. 左栏插件入口（`sidebar.panellist`）

左侧那排「插件 / 自动化任务 / 上下文洞察 / 任务看板 / 记忆系统 / SSH」是壳的
`sidebar.panellist` 插槽，**不会自动收录插件**——每个插件自己注册一行。地图原来只注册了
底部切换按钮（`sidebar.footer.action`）和 better-sidebar 的右栏 tab，所以那一排里一直
看不到它。

- 新增一行：`selectPanel` 用的同一个 key —— `registerSafely("sidebar.panellist", () =>
  ctx.slots.register({ name, id: MAP_PANEL_ID, order: 35, label: () => t("map.title") },
  MindMapPanelIcon))`。
- 行的 `id` 必须等于 `main` 面板的 `key`（都是 `MAP_PANEL_ID`）：壳按 id 把行绑到同 key 的
  面板，点行就是切过去；行框、标签、tooltip、active 高亮、折叠 rail 全由壳负责，插件只画
  16px 的 glyph（带 `data-dsh-panel-entry` 供皮肤按行反查，和 dsh-ssh 的写法一致）。
- 排序落在「记忆系统」(30) 与「SSH」(40) 之间。

### 5. 对角把手真正双向

右下角把手放大到 **26px**，东/南两条拖拽带**在离角 28px 处就截止**——以前 12px 宽的
边带会盖住角把手的左半边，抓住"角"实际上抓的是边，于是只有宽度跟着动。现在对角
一次同时改宽和高。

## 验收怎么跑

```bash
node test/grid.test.mjs     # 布局纯函数 10 项
node test/probe.mjs         # 无头 Edge 全链路 19 项（自己起静态服务 + 自己的 --user-data-dir）
```

`test/probe.mjs` 只驱动自己拉起的**无头 Edge**（临时 profile，独立调试端口），不碰
用户正在用的浏览器。断言覆盖：头部按钮尺寸/标题已删、卡片不重叠、时间倒序 + 行优先、
运行白光/完成绿光、面板模型（打开/返回/Esc）、拉宽重排、删卡补位、双击工作区新建 +
模式选择 + `agentPreset` 透传、零 JS 异常。


## 已知取舍

- 文件夹之间不做碰撞避让（两个文件夹可以叠在一起）。**叠住时，上面那个文件夹的边框
  会盖住下面那个的角把手**——挪开或先收窄即可；
- 文件夹高度不再自动跟随内容：装不下就折叠成堆叠格（这是设计，不是 bug）；
- 从草稿卡发出的新对话不会自动生成卡片（`startSession` 不返回 sessionId），
  仍要等它出现在侧栏后用「同步该工作区的新会话」。
