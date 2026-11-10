# mind_map 图谱视图补丁 · API 事实笔记

侦察时间 2026-11-09，只读；本文件是唯一新增产物。

两个证据源，行号可直接当补丁锚点：

| 简称 | 路径 | 说明 |
| --- | --- | --- |
| 源码 | `mind_map/src/...` | 0.1.66 原始源码，**没有**图谱补丁 |
| 构建 | `.dsh/profiles/desktop/node_modules/mind_map/client/client.js` | 0.1.66 + 已打的 `GraphCanvasSurface` 补丁，17595 行 |

## 0. 全篇前提（§1/§3/§6 都依赖）

图谱模式下 `<ReactFlow>` **根本没有被渲染**：`GraphSurface` 在 graph 模式直接返回 `GraphCanvasSurface`，React Flow 只作为白板模式的另一个分支存在。

```js
// client.js:17539-17545
function GraphSurface(props) {
  var graphOn = useSyncExternalStore(graphModeSubscribe, graphModeGet, graphModeGet);
  if (graphOn) return jsx(GraphCanvasSurface, props);
  return jsx(index, props);            // index = ReactFlow
}
```

后果有两条，都是"静默错值"而不是报错：

```js
// client.js:7854-7858  —— ReactFlow 的 screenToFlowPosition
screenToFlowPosition: (clientPosition, options = {}) => {
  const { transform, snapGrid, snapToGrid, domNode } = store.getState();
  if (!domNode) { return clientPosition; }        // ← 图谱模式走这里：原样返回
  ...
// client.js:10237-10241 —— ReactFlow 的 setCenter
setCenter: async (x, y, options) => {
  const { width, height, maxZoom, panZoom } = get3();
  if (!panZoom) { return false; }                 // ← 图谱模式走这里：直接失败
```

即：图谱模式下所有 `screenToFlowPosition(...)` 的返回值其实是 **client 坐标（视口像素）**，没减 wrapper rect、没除 zoom、没对齐网格；所有 `setCenter(...)` 是 no-op。`MapCanvas` 里 `openMenu` / `onConnectEnd` / 双击空白 / `focusCard` 四处都踩这一条。

---

## 1. openMenu 的完整签名与依赖

**结论**：`openMenu` 只读 `event.clientX` / `event.clientY`，并且无条件调 `event.preventDefault()`；所以传 `{clientX, clientY, preventDefault(){}}` 这样的假 event 能正常工作（不读 `currentTarget`/`buttons`/`stopPropagation`/`getBoundingClientRect`，rect 是从 `wrapperRef` 上取的）。但它是 `CanvasInner` 内部的闭包 + `setMenu` React 状态，没有导出的纯函数版本，只能在组件作用域里调用。菜单坐标是**相对 wrapper 的视口像素**；而写进 `menu.flowX/flowY` 的"flow 坐标"在图谱模式下是错的（见 §0），需要补丁一并修掉。

```ts
// src/client/MapCanvas.tsx:2075-2096
const openMenu = (
  event: React.MouseEvent | MouseEvent,
  kind: MenuContext['kind'],
  targetId?: string,
  edgeEnds?: { from: string; to: string },
): void => {
  event.preventDefault()
  const wrapper = wrapperRef.current
  if (wrapper === null) return
  const bounds = wrapper.getBoundingClientRect()
  const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
  setMenu({
    left: event.clientX - bounds.left,
    top: event.clientY - bounds.top,
    flowX: flow.x,
    flowY: flow.y,
    kind,
    ...(targetId !== undefined ? { targetId } : {}),
    ...(edgeEnds !== undefined ? { edgeFrom: edgeEnds.from, edgeTo: edgeEnds.to } : {}),
    view: 'root',
  })
}
```

构建里同一函数的锚点（补丁直接改这里）：`client.js:15705-15721`，其中 `15710` 是那句 `screenToFlowPosition`。

各 kind 的必填参数（少了就退化成空菜单或没有对应分支）：

