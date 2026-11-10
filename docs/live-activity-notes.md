# mind_map · 会话实时活动（正在思考 / 正在执行）取数笔记

侦察时间 2026-11-09，只读；本文件是本次唯一新增产物。宿主 `http://127.0.0.1:3171`（PID 15820）。

三个证据源：

| 简称 | 路径 | 说明 |
| --- | --- | --- |
| 构建 | `plugins/??@deepseek-ai/dsh-client-ui-settings-agent-loop/client.js` 等 | 浏览器实际加载的 bundle，按 `//#region <源码路径>` 分区，下面按 region 引 |
| 旁证 | `~/.dsh/profiles/desktop/node_modules/dsh-better-sidebar/src/*` | 已上线插件，host 侧折叠同一批帧，**有行号** |
| 实测 | 本文件 §1 的事件样例 | Playwright/CDP 在真实页面上抓的原始帧，已脱敏截断 |

---

## 0. 结论先行

1. **`ctx.remote.$on` 拿不到思考/执行文本。** 客户端只转发 5 个事件，全是 `api-session/*`，**没有任何 `agent/*`**（全文检索 `agent/` 前缀命中数为 0）。实测在 `agent/assistant-stream` 上订阅 17 秒零命中，同期宿主有会话正在流式输出 → 否。
2. **真正的通道是每会话一条异步流 `remote.session.follow({ address, assistantStream: true, activate: true })`。**`assistantStream: true` 是字面量 `true`（schema 写死 `zod.literal(true)`），不加就只回历史、没有实时帧。
3. **帧有且只有三种**：`{type:'start'}` / `{type:'assistant-stream'}`（内含 `frame.type`）/ `{type:'event'}`（持久事件）+ 开头的 `{type:'snapshot'}`。
4. **思考/回复从 `chunk` 帧出，工具执行从持久事件出。**`reasoning-delta`→「正在思考」、`text-delta`→「正在回复」、`tool-call-delta`→工具名（**名字在第一个 delta 就到了**）；真正「正在执行」要用 `event` 帧里的 `tool/call`（`data.name` + `data.arguments`，JSON **字符串**），因为模型流结束时执行才刚开始。
5. **清空规则**：`frame.type==='end'`（attempt 结算）清思考/回复/待执行工具；`tool/result` 或 `step/end` 清「正在执行」那一行。
6. **帧率实测 40–55 帧/秒**（单会话、工具参数流式期间，1178 帧/22s）。必须 150ms 节流后再重绘，否则图谱会掉帧。
7. **多会话不混流**：一条流只属于一个地址，帧里**没有** sessionId；`attemptId` 形如 `<sessionId>:<attempt 计数>`，可作交叉校验。
8. **接线一句话**：`ctx.inject(['remote','remote.session'], function (s) { live.attach(s.remote, ctx.sessions.list, s.remote.session) })`——`remote.session` **必须**进 inject 列表，否则 `cannot get property "remote.session" without inject`（§3.3）。

---

## 1. 证据

### 1.1 `$on` 全部可订阅事件（构建产物的字符串全集）

对两个 plugin 聚合 bundle 做 `"<ns>/<name>"` 全量抓取后的结果，与会话活动相关的只有这 5 个，且都是**位置参数**：

| 事件 | 实参 | 用途 | 旁证 |
| --- | --- | --- | --- |
| `api-session/status` | `(sessionId, running:boolean)` | 谁在跑 → **决定开哪条流** | `client.js` region `lib/types/client/sessions/*`：`ctx.remote.$on("api-session/status", (sessionId, running) => ...)` |
| `api-session/activity` | `(sessionId, updatedAt:number)` | 最近活动时间 | 同上 |
| `api-session/added` | `(summary)` | 新会话 | 同上 |
| `api-session/removed` | `(sessionId)` | 删会话 | 同上 |
| `api-session/error` | `(sessionId, message)` | 跑失败 | 本仓库已在用：`src/client/session-alerts.ts:78-79` |

检索结果（计数即出现次数，证明 `agent/*` 一条都没有）：

```
api-session/activity x1  api-session/added x1  api-session/error x2
api-session/removed x1   api-session/status x2
agent:  （空）
```

`tool/*`、`assistant/*`、`step/*`、`turn/*` 都出现了，但它们是**持久事件名**（走 §1.2 的 `event` 帧），不是 `$on` 事件名。

