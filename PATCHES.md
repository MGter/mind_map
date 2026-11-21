# 本地改造记录（非上游内容）

上游：`github.com/Tasihi89/mind_map`（npm `mind_map`）。
本目录是 link 进 desktop profile 的本地副本，以下改动都在上游 0.1.0 基础上手工完成。

## 2026-11-19 · 大修：删掉卡片白板，只留云图

用户的要求是「做成 Obsidian 图谱那样，只是一个点，鼠标移上去显示标题」，并且
**「完全不再要之前的那个原始框图的模型了，只保留这种云图模型」**，所以这一轮
是减法：

- **白板 / 卡片模型整体下线**：`graphModeGet()` 恒为 `true`（localStorage 里
  旧值直接清掉），`GraphSurface` 只渲染 `GraphCanvasSurface`，顶栏的
  「🕸 图谱 / ▦ 白板」开关删掉。槽位布局、工作区框、溢出抽屉、分组药丸、
  卡片连线（React Flow）都不再挂载。
- **画布改成纯点**：删掉了卡片矩形的所有绘制（roundRect、标题/摘要/标签/
  角标/LOD 三档），换成 `arc()` 点。半径 = `1.7 + 1.3·√度数`（上限 11px），
  度数 = 当前可见边里连到它的条数。
- **标题只在悬停时出现**：画在屏幕空间（不受 zoom 影响），带圆角药丸底，
  带描边；聚焦（spotlight）时锚点也显示标题。
- **连线只剩三种**：`ws`（同工作区，冷灰）/ `tag`（同标签，蓝）/
  `lineage`（子代理·分叉血缘，暖橙）。`GRAPH_EDGES_BLOCK` 重写：不再造假
  的「分组节点」，同工作区直接互连；≤8（ws）/ ≤5（tag）全连接，更大的簇
  连成环，避免 n(n-1)/2 条边爆炸。
- **点不会重合**：硬芯 `collisionGap` 不跟 alpha 衰减；`commitSim` 前再跑
  一遍 `resolveOverlaps()`（纯几何，80 轮）。探针：`__mindMapDebug.overlaps()`。
- **正在跑的点缓慢闪烁**：呼吸光晕，周期约 3 秒（`sin(now/480)`）。
- **播种改成向日葵盘**（Vogel spiral）：全体重排时按度数从盘心排到边缘，
  避免从「白板那种一列/一块的旧坐标」出发时把整团压成香肠形；只有一两个
  新会话进来时就地落位，不推倒重来。收敛尾段对 >120 个点的图放慢退火。
- **画布代码抽成真文件**：`src/graph/graph-surface.js`（apply-patch 用
  `readFileSync` 注入 `${GRAPH_SURFACE_BLOCK}`），可以单独 `node --check`，
  不用再在 `String.raw` 里跟转义搏斗 —— 和 `live-activity.js` 同一套办法。
- **删掉的补丁点**（锚点已经不存在）：`group-visible-nodes`、`group-box`、
  `group-sim-anchor`、`group-repulsion-skip`、`group-integration-skip`、
  `group-draw-pills`、`group-skip-card-draw`、`fit-on-open`、
  `fit-tight-padding`（后两条的行为直接写进 `graph-surface.js`）。
- 验证：离线测试台 `?demo=1&many=160`（167 个点 / 640 条边）实测
  `overlaps() = 0`、span 739×810（各向同性）、控制台无 error；
  悬停出标题、点击打开会话、右键菜单、重新排布、聚焦、明暗两套主题都跑过。

### 2026-11-19 下午 · 关键词（tag hub）也上云图

用户补了一句：「那些关键词 key 是不是也加进来比较好？如果有重点的 key 的话
相关节点可以连线」。于是把「同标签会话两两互连」换成**关键词节点**：

- `tagNode`：一个标签 = 一个空心蓝环的点，id `tag-<标签>`，由 `graphTagGroups`
  派生（`tag-nodes` 补丁，在 `liveNodes` 之前算，追加进节点列表）。只有一个
  会话用到的标签不上图 —— 那不是 key，是噪音。