| kind | 需要的后续参数 | 依据 |
| --- | --- | --- |
| `pane` | 无 | `MapCanvas.tsx:2168-2191`（用 flowX/flowY 找 `groupAtPoint` → 决定新会话落在哪个 workspace） |
| `card` | `targetId` = **cardId**（不是 sessionId） | `2192-2282`（`canvasState.cards[cardId]` 取 sessionId） |
| `frame` | `targetId` = **workspaceId**（调用方已把 `frame-` 前缀剥掉） | `2346-2381`；剥前缀处 `2467` |
| `edge` | `targetId` = edgeId **且** `edgeEnds:{from,to}` = 两端 cardId | `2283-2285`（条件不满足整段跳过） |

菜单数据来源与 DOM：

```ts
// src/client/MapCanvas.tsx:139-150
interface MenuContext {
  left: number; top: number; flowX: number; flowY: number
  kind: 'pane' | 'card' | 'frame' | 'edge'
  targetId?: string; edgeFrom?: string; edgeTo?: string
  view: 'root' | 'import-ws' | 'import-session' | 'new-ws'
}
// :221   const [menu, setMenu] = useState<MenuContext | null>(null)
// :2098  const menuState: MenuState | null = useMemo(...)   // 由 menu + 各种 store 派生菜单项
// :2516-2518
{menuState !== null
  ? <ContextMenu key={menu?.view ?? 'root'} menu={menuState} onClose={() => { setMenu(null) }} />
  : null}
```

`ContextMenu` 是 wrapper 内的**绝对定位兄弟节点**（`left/top` 相对 wrapper），自己吃掉内部 click/pointerdown 以免被 wrapper 的"点任意处关菜单"关掉；Esc 走 `mapUi.claimEscape`：

```tsx
// src/client/ContextMenu.tsx:89-99
<div className={styles['menu']} style={{ left: menu.left, top: menu.top }} role="menu"
  onClick={(event) => { event.stopPropagation() }}
  onPointerDown={(event) => { event.stopPropagation() }}
  onContextMenu={(event) => { event.preventDefault() }}>
```

现有调用点（构建内锚点 `client.js:16212-16227`）：`onPaneContextMenu→openMenu(e,'pane')`(`MapCanvas.tsx:2464`)、`onNodeContextMenu`(`2465-2469`)、`onEdgeContextMenu`(`2470-2477`)、抽屉 `onCardMenu`(`2565`)。全仓搜不到 `openMenuAt` 之类的纯函数；想要坐标版只能在补丁里加一个形如 `openMenuAt(kind,targetId,flowX,flowY)` 的包装，内部造假 event（`clientX=flowX,clientY=flowY`）再调 openMenu —— 但那样菜单会出现在左上角，所以正确做法是把 `15710` 那行换成"图谱模式用图谱相机的 toFlow，白板模式才用 screenToFlowPosition"。

---

## 2. startSessionIn 与 folderAt

**结论**：`startSessionIn(workspaceId?)` 不 await、不创建会话、返回 void —— 它先 `closeMapPanel()` 离开地图，再把 workspaceId 交给 shell 的 `ui.startSession()`，由 shell 打开自带的"新建会话草稿"（id 拿不到）。所以它**不**适合"双击空白就在原地落一张卡片"。`folderAt` = `groupAtPoint`，期望的是 **flow 坐标**。

```ts
// src/client/MapCanvas.tsx:1921-1932
const startSessionIn = (workspaceId?: string): void => {
  const ui = uiWorkspaceService()
  if (ui === undefined || typeof ui.startSession !== 'function') {
    showToast(t('toast.needUiWorkspace')); return
  }
  closeMapPanel()
  ui.startSession(workspaceId)
}
const folderAt = (flowX: number, flowY: number): string | undefined => groupAtPoint(flowX, flowY)
```

`workspaceId === undefined` 的语义在 DSH 侧（本机 0.2.2-rc.1，从 `app.asar` 解出）：

```js
// app.asar → @deepseek-ai/dsh-client-ui-workspace/lib/client.js:1506-1521
const workspace = this.workspaces.list.getSnapshot();
const sessions = this.sessions.list.getSnapshot();
const current = this.mainReference?.sessionId;
const currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId;
const recent = workspace.phase === "ready" && sessions.phase === "ready" ? recentWorkspace(workspace.items, sessions.byId) : void 0;
const target = workspaceId ?? currentWorkspaceId ?? recent;
if (target === void 0) { ... this.clearMain(); return; }
this.openWorkspace(target, initializeDraft ? ... : void 0, ...);
```