> 反面证据：`agent/assistant-stream` 只在 **host 进程**侧存在（`dsh-better-sidebar/src/assistant-live.ts:92`，`ctx.on('agent/assistant-stream', payload => {...})`，payload 是 `{agent:{session:{id}}, frame}`）。浏览器侧拿不到这条 host 事件，拿到的是被改写成会话事件的同一批帧。

### 1.2 一条流，三种帧（真实样例，脱敏）

订阅方式（控制台实测可跑）：

```js
var ns = window.__mindMapCtx.get('remote.session');   // 不用 inject，见 §3.3
var src = ns.follow({ address: { kind: 'session', sessionId: SID },
                      activate: true, assistantStream: true, maxMessages: 1 }, signal);
var it = src[Symbol.asyncIterator]();                 // ← follow 返回 async iterable，不是 iterator
```

**① 开流快照**（`snapshot`）——重连/中途 attach 也能立刻显示，不用等下一帧：

```json
{"type":"snapshot","header":{},"projections":{},"cursor":50000,
 "records":[ …5 条… ],"hasMore":false,
 "assistantStream":{"revision":50764,
   "activeAttempt":{"attemptId":"session-0e1f…:100","startedAfterSeq":1627,
                    "turn":6,"step":44,"nextIndex":0,"stream":[]}}}
```

`activeAttempt.stream` 是紧凑流（`CompactDetachedStream[]`，元素形如 `{"type":"reasoning-chunks","texts":["…"]}` / `{"type":"chunk","chunk":{…}}` / `{"type":"tool-call-chunks","name":"…","args":[…]}`），**注意 `stream: []` 表示这一段还没攒东西**，不代表没有 attempt。

**② 流式帧**（`assistant-stream`，真正的思考文本）：

```json
{"type":"assistant-stream","frame":{"type":"chunk","attemptId":"session-0e1f…:100",
 "revision":50766,"index":1,"time":1794202798553,
 "chunk":{"type":"reasoning-delta","index":0,"text":"The"}}}
```

**③ 持久事件帧**（`event`，工具执行、步骤边界）：

```json
{"type":"event","event":{"type":"tool/call","seq":1659,"time":1794202883562,
 "data":{"turn":6,"step":50,"callId":"call_00_ear…","name":"pwsh",
         "arguments":"{\"command\":\"$p=\\\"C:\\\\Users\\\\suma\\\\…\\\"; …\",\"description\":\"Check live-activity notes\"}"}}}
```

**④ 结束帧**（`frame.type==='end'`，一句话说清"这一段完了、别再用流里的文本"）：

```json
{"type":"end","attemptId":"session-0e1f…:101","revision":51605,"index":737,
 "outcome":{"kind":"committed","eventType":"assistant/message","seq":1633}}
```

`outcome.kind` 另一值是 `abandoned`（尝试被丢弃，`assistant/attempt` 会带 stream 落盘）。

`frame.type==='start'`（schema 原文，实测未撞上——中途 attach 一律走 snapshot 基线）：

```json
{"type":"start","attemptId":"…","revision":N,"startedAfterSeq":N,"turn":N,"step":N}
```

### 1.3 `chunk` 的全部类型（实测计数 1178 帧/22s）

| `chunk.type` | 形状 | 取什么 |
| --- | --- | --- |
| `block-start` | `{index, blockType:"reasoning"\|"text"\|"tool-call"}` | 判断这一段是思考还是正文 |
| `reasoning-delta` | `{index, text}` | **思考文本，累加** |
| `text-delta` | `{index, text}` | 正文，累加 |
| `tool-call-delta` | `{index, id, name?, argumentsDelta}` | 工具名（首个 delta 就带）+ 参数流 |
| `block-end` | `{index, block:{type:"reasoning"\|"text", text:"…"}}` | **该块全文**，可直接覆盖累加值 |
| `finish` | `{reason:{kind:"tool-calls"\|…}, replayState:{…}}` | `tool-calls` = 接下来要执行工具 |
| `usage` | `{usage:{inputTokens,…}}` | 忽略 |

真实计数：`tool-call-delta 1136 / reasoning-delta 31 / block-start 3 / block-end 4 / usage 2 / finish 2`。

