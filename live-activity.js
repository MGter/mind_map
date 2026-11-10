// mind_map · 会话实时活动（正在思考 / 正在回复 / 正在执行）
// 取数通道：ctx.remote.session.follow({address, activate:true, assistantStream:true}) 的异步流。
// 帧：snapshot / assistant-stream(start|chunk|end) / event(tool/call、tool/result、step/end)。
// 帧率实测 40-55/s，所以对外只做 150ms 合并通知；拿不到通道时 textFor 全返回 ''。
// 详细证据见 docs/live-activity-notes.md。
var mindMapLive = (function () {
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

  /** 会话行说自己还在跑吗（模型请求在飞、但流里还没吐出任何文本时用它兜底）。 */
  function isRunning(id) {
    try {
      var snap = listRef ? listRef.getSnapshot() : null;
      var row = snap && snap.byId ? snap.byId[id] : null;
      return !!(row && row.running === true);
    } catch (e) { return false; }
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
    /** 接线程/开流/有状态的会话数，排障用（不影响渲染）。 */
    debug: function () {
      return { attached: ns !== null, streams: Object.keys(streams), sessions: Object.keys(states), listeners: listeners.length };
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
      // 模型请求在飞、还没有第一个 delta —— 和外壳聊天区显示的是同一个状态。
      if (isRunning(sessionId)) return '正在分析请求';
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