即回退链 `传入 → 当前主视图会话所在 workspace → 最近 workspace → 都没有则 clearMain()`（并未创建会话）。

```ts
// src/client/MapCanvas.tsx:1905-1913 —— flow 坐标，和 wsFrames 的 flow 矩形比大小
const groupAtPoint = (x: number, y: number): string | undefined => {
  let best: { groupId: string; area: number } | undefined
  for (const [groupId, rect] of Object.entries(frameRects)) {
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue
    const area = rect.width * rect.height
    if (best === undefined || area < best.area) best = { groupId, area }
  }
  return best?.groupId
}
```

`frameRects` 由 `wsFrames`（存盘的 flow 矩形，`client.js:14351-14358`）派生，容器重叠时**面积最小者优先**。构建锚点：`groupAtPoint` = `client.js:15579-15587`，`startSessionIn` = `15588-15596`，`folderAt` = `15597`。

---

## 3. 拉线分叉（PendingSpawn）

**结论**：`PendingSpawn` 只有 4 个字段，最少给 `parent{cardId,sessionId,title}` + `x`/`y`（flow 坐标、卡片左上角）就能弹面板；`pendingSpawn` 是组件内 `useState`，所以补丁必须在 `CanvasInner` 作用域里 `setPendingSpawn({...})`（或调用现成的 `onConnectEnd`）。真正需要补的是上流：图谱画布目前**不发** `onConnectStart/onConnectEnd`，且 `onConnectEnd` 用 `screenToFlowPosition` 算落点，在图谱模式下会拿到屏幕坐标。

```ts
// src/client/SpawnPreview.tsx:20-27
export interface PendingSpawn {
  parent: { cardId: string; sessionId: string; title: string }
  /** The parent session's workspace — mode 'none' creates the sibling there. */
  parentWorkspaceId?: string
  /** Flow position where the connection was dropped (card lands here). */
  x: number
  y: number
}
```

生产这个状态的就是 `onConnectEnd` 的尾部（构建锚点 `client.js:15383-15412`）：

```ts
// src/client/MapCanvas.tsx:1642-1679（节选）
if (connectionState.isValid === true) return       // 落在 handle 上 → onConnect
const fromNodeId = connectionState.fromNode?.id     // 必须能拿到源卡片 id
if (fromNodeId === undefined) return
const card = canvasState.cards[fromNodeId]          // 必须是 canvas 里的 cardId
if (card === undefined) return
const position = screenToFlowPosition(client)       // ← §0 的坑
...
const summary = sessions.byId[card.sessionId]
if (summary === undefined) return
const parentWorkspaceId = sessionWs.get(card.sessionId)
setPendingSpawn({
  parent: { cardId: fromNodeId, sessionId: card.sessionId, title: summary.displayTitle },
  ...(parentWorkspaceId !== undefined ? { parentWorkspaceId } : {}),
  x: snap(position.x - CARD_W / 2),
  y: snap(position.y - CARD_H / 2),
})
```

（命中已有卡片改用 `createLinkEdge(fromNodeId, hitId)` 连线，不弹面板：`1663-1670`；`CARD_W=224 / CARD_H=120` 见 `src/client/grid-layout.ts:20-21`，`snap` = 16 网格 `MapCanvas.tsx:68,85`。）

提交后走的三条通道（`SpawnPreview.tsx:88-144`）：

| 模式 | 宿主调用 | 证据 |
| --- | --- | --- |
| `digest` | `callRpc('session/create', {workspaceId?})` → `mindMapApi.ensureDigest(parent)` → `mindMapApi.injectContext(child, [{sessionId, text}])` | `95-98`, `108-118` |
| `full`（默认） | `forkSessionInUi(parent)`（dsh 原生 fork，走 `ctx.uiWorkspace.forkSession`，不是 RPC） | `122`；`map-state.ts:327` |
| `none` | `session/create` → `callRpc('session/prompt', {sessionId, mode:'queue', content:[{type:'text',text}], clientTimeZone})` | `130-139` |