折叠规则与已上线插件一致（`dsh-better-sidebar/src/sidechat-core.ts:1108-1113`）：只认 `text-delta` 与 `reasoning-delta` 的 `chunk.text`，工具块不产文本。

### 1.4 什么算"正在执行"

同一段会话的完整序列（实测，时间来自 `event.time`）：

```
17:47:55.160 tool/result  call_00_vmb5…   ← 上一个工具回来了
17:47:55.161 step/end     turn 6 step 49  ← 整个 step 收尾
17:47:55.176 step/start   turn 6 step 50  ← 下一步开始（此时还没有任何 assistant 帧）
17:47:56.9xx （模型流：reasoning/text/tool-call-delta … 53 帧/秒）
17:48:03.562 tool/call    pwsh  "Check live-activity notes"   ← 执行开始，此刻才该显示
```

`tool/result` 的形状（清行用 `data.message.source.callId` 配对）：

```json
{"type":"tool/result","seq":1655,"time":1794202875160,
 "data":{"turn":6,"step":49,
   "message":{"role":"tool","source":{"kind":"tool","callId":"call_00_vmb5…"},
              "toolCallId":"call_00_vmb5…","content":[{"type":"text","text":"### Result\n…"}]}}}
```

另外 `job/registered` / `job/settled` 带 `data.owner`（= sessionId）与 `data.label`（= 命令摘要），后台长命令也能显示成「正在执行」。

### 1.5 多会话：没有 sessionId 可混

- 一条 `follow` 只绑一个地址（`{kind:'session',sessionId}` 或 `{kind:'subagent',parentSessionId,childSessionId,mode}`），帧里**不带** sessionId。
- 关联靠**流本身**，`attemptId` 只是 `<sessionId>:<attempt 计数>` 形式的冗余校验（实测 `session-0e1f…:100`、`:101`、`:102`；本会话 `ed46eb9b…:43`）。
- 所以"全图 N 个会话"= N 条流，必须自己限并发（原型里 `MAX_STREAMS=8`，只开 `running===true` 的）。
- subagent 会话（`origin:'subagent'`）**不能用** `kind:'session'` 地址，会报 `subagent Sessions require their durable parent address`；要用 `{kind:'subagent', parentSessionId: summary.parentId, childSessionId, mode:'continuable'}`，`mode` 不对会报 `subagent mode does not match the supplied address`（实测：`one-shot` 被拒，`continuable` 通过）。

### 1.6 端到端实测：原型真的画出了这两行

把 §2 的代码贴进页面、绑住本会话，再跑一轮，采样到的真实输出（已脱敏）：

```
正在思考：ead the first ~60 lines of api-notes.md.
正在思考：Good — I know the doc style:
正在思考：ead the trace to see if "正在思考" lines got
正在执行：mcp__chrome-devtools__evaluate_script {"function": "function () { …"（旧版摘要，已被 §2 的 SKIP 名单修掉）
```

`正在思考：` 那 11 条是流式过程中实时采到的；`正在执行：` 出现在工具真正跑起来时。截断成 40 字会出现断词（`ead the…`），所以 §2 统一加前缀 `…`。

---

## 2. 原型代码

纯 JS、ES5 风格（`var`/`function`，无箭头函数、无可选链、无反引号、无 `${`），可直接进 bundle / `String.raw` 模板。挂在 `window`/模块作用域均可。