- 边改成二部图：`会话 —— 标签点`（`graph-tag-<标签>-<card>-tag-<标签>`），
  不再有会话之间的 tag 边。标签点度数 = 有多少会话用到它 ⇒ **重点的 key 天然
  更大**（真实数据里「备份」30 个会话 / 220 个标签里 69 个被 ≥2 个会话用到）。
- 标签点不落库（坐标是派生的）：`seatTagNodes()` 每次播种都按它连着的会话的
  质心落位，`commitSim` 跳过非会话节点。
- 标签点之间互斥更强（硬芯 ×3.2、电荷 ×2），否则共用同一批会话的 key 质心
  几乎重合、会挤成中心一团结节；到标签点的弹簧也拉长 16px，key 因此浮在
  簇里而不是被成员压进簇心。
- 交互：悬停显示 `#标签 · N 个会话`；**点一下标签点 = 钉住高亮**（它和它的
  会话保持明亮，其余压暗，鼠标移开也不取消，点空白处取消）。标签点不响应
  分叉手势，右键走面板菜单。
- 实测（`?many=160`，真实长尾标签分布）：216 个点（167 会话 + 49 标签点）、
  `overlaps() = 0`、悬停 `#备份 · 37 个会话` 时 37 条边全部点亮，`bundle-smoke` 通过。

### 发布前回归修复

- 签名匹配的重挂载不再重铺向日葵盘，只有旧布局版本失效或显式重排才重新播种。
- 按下节点时以模拟的实时位置设置拖动原点、偏移和固定位置，首个 move 始终携带有限坐标。
- 空闲同步只读取会话的持久化坐标，保留关键词节点已收敛的位置。
- 悬停不再截断运行态动画的刷新；浏览关键词整簇时临时暂停会话聚焦压暗，取消后恢复。
- 回归命令：`node --test test/cloud-surface.test.mjs`，5 项通过；旧客户端的对应逻辑 5 项均失败。

### 状态栏点不动、「待查看」消不掉（2026-11-19 修）

症状：状态栏（左侧「队列中的任务」）里的「待查看」条目点了没反应，也永远消不掉。

根因：`待查看` 来自两处 —— 宿主的 `completionUnread`（`dsh-client-ui-session`
的客户端投影，内存里的一个 Set）和插件自己的 `sessionActivity.finished`。两者
**都只在「这个会话变成主视图」时被清掉**（宿主 `reconcileStatus()` 里
`if (this.isMain(id)) this.completionUnread.delete(id)`；插件只在 `openSession()`
里 `acknowledge()`）。宿主没有暴露任何插件可调的 mark-read 接口（在 session 客户端
bundle 里 grep `markRead/markSeen/acknowledge` 全为 0）。而状态栏那行的点击只调
`focusCard()` —— 挪镜头 + 选中，从不打开会话，于是「点了没动静」，未读也一直留着。

修法（`status-rail-open` 补丁）：点状态栏一行 = `focusCard()` + `openSession()`，
和点圆点完全一致。必须先挪镜头再打开：宿主没有会话打开器时 `openSession` 会保住
地图不关，这时至少能看到它落在哪儿。补丁必须排在 `graph-bar` 之后，因为那条把
同一行 JSX 扩成了两行。

顺带记住：那两处标记都是客户端内存态，**刷新页面也会清空**（服务器重启同理）。

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


## 2026-11-11 切会话后地图「闪一下变黑底」（侧栏宿主被搬进隐藏面板）

现象：在右栏开着「思维图」时切到某些会话，地图显示一下就消失，只剩面板深色底；
之后刷新才好，切回原会话也不会自己回来。

根因（远端 10.10.40.32 实测复现，用无头浏览器读 DOM 拿到证据）：

1. DSH 壳把**非当前 session 的整个 pane 留在 DOM 里只加 `display:none`**
   （`P3OORG_session`），better-sidebar 的 tab body 也是 `keepMounted`。
   于是切过一次会话后页面上同时存在 2~3 份 `.tm_sbPanel`，其中只有一份看得见。