面板 UI 只暴露 `digest | full` 两档（`SpawnPreview.tsx:146-149`，`mode` 默认 `'full'` 见 `39`），`'none'` 分支在当前 UI 里不可达。落地卡片用 `addCardAndEdge`（`61-81`）：`canvas.addCards` + `canvas.addEdges`（`canvas-store.ts:276,285`），边 `injection.kind` 跟着模式走。渲染锚点：`client.js:16293-16295`（`pendingSpawn !== null ? <SpawnPreview .../>`）。

**最少需要设置的状态**（补丁侧）：`setPendingSpawn({ parent: {cardId, sessionId, title}, x, y })`；其中 `title` 取 `sessions.byId[card.sessionId].displayTitle`，`x/y` 用图谱相机算出的 flow 坐标减去 `CARD_W/2, CARD_H/2` 并 `snap`。若想复用现成逻辑，就造一个"图谱坐标 ↔ client 坐标"的假事件喂 `onConnectEnd`：`{clientX, clientY}` + `{isValid:false, fromNode:{id:cardId}}` —— **必须同时修 §0 的 `screenToFlowPosition`**，否则 `position` 是屏幕坐标。

---

## 4. 归档字段到底存不存在

**结论**：客户端 session summary 里**没有**任何归档标记；归档是 workspace 级别的"全局集合" `archivedSessionIds`，随 `WorkspaceBaseline` 下发，插件侧通过 `props.useWorkspaces(s => s.archivedSessionIds)` 就能拿到。归档会话**不会**从 `sessions.ids/byId` 里消失（侧栏只是渲染时按 `archivedFilter` 过滤），所以图谱做"归档灰化"不需要额外接口，也不需要新字段。

```ts
// src/client/dsh.ts:20-40 —— SessionSummary 全字段，没有 archived/archivedAt
export interface SessionSummary {
  readonly id: string; readonly title?: string; readonly displayTitle: string
  readonly cwd?: string; readonly agentPreset?: string
  readonly parentId?: string; readonly origin?: 'subagent'
  readonly running: boolean; readonly pendingInteraction?: unknown
  readonly completed?: boolean; readonly blank: boolean
  readonly updatedAt: number
  readonly retainedBy?: { readonly mainView?: number }
}
// src/client/dsh.ts:66-74 —— 归档标记挂在 workspace 快照上
export interface WorkspaceListState {
  readonly items: readonly WorkspaceView[]
  readonly pinnedSessionIds?: readonly string[]
  /** Sessions currently in the archive. */
  readonly archivedSessionIds?: readonly string[]
}
```

权威契约（`app.asar` 里的公开类型目录）：

```js
// app.asar → @deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js:10030
declaration: 'export interface WorkspaceBaseline {\n    readonly items: readonly WorkspaceView[];\n    readonly archivedSessionIds: readonly SessionId[];\n    readonly pinnedSessionIds: readonly SessionId[];\n}'
// 同文件 10114：follow 增量的其中一支就是归档集合整体替换
... | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[]; }
// 同文件 4467 / 4578：unarchiveSession(sessionId): Promise<void>（"drop it from the registry-global archive set"）
```

侧栏怎么用这个集合（说明会话数据本身还在）：

```js
// app.asar → @deepseek-ai/dsh-client-ui-workspace/lib/client.js:964-974
function sessionVisible(session, current, archived, archivedFilter) {
  if (session.origin === "subagent") return false;
  if (session.blank && session.id !== current) return false;
  switch (archivedFilter) {
    case "default": return !archived.has(session.id);   // 默认隐藏
    case "show":    return true;                         // "全部对话"仍可见
    case "only":    return archived.has(session.id);
// 同文件 1059-1070：行的 archived 是渲染期算出来的，不是 summary 字段
function sessionNode(s, list, statuses, pinned, archived) { ... archived: archived.has(s.id), ... }
// 同文件 3678：标准 feed 确实给 React 侧
const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
```

插件自己的归档/取消归档入口：`ui.archiveSession(sessionId, {stopActivity:true})`（`src/client/session-actions.ts:124-135`，接口声明 `dsh.ts:165`）。