```js
/**
 * mind_map · 会话实时活动。
 * 一行摘要：正在思考：…<最后 40 字> / 正在回复：… / 正在执行：<工具名> <参数摘要>
 *
 * 数据源：ctx.remote.session.follow({address, activate:true, assistantStream:true})
 *   帧 1 snapshot          —— 中途 attach 也能立刻有内容
 *   帧 2 assistant-stream  —— frame: start | chunk | end
 *   帧 3 event             —— tool/call | tool/result | step/end | assistant/message
 */
var live = (function () {
  var CAP = 2000;            // 单缓冲区上限（留尾部；卡片只用最后 40 字）
  var SHOW = 40;             // 卡片上显示的字符数
  var THROTTLE = 150;        // 订阅者回调节流（ms）。帧率实测 40-55/s，必须节流
  var MAX_STREAMS = 8;       // 同时订阅的会话数上限
  var PREFER = ['description', 'command', 'file_path', 'pattern', 'query', 'path', 'url', 'prompt', 'title', 'label'];
  var SKIP = { 'function': 1, code: 1, script: 1, content: 1, body: 1, text: 1, new_string: 1, old_string: 1, source: 1, patch: 1 };

  var states = {};      // sessionId -> { reasoning, text, phase, pending, running, attemptId, turn, step, updatedAt }
  var streams = {};     // sessionId -> { abort, done }
  var offs = [];
  var listeners = [];
  var timer = 0;
  var dirty = false;
  var ns = null;        // remote.session 命名空间
  var listRef = null;   // ctx.sessions.list

  function trim(s) { return String(s).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function tail(s, n) { s = String(s); return s.length > n ? '…' + s.slice(s.length - n) : s; }
  function keep(s) { s = String(s); return s.length > CAP ? s.slice(s.length - CAP) : s; }

  function stateFor(id) {
    if (!states[id]) states[id] = { reasoning: '', text: '', phase: '', pending: null, running: null, attemptId: '', turn: -1, step: -1, updatedAt: 0 };
    return states[id];
  }

  /** 150ms 合并一次重绘：一帧一次 render 会把图谱拖死。 */
  function notify() {
    if (dirty) return;
    dirty = true;
    timer = setTimeout(function () {
      dirty = false; timer = 0;
      var fns = listeners.slice();
      for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {} }
    }, THROTTLE);
  }

  /** 工具参数 -> 卡片上那半句。优先语义字段，跳过整段代码。 */
  function summarize(raw) {
    var args = null, i, k, v;
    try { args = JSON.parse(raw); } catch (e) { args = null; }
    if (!args || typeof args !== 'object') { var flat = trim(raw || ''); return flat ? tail(flat, SHOW) : ''; }
    for (i = 0; i < PREFER.length; i++) { v = args[PREFER[i]]; if (typeof v === 'string' && v) return tail(trim(v), SHOW); }
    for (k in args) {
      if (!Object.prototype.hasOwnProperty.call(args, k) || SKIP[k] === 1) continue;
      v = args[k];
      if (typeof v === 'string' && v && v.length <= 160) return tail(trim(v), SHOW);
    }
    return '';
  }

  function applyChunk(s, c) {
    if (!c || typeof c !== 'object') return;
    var t = c.type;
    if (t === 'block-start') {
      s.phase = c.blockType === 'reasoning' ? 'thinking' : c.blockType === 'text' ? 'replying' : c.blockType === 'tool-call' ? 'tool' : s.phase;
      return;
    }
    if (t === 'reasoning-delta') { if (typeof c.text === 'string') s.reasoning = keep(s.reasoning + c.text); s.phase = 'thinking'; return; }
    if (t === 'text-delta') { if (typeof c.text === 'string') s.text = keep(s.text + c.text); s.phase = 'replying'; return; }
    if (t === 'tool-call-delta') {
      if (!s.pending) s.pending = { name: '', args: '', id: '' };
      if (typeof c.name === 'string' && c.name) s.pending.name = c.name;
      if (typeof c.id === 'string' && c.id) s.pending.id = c.id;
      if (typeof c.argumentsDelta === 'string') s.pending.args = keep(s.pending.args + c.argumentsDelta);
      s.phase = 'tool';
      return;
    }
    if (t === 'block-end') {
      var b = c.block;   // 该块全文，权威值：直接覆盖累加结果
      if (b && b.type === 'reasoning' && typeof b.text === 'string') s.reasoning = keep(b.text);
      else if (b && b.type === 'text' && typeof b.text === 'string') s.text = keep(b.text);
      return;
    }
    if (t === 'finish') { if (c.reason && c.reason.kind === 'tool-calls') s.phase = 'tool'; return; }
  }

  /** 重连基线：把 activeAttempt.stream 折叠成当前文本，省掉"等下一帧"。 */
  function foldedBaseline(id, base) {
    var att = base && base.activeAttempt;
    if (!att) return;
    var s = stateFor(id), recs = att.stream || [], i, r;
    s.attemptId = att.attemptId || ''; s.turn = att.turn; s.step = att.step;
    for (i = 0; i < recs.length; i++) {
      r = recs[i];
      if (!r || typeof r !== 'object') continue;
      if (r.type === 'reasoning-chunks' && r.texts) s.reasoning = keep(s.reasoning + r.texts.join(''));
      else if (r.type === 'text-chunks' && r.texts) s.text = keep(s.text + r.texts.join(''));
      else if (r.type === 'chunk' && r.chunk) applyChunk(s, r.chunk);
      else if (r.type === 'tool-call-chunks' && r.name && !s.pending) s.pending = { name: r.name, args: '', id: '' };
    }
    s.updatedAt = Date.now(); notify();
  }

  function onFrame(id, f) {
    if (!f || typeof f !== 'object') return;
    var s = stateFor(id), fr, ev, d, cid;
    if (f.type === 'snapshot') { foldedBaseline(id, f.assistantStream); return; }

    if (f.type === 'assistant-stream') {
      fr = f.frame || {};
      if (fr.type === 'start') {
        s.attemptId = fr.attemptId || ''; s.turn = fr.turn; s.step = fr.step;
        s.reasoning = ''; s.text = ''; s.pending = null; s.phase = '';
      } else if (fr.type === 'chunk') {
        applyChunk(s, fr.chunk);
      } else if (fr.type === 'end') {
        // attempt 结算：文本已落盘（assistant/message），流里的副本必须清掉，否则下一步会串味
        s.reasoning = ''; s.text = ''; s.pending = null; s.phase = '';
      }
      s.updatedAt = Date.now(); notify(); return;
    }

    if (f.type === 'event') {
      ev = f.event || {}; d = ev.data || {};
      if (ev.type === 'tool/call') {
        s.running = { name: typeof d.name === 'string' ? d.name : 'tool',
                      args: typeof d.arguments === 'string' ? d.arguments : '',
                      callId: d.callId };
        s.pending = null; s.phase = 'tool';
      } else if (ev.type === 'tool/result') {
        cid = d.message && d.message.source && d.message.source.callId;
        if (!s.running || s.running.callId === cid) s.running = null;
      } else if (ev.type === 'step/end') {
        s.running = null; s.pending = null; s.reasoning = ''; s.text = ''; s.phase = '';
      } else if (ev.type === 'assistant/message') {
        s.reasoning = ''; s.text = '';
      }
      s.updatedAt = Date.now(); notify();
    }
  }

  function addressFor(id) {
    var row = null;
    try { row = listRef ? listRef.getSnapshot().byId[id] : null; } catch (e) { row = null; }
    if (row && row.origin === 'subagent' && row.parentId) {
      return { kind: 'subagent', parentSessionId: row.parentId, childSessionId: id, mode: 'continuable' };
    }
    return { kind: 'session', sessionId: id };
  }

  function openStream(id, modeOverride) {
    if (!ns || streams[id]) return;
    var slot = streams[id] = { abort: typeof AbortController === 'function' ? new AbortController() : null, done: false };
    var req = { address: addressFor(id), activate: true, assistantStream: true, maxMessages: 1 };
    if (modeOverride) req.address.mode = modeOverride;

    function startIter(src) {
      var it = src && typeof src[Symbol.asyncIterator] === 'function' ? src[Symbol.asyncIterator]() : src;
      if (!it || typeof it.next !== 'function') { delete streams[id]; return; }
      function pump() {
        it.next().then(function (r) {
          if (slot.done || !r || r.done) return;
          onFrame(id, r.value);
          pump();                       // 不在 promise 回调里长栈，安全
        }, function (err) {
          delete streams[id];
          var msg = String((err && err.message) || err);
          // subagent 的 mode 只能试：one-shot / continuable，错了重开一次
          if (/mode does not match/.test(msg) && !modeOverride) { openStream(id, 'one-shot'); }
        });
      }
      pump();
    }

    try {
      var src = ns.follow(req, slot.abort ? slot.abort.signal : undefined);
      if (src && typeof src.then === 'function') src.then(startIter, function () { delete streams[id]; });
      else startIter(src);
    } catch (e) { delete streams[id]; }
  }

  function closeStream(id) {
    var s = streams[id];
    if (!s) return;
    s.done = true; delete streams[id];
    if (s.abort) { try { s.abort.abort(); } catch (e) {} }
  }

  function reconcile() {
    if (!listRef) return;
    var snap = listRef.getSnapshot(), ids = Object.keys(snap.byId || {}), n = 0, i, row;
    for (i = 0; i < ids.length; i++) {
      row = snap.byId[ids[i]];
      if (!row || row.running !== true) { if (streams[ids[i]]) closeStream(ids[i]); continue; }
      if (streams[ids[i]]) continue;
      if (n >= MAX_STREAMS) break;
      n++; openStream(ids[i]);
    }
  }

  return {
    /**
     * @param remote      ctx.remote（ClientRemoteService，$on 用它）
     * @param list        ctx.sessions.list（可选；缺省时只订阅 attach 之后才跑起来的会话）
     * @param namespace   ctx.remote.session / scoped.remote.session（可选，缺省时试 remote.session）
     * @returns 是否接上了
     */
    attach: function (remote, list, namespace) {
      listRef = list || null;
      ns = namespace || null;
      if (!ns) { try { ns = remote.session; } catch (e) { ns = null; } }
      if (!ns) return false;

      try {
        offs.push(remote.$on('api-session/status', function (sessionId, running) {
          if (running === true) openStream(sessionId); else closeStream(sessionId);
        }));
      } catch (e) {}

      if (listRef) {
        try { offs.push(listRef.subscribe(reconcile)); } catch (e) {}
        reconcile();
      }
      return true;
    },
    /** 不需要重绘时可手动调用（list 变化时自动也会调）。 */
    reconcile: reconcile,
    /** 卡片上要画的那一行；无内容返回 ''。 */
    textFor: function (sessionId) {
      var s = states[sessionId];
      if (!s) return '';
      if (s.running) { var a = summarize(s.running.args); return '正在执行：' + s.running.name + (a ? ' ' + a : ''); }
      if (s.pending && s.pending.name) { var b = summarize(s.pending.args); return '正在执行：' + s.pending.name + (b ? ' ' + b : ''); }
      var think = trim(s.reasoning);
      if (think) return '正在思考：' + tail(think, SHOW);
      var say = trim(s.text);
      if (say) return '正在回复：' + tail(say, SHOW);
      return '';
    },
    /** 节流后的变更通知（150ms 最多一次）。 */
    subscribe: function (fn) {
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },
    dispose: function () {
      for (var id in streams) closeStream(id);
      for (var i = 0; i < offs.length; i++) { try { offs[i](); } catch (e) {} }
      offs = []; states = {}; listeners = [];
      if (timer) { clearTimeout(timer); timer = 0; dirty = false; }
      ns = null; listRef = null;
    }
  };
})();
```