2. 单实例宿主每 1.5s 由 `mindMapMountLauncher.ensure()` 补挂，旧代码是
   `document.querySelector(".tm_sbPanel")` —— **文档序第一份，通常正是上一个
   session 的隐藏面板**。它把宿主 `appendChild` 搬进去 → 可见 tab 立刻空掉。
   搬完 `holder.contains(host)` 成立，后续巡检认为「已就位」不再动作；
   `MapSidebarTab` 的 effect 依赖只有 `[ui.open]`，也不会重跑。
3. 另外三处用 `document.querySelector(".tm_sbPanel .tm_graphSurface") !== null`
   判「已在屏」，隐藏面板里的 surface 照样查得到，于是
   （a）`openTab` 前置直接 return true、（b）`🧠 打开思维图` 占位按钮
   `display:none`、（c）点击后 2.2s 的兜底也不触发 —— 三条恢复路径全被掐掉。

修复（都在 `apply-patch.mjs` 注入的客户端块里，重跑 `node apply-patch.mjs` 生效）：

- 新增 `mindMapMapSurfaceVisible()`：遍历 `.tm_sbPanel .tm_graphSurface`，
  只有 `getBoundingClientRect()` 宽高都 ≥ 40 才算「看得见」；
  `openTab` 前置、占位按钮显示、点击兜底三处都换成它。
- `ensure()` 改成：遍历全部 `.tm_sbPanel`，跳过宽高 < 40 的隐藏面板，
  在可见的里面挑**最高**的那份（保留「谁大挂谁」），宿主已经在里面就什么都不做。
  一份可见的都没有 → 原地不动（绝不往隐藏 holder 搬）。
- `MapSidebarTab` 的「谁大挂谁」判定：`currentVisible` 改为看盒子
  （宽高 ≥ 40），不再用 `document.body.contains(host)` ——隐藏占位也算 contains；
  新占位挂载瞬间高度为 0 时不再静默放弃，改成 `requestAnimationFrame` 下一帧
  再确认一次（1.5s 巡检只负责「宿主被摘下」的场景）。

验证：`node test/bundle-smoke.mjs` 两次求值 PASS；远端替换后按同一路径复现，
宿主切会话后稳定留在可见面板（详见本轮对话记录）。

备注：版本号仍保持 **0.1.66**（用户要求）；本次只改客户端产物，`lib/index.js` 未变，
但 client bundle 在宿主启动时汇总下发，**换完必须重启宿主**（F5 拿不到新文件）。

## 2026-11-12 聚焦=高亮 / 子代理只连主会话 / 新会话实时上板

三件事一起改，全部落在 `apply-patch.mjs` 的客户端补丁里（`client/client.js` 重建产物），
版本号仍是 **0.1.66**，`lib/index.js` 未变（补丁跑完 hash 与线上一致）。

### 1. 聚焦（spotlight）：只点亮当前会话，其余压暗，不再隐藏

以前 `focusSet` 是一个 BFS 集合：只显示「当前会话 + 2 跳内相关卡」，其余 `hidden: true`，
边也一起过滤；再加一个「聚焦锚点」把它钉在第一次打开时的那张卡上。

现在（`focus-set` / `focus-center` / `graph-bar-props`）：

- 不再隐藏任何节点：`focusEdges = liveEdges`、`focusNodes = liveNodes`；
- 新增 `focusAnchorId`（当前会话的卡；当前会话不在板上就退化成最近更新的那张）；
- 绘制层拿 `props.focusAnchorId`：**被锚定的卡全亮 + 金边**，其余卡片 `alpha 0.26`、
  连线 `alpha 0.10`、分组药丸 `0.3`（悬停时临时提亮被悬停卡）；聚焦关掉即恢复；
- 按钮文案 `🎯 聚焦中`，title 说明新语义；`focusCount` 失去意义（=1），不再显示；
- 镜头：只响应「关 → 开」的那一次，把被点亮的卡居中（顺手关掉 400ms 自动取景守卫，
  否则它发现内容出界又 fit 回去）。**面板刚打开时不动镜头**，打开即 fit 的既有行为保留；
- `focusSet` / `FOCUS_DEPTH` / `mindMapFocusAnchor*` 都成了死代码（锚点不再 localStorage 钉住），
  留着不删以免补丁面再扩大。

### 2. 子代理只和自己的主会话连线