本机数据实查（`C:\Users\suma\.dsh\storages\mind_map.json`，65 张卡片）：cards 的键集合只有 `boardId, sessionId, x, y, createdAt`，**没有 archived 字段**；全文件 `archiv` 命中仅出现在 digest 正文里。`Board` 上确有一个 `archivedAt?: number`（`src/shared/model.ts:18-25`），但那是"板子归档"，与卡片无关且当前无人使用。另外注意：地图现在的归档行为是"归档成功即 `canvas.removeCard(cardId)`"（`MapCanvas.tsx:1833-1835`），卡片直接消失 —— 想灰化必须改这里并读 `archivedSessionIds`。

---

## 5. 镜头缓动

**结论**：`setCenter(x, y, {zoom, duration})` 全仓只有两处使用（都 `duration: 320`），但**只在白板模式有效**；图谱模式下 `panZoom` 为空会立刻 `return false`，所以图谱的镜头移动/缓动只能自己实现（改 `cameraRef` + `writeGraphCamera`，用 rAF 补间）。图谱相机与 `canvas.setCamera` 是两套存储：前者 localStorage，后者 `mind_map.json` 的 `cameraByBoard`，只有"拖拽平移结束"会同步一次过去。

```ts
// src/client/MapCanvas.tsx:920-928  —— status rail 点一行：居中某张卡
const focusCard = useCallback((cardId: string) => {
  const slot = cardLayout[cardId]; const card = visibleCards[cardId]
  const point = slot ?? (card === undefined ? undefined : { x: card.x, y: card.y })
  setSelectedIds([cardId])
  if (point === undefined) return
  setCenter(point.x + CARD_W / 2, point.y + CARD_H / 2, { zoom: getZoom(), duration: 320 })
}, [cardLayout, visibleCards, setCenter, getZoom, setSelectedIds])
// :2498  1:1 按钮 → zoomTo(1, { duration: 200 })
// client.js:16130（构建内另一处，focusOn 跟随）setCenter(..., { zoom, duration: 320 })
```

`duration` 没有上下限校验，直接透传给 d3 transition（单位毫秒；`0`/省略 = 瞬时）：

```js
// client.js:10237-10248（ReactFlow setCenter）
const nextZoom = typeof options?.zoom !== "undefined" ? options.zoom : maxZoom2;
await panZoom.setViewport({ x: width/2 - x*nextZoom, y: height/2 - y*nextZoom, zoom: nextZoom },
  { duration: options?.duration, ease: options?.ease, interpolate: options?.interpolate });
// client.js:6945-6949  setViewport → setTransform(transform, options) → d3 过渡
```

图谱相机（补丁要动的地方）：

```js
// client.js:17067-17082
var GRAPH_CAMERA_KEY = "dsh.mind-map.graph-camera.v1";
function readGraphCamera() { ... JSON.parse(localStorage.getItem(GRAPH_CAMERA_KEY)) ... }
function writeGraphCamera(camera) { ... localStorage.setItem(GRAPH_CAMERA_KEY, JSON.stringify(camera)) ... }
// client.js:17431-17434  平移松手才回写板级相机
} else {
  var handler = propsRef.current.onMoveEnd;
  if (typeof handler === "function") handler(null, cameraRef.current);
}
// client.js:17154-17182  fitRef：直接改 cameraRef 后 schedule()，**没有动画**
```

板级相机写入是 800ms 防抖（`src/client/canvas-store.ts:25` `CAMERA_DELAY_MS = 800`，`:412-426` `setCamera`，`:443-445` `savedCamera` 读）；它只在白板模式被当作 `defaultViewport`（`MapCanvas.tsx:2394,2494`），图谱模式完全不读它 —— 图谱首帧用 `readGraphCamera()`，为空才 `fitRef()`（`client.js:17115,17494`）。

---

## 6. 有没有现成的"在给定 flow 坐标新建会话"

**结论**：没有。双击空白只是 `folderAt()` 找文件夹 + `startSessionIn()` 把工作区交给 shell 并**离开地图**（不建卡片、不返回 id）。唯一"在给定 flow 点落地一张新卡片"的代码是 `SpawnPreview.addCardAndEdge`，其次是 `importWorkspace/importSession` 的网格落点。