接线（`src/client/index.ts` 的 `apply` 里，与现有 `ctx.inject(['connection','uiWorkspace'], …)` 同一手法）：

```js
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'remote', 'remote.session']
// …
ctx.effect(function () {
  var off = null
  ctx.inject(['remote', 'remote.session'], function (scoped) {
    if (off === null) off = (live.attach(scoped.remote, ctx.sessions.list, scoped.remote.session) ? live.dispose : null)
  })
  return function () { live.dispose(); off = null }
}, 'mind_map: live activity')
```

---

## 3. 风险与降级

### 3.1 帧量 / 开销

- 实测 **40–55 帧/秒**（单会话，`tool-call-delta` 占 96%：一条大参数工具调用会把它刷满）。推理流更快但更碎。
- 一帧一次 `setState` 必掉帧 → 原型内部 150ms 合并通知（`THROTTLE`）。图谱重绘一次约 3–8ms，节流后仍有约 6 次/秒。
- 8 条流 × 50 帧/秒 = 400 次回调/秒，纯字符串累加（`slice(-2000)`）不构成瓶颈，**瓶颈在重绘**，所以必须订阅 `subscribe()` 而不是 rAF 轮询 `textFor()`。
- 内存：每会话两个 2000 字缓冲，8 会话最多几十 KB。`dispose()` 里清空。