- 边构建（`GRAPH_EDGES_BLOCK`）：`byWorkspace` 跳过 `origin === "subagent"` 的卡 ——
  它不再连工作区分组药丸，也不进药丸计数；子代理之间因此没有任何边。
- 悬停星形（同标签虚线）：`graphTagGroups` 直接不收录子代理，
  「子代理只连主会话」在所有连线形态上都成立。
- 血缘边（父卡 → 子卡）本来就是唯一连到子代理的线，位置也没变。

### 3. 子代理跑完：自己的留着（灰化），别人的照旧隐藏

口径（2026-11-12 用户补充，一次改对）：**别人的子代理该隐藏，说的是不再隐藏自己的子代理**。

- 用 `sessionRootOf()` 沿 `parentId` 走到血缘根：一条子代理链只属于一个主会话；
- 已跑完（`running !== true`）的子代理，**血缘根 === 当前会话（或当前会话的根）才保留**：
  显示为 `dormant`（alpha 0.42）+ 角标「子代理 · 已完成」，与父卡的连线照旧；
- 别人的已跑完子代理仍受「🗄 隐藏已归档」开关控制（默认隐藏）；
  正在跑的子代理谁都显示（有实时活动，不藏）；
- 切换会话时归属实时翻转：切到 s1，s1 的子代理露出来、s2 的藏回去（`currentSessionRoot`
  已加入 `liveNodes` 依赖，不会因为 memo 缓存而停在旧值）；
- `🗄 已隐藏 N` 计数 = 已归档会话 + 别人的已跑完子代理；title 同步说明。

### 4. 新会话实时上板（修「只在开启时生成一次」）

用户反馈：新开的会话不会被思维图记录。查证：`mind_map.json` 里最新卡片的 `createdAt`
停在 09:00，而 13:xx 之后新建的两个会话（`session-eb64bc25…` / `session-b1a4a44a…`）
确实没有卡 —— 因为「打开即自动同步」的实现是 `autoSyncedRef` **一次性守卫**：

- 地图是真·单实例，启动时就挂进侧栏，`autoSyncedRef` 这辈子只放行一次；
- 于是「启动之后新建的会话」永远等不到第二次补卡（右键那条手动同步早在 2a 里删掉了）。

改法（`auto-sync-continuous` / `-newcomers` / `-missing`）：

- 去掉一次性守卫，改成 `useEffect` 每次 `sessions` 更新都补一次缺卡；
  没有缺卡时只做集合比对，不写库（地图空转成本 ≈ O(sessions + cards)）；
- 子代理不参与这条补卡（它们有自己的 `subagent-place-cards`，贴着主卡摆）；
- 新增 `removedSessionIdsRef`：显式「从地图移除」、归档、删除（`runActions`）以及
  白板里 Delete 掉卡片时记下 sessionId，连续补卡不会把它们加回来；刷新页面后重置，
  与以前「打开即补齐」的语义一致；
- 未建文件夹的新工作区仍然走原上限（每次最多 6 个 × 9 张卡）；本机 5 个工作区都已有 frames，
  所以实测只会补进真正的新会话。

### 验收（离线测试台，一次跑完）

- `node apply-patch.mjs` → 71/71 client + 5/5 host 补丁，语法闸门通过；
- `node test/bundle-smoke.mjs` 两次求值 PASS；
- 测试台（`node test/serve.mjs 8791` + 浏览器）实测：
  - `focus-mode=1`、当前会话 s2 → `focusAnchorId = card-2`，9 张卡 **hidden=0**（不再隐藏）；
  - 点「聚焦中」→ `focusAnchorId = null`；再点「聚焦」→ 锚点回来并缓动居中（误差 < 30px）；
  - `addSession('ws-daily','s-live')` 900ms 内出现卡片（连续补卡生效）；
  - 子代理归属（当前会话 s2）：`s2` 的已跑完子代理 `hidden=false`（灰化保留），
    `s1` 的已跑完子代理 `hidden=true`；`s1` 的运行中子代理照常显示；
    每个子代理只有 **1 条** `lineage` 边指向父卡，没有 `ws` 边；
  - 切「🗄 显示全部」→ 别人的已跑完子代理出现，切回「已隐藏 2」→ 又藏起来；
    把当前会话改成 s1 再刷一拍：s1 的子代理露出来、s2 的藏回去（孙代理按血缘根一起判定）；
  - 归档一张卡后 1.2s 内没有被补回来。