```tsx
// src/client/MapCanvas.tsx:2401-2419（构建锚点 client.js:16156-16167）
onDoubleClick={(event) => {
  const target = event.target as HTMLElement
  const nodeElement = target.closest('.react-flow__node')
  if (nodeElement !== null) {
    const nodeId = nodeElement.getAttribute('data-id') ?? ''
    if (nodeId.startsWith('frame-')) startSessionIn(nodeId.slice('frame-'.length))
    return
  }
  if (target.closest('.react-flow__pane') === null) return
  // Empty canvas: the folder under the pointer decides (if any).
  const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
  startSessionIn(folderAt(position.x, position.y))
}}
```

要点：`.react-flow__node` / `.react-flow__pane` 这两个选择器在图谱模式**不存在**（DOM 里只有 `div.tm_graphSurface > canvas`），所以整段双击逻辑在图谱下等于死代码；`zoomOnDoubleClick={false}`（`2484`）说明双击没有被 React Flow 占用。

现成的落点代码可参考：`importSession(sessionId, atX, atY)`（`1982-1989`）、`importWorkspace(workspaceId, atX, atY)`（`1936-1980`，新卡片按 `gridPosition` 铺）、`SpawnPreview.addCardAndEdge`（`SpawnPreview.tsx:61-81`）。要在原地新建且拿到 id，可用 `callRpc('session/create', { workspaceId })`（`SpawnPreview.tsx:95-98`）或 `ui.connectWorkspace(workspaceId)`（`src/client/dsh.ts:156`，返回 sessionId 且不离开地图——`MapCanvas` 目前没用它），再 `canvas.addCards({[newCardId()]: {boardId, sessionId, x, y, createdAt}})`。

---

## 给补丁脚本的可操作结论

1. **菜单**：在 wrapper 的 `onContextMenu`（`client.js:16168`）里按命中做 `openMenu(event, kind, targetId[, edgeEnds])`；假 event 只需 `{clientX, clientY, preventDefault(){}}`，kind 参数按 §1 的表填（card→cardId，frame→去前缀 workspaceId，edge→edgeId+两端 cardId）。
2. **坐标**：把 `client.js:15710`（`openMenu` 里的 `screenToFlowPosition`）和 `client.js:15396`、`16165` 统一换成"图谱模式用 canvas 相机 `toFlow`，否则用 React Flow"——否则 `menu.flowX/flowY`、`SpawnPreview` 落点、`folderAt` 全是屏幕坐标。
3. **双击空白**：不要复用它现在的 DOM 选择器（图谱里没有 `.react-flow__pane`）；在 `GraphCanvasSurface` 的 `onDoubleClick`（`client.js:17527`，现在是 `stopPropagation` 空转）里用 `hitTest()` 判空，再 `setPendingSpawn` 或 `session/create` + `canvas.addCards` 原地建卡。
4. **拉线分叉**：`PendingSpawn` 最少 `{parent:{cardId,sessionId,title}, x, y}`（x/y = flow 落点 − 112/60 后 `snap` 到 16）；图谱画布要自己实现"从卡片拖出 → 松手在空白"再 `setPendingSpawn`，复用 `onConnectEnd` 需造 `{clientX,clientY}` + `{isValid:false, fromNode:{id}}` 并先修第 2 条。
5. **归档灰化**：字段不在 session summary、也不在 mind_map.json，读 `props.useWorkspaces(s => s.archivedSessionIds)` 即可；同时把 `runActions` 里的 `canvas.removeCard`（`MapCanvas.tsx:1835` / 构建内对应处）改成"保留卡片 + 打灰"，取消归档用 `ui.unarchiveSession(sessionId)`。
6. **镜头**：图谱里 `setCenter` 恒为 no-op（`panZoom` 空），缓动自己写：rAF 在 `cameraRef.current` 上做 200–320ms 补间并 `writeGraphCamera` + `schedule()`；持久化注意图谱用 localStorage `dsh.mind-map.graph-camera.v1`，只有平移松手才会写进 `canvas.setCamera`（800ms 防抖）。