### 3.2 版本漂移（0.2.x）

- `assistant/chunk` 在 0.1.5 已被删除，改成本次的进程内帧（`dsh-better-sidebar/src/assistant-live.ts:1-18` 顶部注释有完整迁移史）。同一位置再变一次是**现实风险**。
- 判定锚点：`frame.chunk.type` 的 4 个 delta 名（`block-start`/`reasoning-delta`/`text-delta`/`tool-call-delta`/`block-end`）来自 region `lib/types/client/sessions/assistant-stream.js`；`tool/call`、`tool/result`、`step/end` 来自会话事件 schema（region `lib/types/client/transport.js`）。升级后先跑一次 §1.2 的探测片段即可确认。
- 防御：`applyChunk` 全部 `typeof` 校验 + `default` 分支忽略未知类型；未知 chunk 不会污染卡片。
- `maxMessages: 1` 与快照 `records` 数量相关，纯性能参数；若宿主改了默认窗口，最坏是开流多取几十条历史，不影响实时帧。

### 3.3 `remote.session` 的 inject 门

- 事实：`ctx.remote.session` 在没声明 inject 时会抛 `cannot get property "remote.session" without inject`（实测）。已上线插件的做法是**两个名字都进 inject 列表**并注释了原因：`dsh-better-sidebar/src/client/index.tsx:43-50`。
- 本仓库现状：`src/client/index.ts:72` 的 inject 只有 `['slots','sessions','workspaces','connection']`，`resolveRemote`（同文件 `:56`, `:64`）靠 `ctx.get('remote')` 绕过——**`remote` 可以，`remote.session` 不行**。
- 两条可行路径（原型都支持）：
  1. 推荐：`ctx.inject(['remote', 'remote.session'], …)` 拿 scoped ctx，把 `scoped.remote.session` 直接传进 `attach` 第三参。
  2. 诊断/热修：控制台/补丁里 `ctx.get('remote.session')` 实测**无需 inject** 即可返回 `RemoteNamespaceService`（`follow/control/state/page/…` 齐全）。可作为拿不到 scoped 时的兜底。