### 测试台本身也修了两处陈旧

`test/harness.js` 与线上产物不同步（改名后遗留）：

- main 面板 id 是 `mind_map`，harness 却只认 `mind-map` → 地图根本不渲染；
  现在按 `selectPanel()` 传来的 id 直接查 `panels[id]`；
- 路由前缀已改成 `/mind_map/*`，harness 还只匹配 `/mind-map/*` → `/state` 落到空对象，
  客户端把 `cards: undefined` 读进 store 后 `Object.values(undefined)` 崩在首帧；
  现在 fetch 入口统一把 `/mind_map/` 归一成 `/mind-map/` 再匹配；
- 新增 `__harness.addSubagent(parentSessionId, sessionId, title, running)`，补上子代理夹具；?dupes=1 再给某个会话多塞一张卡（去重断言用）；
- `test/probe.mjs` 的面板断言同时接受两种 id（probe 还没在本机跑过：缺 `playwright-core`，
  需要 `npm i -D playwright-core` 后 `node test/probe.mjs`）。

**换完必须重启 DSH 桌面端**：client bundle 在宿主启动时下发，F5 也拿不到新文件。

## 2026-11-12（续）一个会话三张卡：多实例补卡 + 兜底去重

现象：用户在图上看到同一个子代理出现 **3 次**。查库（`mind_map.json`）：
`eb2d201c-5f67-46f0-ba41-df7312e45174` 这个会话有 3 张卡，`createdAt` 全在 **14:02:00 同一秒**、
位置各不相同 —— 不是"多次打开累积"，而是**同一瞬间被三个地方各建了一张**。

根因（和 2026-11-11「侧栏面板黑底」同源）：DSH 壳把**非当前 session 的整个 pane 留在 DOM 里**
（只加 `display:none`），同一个思维图主面板可能同时存在好几份实例。每份实例都在跑
「自动补卡」和「子代理补卡」两个 effect，各自手里的 `boardSessionIds` 都慢一帧：

- 实例 A 补卡后 store 更新，但 B/C 早在同一 tick 里完成渲染、拿着旧快照；
- B/C 的 `subagentPlacedRef` 是**组件级** ref，各管各的 → 三张卡同时落库；
- 上游的 `mindMapDedupeCards()` 只在启动后 2.5s / 7s 各跑一次，14:02 产生的重复没人清。

修法（三层，任意一层单独都能兜住）：

1. **隐藏实例不许写板**：两个补卡 effect 开头检查自己宿主盒子的实际尺寸
   （`wrapperRef` 的 `getBoundingClientRect()` 宽高 < 40 → return）。隐藏 pane 里的实例直接退出。
2. **模块级补卡节流**：新增 `mindMapPlacedAt` / `mindMapPlaceableNow()` / `mindMapMarkPlaced()`
   —— 同页所有实例共享"这个 session 刚补过（15s 内）"，补卡前查、建卡后标；
   自动补卡与子代理补卡都接上。
3. **持续兜底去重**：`canvasState.cards` 一变就 700ms 后跑一次模块级 `mindMapDedupeCards()`，
   同一 sessionId 只保留最早创建的那张，多余的 `removeCard`（连线随卡删除，幂等，
   多实例同时跑也无害）。存量重复卡（用户现在这三张）在重启后地图打开 0.7s 内会被清掉。

验证（离线测试台）：

- 新增 `?dupes=1` 夹具：初始 payload 里给一个会话多塞一张卡。实测 2.6s 后
  `payload.cards` 恢复 9 张、0 重复，`/cards/delete` 里出现那张 `card-dup-*`；
- 连加 3 个子代理 + 每 400ms 触发一次 sessions 刷新、连续 4 次：每个会话恰好 **1 张卡**，
  归属判定不受影响（自己的跑完可见、别人的跑完隐藏、运行中可见）；
- `node apply-patch.mjs` 75/75 编辑全匹配，`bundle-smoke` PASS。