### 3.4 地址与时序坑

- subagent 会话必须用 `kind:'subagent'` 地址；`mode` 猜错报 `subagent mode does not match`（原型遇错自动换一次 `one-shot`）。
- `activate` **不能省**：省掉后 snapshot 的 `assistantStream` 只剩 `{"revision":N}`，没有 `activeAttempt`，实测 12s 零实时帧。语义是"请求后台激活；省略则纯被动读"，被动读不带进程内帧。
- `activate:true` 会挂在会话上 → **只对 `running===true` 的会话开流**，并在 `api-session/status` 转 false 时立刻 `abort()`。绝不要为 153 个会话全开。
- `follow` 返回 **async iterable**（不是 iterator），必须 `[Symbol.asyncIterator]()`；直接 `.next()` 会得到 `it.next is not a function`（实测）。
- 原型里 `pending`（模型刚提出、`tool/call` 还没到）与 `running`（已 dispatch）**共用「正在执行：」前缀**，这样从"提议"到"真跑"卡片文字不跳；两者的区别只体现在参数完整度上。若想区分，把 `pending` 那行的前缀改成「准备执行：」即可（`textFor` 里两行相邻）。
- 老代码不要用 `for await`：ES5 目标下会被降级成 regenerator。原型用 `.next().then()` 递归，无 async 语法。

### 3.5 降级阶梯（拿不到就少显示，不报错）

1. **实时帧拿不到**（inject 被拒 / 协议变）：`attach` 返回 `false`，`textFor` 全部返回 `''` → 卡片退回现有 preview，零视觉回归。
2. **只剩持久事件**（`assistantStream` 变）：仍能出「正在执行：`tool/call` 的 name + 参数摘要」和 `step/end` 清行——工具那半句是纯事件驱动，不依赖流。
3. **连事件都没有**（`follow` 整体不可用）：退回 `$on('api-session/status')` 的 running 灯 + 现有的 `session-activity.ts` 完成标记，功能面与今天一致。
4. **一律 try/catch**：`apply()` 抛异常的代价是整页 web shell 起不来（`src/client/index.ts:1-7` 的失败政策），所以 `attach` 内部任何一行都不能让异常逃出去。

### 3.6 未验证项（诚实标注）

- `frame.type==='start'` 未实拍：中途 attach 一律走 `snapshot.assistantStream.activeAttempt` 基线，本轮没撞上一次"开流瞬间正好开始新 attempt"。形状取自 schema（§1.2 ④）。
- `text-delta` 未实拍：本轮会话的正文输出极少（只有 reasoning + tool-call）。形状同类推断自 `reasoning-delta` 与 region 里的折叠代码（`case "text-delta": { ... text: previous.text + chunk.text }`）。
- `ctx.get('remote.session')` 在**插件 fiber 内**未实测（控制台实测通过；fiber 内推荐走 `ctx.inject`）。