备注：版本仍 0.1.66；只改 `client/client.js`，**换完要重启桌面端**。

## 2026-11-21 云图上常驻显示节点名（谁在跑 / 哪个是当前会话）

现象：思维图上只看得见「几个点在亮」，不知道亮的是谁 —— 标题只有悬停/点选才出现。

改法（只动 `client/client.js`，4 处）：

- **常驻节点名**：绘制循环末尾加一段，给「正在跑 / 等待接手 / 当前会话」这三种点常驻名字，
  画在点的下方（屏幕空间，字号不随缩放变）；位置被占就依次往右下、右上、右、左让位，
  实在没地方就跳过，被挤走的牵一根短引线；
- **子代理不标名字**（它只是某次对话的附属）—— 默认和「Aa」全标模式下都跳过；
- **当前会话**是琥珀色胶囊 + `▸ 当前 · ` 前缀，跟它原有的琥珀色高亮环对应；
- 左下角缩放条新增 **`Aa`** 开关：打开后所有会话点都标名字，状态记在
  `localStorage['mindmap.dotLabels.all']`，刷新后保持。

补丁可复现：`C:\Users\suma\Documents\DSH\tools\mindmap-labels\patch.mjs`
（`node patch.mjs` 打安装副本；`--file=<path>` 打别的产物；`--dry` 只预演；
每个锚点都断言「必须恰好命中一次」，已打过会直接 SKIP）。

验证（离线测试台，`client.dev.js` 换成打过补丁的 bundle）：
运行中的白点、等你回复的琥珀点各自带名字；强制 `current` 的点出现琥珀色
「▸ 当前 · DSH 会话日志解析」；`Aa` 打开后 10 个点全部标名且互不重叠；F5 后开关保持。

**顺带记一笔（重要）**：这份 checkout 的 `src/` 和线上 0.1.66 的 bundle 已经不是同一代 ——
`src/client/*.tsx` 里 18 处 `import './mind-map.module.css'`，仓库里实际只有
`src/client/mind_map.module.css`；`src/graph/graph-surface.js` 也没有任何 `src/` 文件 import（是 bundle 的抄件）。
`node scripts/build-client.mjs` 补个别名文件能跑通，但产物里**没有** `GraphCanvasSurface`、
也没有「我知道了」等线上功能 —— 也就是说**它重建不出当前线上 bundle**，这次改动只能落在 bundle 上。

版本仍 0.1.66。当前 DSH 有 `client-hmr`（500ms stat 轮询 + SSE rebuilt 帧），
正常情况下改完 `client.js` 会自动重载；面板没变就 F5，再不行重启桌面端。

### 部署到 10.10.40.32（MGter）

2026-11-21 14:37：Ubuntu，profile=`web`，`systemd --user` 的 `dsh.service` 跑 `dsh web`（127.0.0.1:3080）。

1. 用远程已有的 `mind_map-0.1.66-cloud-dismiss.tgz` 解包，把 `package/client/client.js` 换成打好补丁的
   bundle（sha256 `05c2d891…`），重新 `tar -czf mind_map-0.1.66-cloud-labels.tgz package`；
2. 放到 `~/.dsh/profiles/web/vendor/`，`package.json` 的 `mind_map` 指向它；
3. 安装要**显式用 Linuxbrew 的 node 24**：
   `/home/linuxbrew/.linuxbrew/bin/node /home/linuxbrew/.linuxbrew/bin/pnpm install --prefer-offline`
   （直接跑 `pnpm` 会落到 `/usr/bin/node` 18 的 corepack 上，报 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`）；
4. `systemctl --user restart dsh.service`；
5. 验证：启动页里含 `mind_map/client.js` 的那个聚合脚本（`plugins/??…`）已经不是 404 的独立路径，
   curl 下来 `grep -c 'mindmap.dotLabels.all'` = 1；`node_modules/mind_map/client/client.js` 的
   sha256 与本地一致。

备份：`~/.dsh/deployments/mind-map-labels-20261121/`（改动前的 profile `package.json`、lock、新 tgz）。
服务重启会换掉 `dsh web` 打印的 token 链接，浏览器那侧要重新打开一次。
