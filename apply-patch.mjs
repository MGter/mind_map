// mind-map graph view patch (v1)
// Adds an Obsidian-like graph mode to the installed mind_map plugin:
//   * 图谱/白板 toggle (persisted in localStorage)
//   * graph mode = free card positions (no slot layout), no workspace frames,
//     no overflow stacks
//   * automatic edges: fork lineage (existing) + same-workspace chains +
//     shared-tag chains (LLM tags from the digest, keyword tags as fallback)
//   * force-directed auto layout, drag a card to pin it
//   * host: digest prompt/schema now also produces `tags`
//
// Usage:  node apply-patch.mjs                    (apply every edit)
//         node apply-patch.mjs --revert           (restore the .mindmap-graph-backup files)
//         node apply-patch.mjs --list             (print every edit label, grouped)
//         node apply-patch.mjs --only=a,b         (bisect: apply exactly these labels)
//         node apply-patch.mjs --skip=a,b         (bisect: apply everything except these)
//         node apply-patch.mjs --dry-run          (apply in memory, print the size delta)
//         node apply-patch.mjs --pkg=<dir>        (patch another package dir; default cwd)
//
// The patcher is anchor based and asserts that every anchor matches exactly
// once, so a plugin upgrade fails loudly instead of silently mis-patching.
// Every edit is one labelled entry, so a broken build can be bisected by label
// instead of by eyeballing a diff (that is how the "panel does not open" crash
// of 2026-11-09 was found: two `replace:` keys in one object literal, the second
// one silently winning).
//
// Always reverts/rebuilds from the pristine .mindmap-graph-backup files: the
// base is the npm build of 0.1.66, never a previously patched file.

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import vm from "node:vm";
import path from "node:path";
import { compileStatusRail, readLegacyStatusRail } from "./scripts/compile-status-rail.mjs";

const ARGS = process.argv.slice(2);
function argValue(name) {
  const flag = "--" + name;
  const hit = ARGS.find((value) => value === flag || value.startsWith(flag + "="));
  if (hit === undefined) return null;
  const equals = hit.indexOf("=");
  return equals < 0 ? "" : hit.slice(equals + 1);
}
function argList(name) {
  const raw = argValue(name);
  if (raw === null) return null;
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

const PKG = (function () {
  const override = argValue("pkg");
  return override === null || override === "" ? process.cwd() : path.resolve(override);
})();
const CLIENT = path.join(PKG, "client", "client.js");
// 实时活动模块单独放一个文件：它进 String.raw 模板前要先能自己 node --check，
// 也免去在模板里跟反引号/转义搏斗。
const HERE = typeof import.meta.dirname === "string" ? import.meta.dirname : path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const LIVE_BLOCK = readFileSync(path.join(HERE, "live-activity.js"), "utf8");
const HOST = path.join(PKG, "lib", "index.js");
// 画布这一半单独放一个文件：能 node --check，也不用在 String.raw 里跟转义搏斗。
const GRAPH_SURFACE_BLOCK = readFileSync(path.join(HERE, "src", "graph", "graph-surface.js"), "utf8");
const MARK = "MIND_MAP_GRAPH_PATCH_V1";
const BACKUP_SUFFIX = ".mindmap-graph-backup";
// 换名：构建产物里的包名/存储域/变量名统一从 mind-map 改成 mind-map。
// 必须在所有锚点匹配之后做（锚点里本来就带旧名字）。
// 用拼接写源串：这样以后再跑一次全库改名，也不会把这张表改成恒等映射。
const RENAME_PAIRS = [
  ["dsh-" + "tal" + "k-map", "mind_map"],
  ["tal" + "k-map", "mind_map"],
  ["tal" + "k_map", "mind_map"],
  ["tal" + "kMap", "mindMap"],
  ["TAL" + "K_MAP", "MIND_MAP"],
  ["tal" + "kmap", "mindmap"],
  ["Tal" + "kMap", "MindMap"],
  ["对话地图", "思维图"],
  [" ·v2", ""],
  ["·v2", ""]
];
function renameAll(code) {
  let out = code;
  for (const pair of RENAME_PAIRS) out = out.split(pair[0]).join(pair[1]);
  return out;
}

const revert = ARGS.includes("--revert");
const dryRun = ARGS.includes("--dry-run");
const listOnly = ARGS.includes("--list");
const only = argList("only");
const skip = argList("skip") || [];

/** Labels that every other edit builds on: skipping them is never a valid build. */
const PREREQUISITES = ["css", "module-block"];

function assertUniqueLabels(edits, kind) {
  const seen = new Set();
  for (const edit of edits) {
    if (typeof edit.label !== "string" || edit.label === "") throw new Error("[" + kind + "] an edit has no label");
    if (typeof edit.find !== "string" || edit.find === "") throw new Error("[" + kind + "] edit '" + edit.label + "' has no find anchor");
    if (typeof edit.replace !== "string") throw new Error("[" + kind + "] edit '" + edit.label + "' has no replace text (did you write two `replace:` keys in one object?)");
    if (edit.find === edit.replace) throw new Error("[" + kind + "] edit '" + edit.label + "' replaces the anchor with itself");
    if (seen.has(edit.label)) throw new Error("[" + kind + "] duplicate label '" + edit.label + "'");
    seen.add(edit.label);
  }
}

function selectEdits(edits, kind) {
  const known = edits.map((edit) => edit.label);
  for (const label of [...(only || []), ...skip]) {
    if (!known.includes(label)) throw new Error("[" + kind + "] unknown label '" + label + "' — run --list to see the labels");
  }
  let selected;
  if (only === null) selected = edits.filter((edit) => !skip.includes(edit.label));
  else selected = edits.filter((edit) => only.includes(edit.label));
  if (only !== null) {
    const missing = PREREQUISITES.filter((label) => known.includes(label) && !only.includes(label));
    if (missing.length > 0) console.log("  warning: --only leaves out " + missing.join(", ") + "; the build will not run");
  }
  const dropped = edits.filter((edit) => !selected.includes(edit));
  console.log("[edit] " + kind + ": " + selected.length + "/" + edits.length + " edits" +
    (dropped.length === 0 ? "" : " (skipping: " + dropped.map((edit) => edit.label).join(", ") + ")"));
  return selected;
}

/** The client bundle is evaluated with `new Function`, so a plain script parse is
 * the right gate: it catches a stray `}` before the build ever reaches the app.
 * The host is a real ES module, which vm.Script refuses to parse — hand it to
 * `node --check` instead. */
function assertParses(code, label, mode) {
  if (mode === "module") {
    const temp = path.join(os.tmpdir(), "mind-map-parse-" + process.pid + "-" + Date.now() + ".mjs");
    writeFileSync(temp, code);
    const result = spawnSync(process.execPath, ["--check", temp], { encoding: "utf8" });
    unlinkSync(temp);
    // Sandboxed sessions block a child process that captures piped stdio, so the
    // gate degrades to a note instead of failing a build that is fine. Check the
    // host separately with:  node --check <copy>.mjs
    if (result.error !== undefined && result.error !== null) {
      console.log("  note: cannot run node --check here (" + (result.error.code || result.error.message) + "); host gate skipped");
      return;
    }
    if (result.status !== 0) {
      throw new Error("[syntax] " + label + " does not parse:\n" + String(result.stderr || "").trim());
    }
    return;
  }
  try {
    new vm.Script(code, { filename: label });
  } catch (error) {
    throw new Error("[syntax] " + label + " does not parse: " + error.message);
  }
}

function backup(file) {
  const bak = file + BACKUP_SUFFIX;
  if (!existsSync(bak)) copyFileSync(file, bak);
  return bak;
}

function applyEdits(source, edits, label) {
  let out = source;
  for (const edit of edits) {
    const expected = edit.count === undefined ? 1 : edit.count;
    const parts = out.split(edit.find);
    const found = parts.length - 1;
    if (found !== expected) {
      const probeAt = out.indexOf("client bundle failed to evaluate");
      const probeContext = probeAt < 0 ? "none" : JSON.stringify(out.slice(Math.max(0, probeAt - 70), probeAt + 30));
      throw new Error(
        "[" + label + "] anchor '" + edit.label + "' matched " + found + " times, expected " + expected + "\n" +
        "  anchor head: " + JSON.stringify(edit.find.slice(0, 120)) +
        "\n  probe: " + probeContext
      );
    }
    out = parts.join(edit.replace);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. module-level block: graph mode store, tag extraction, force layout */
/* ------------------------------------------------------------------ */

const MODULE_BLOCK = String.raw`
// ===== mind-map graph view patch (local) =====
// MIND_MAP_GRAPH_PATCH_V1 — the marker the patcher greps for; without it a
// second run would happily patch the already patched bundle.
// 换名迁移：旧构建用的 dsh.mind_map.* 浏览器偏好键，一次性复制到 dsh.mind_map.*。
// 不删旧键（回退到旧构建仍能读到），只在新键缺失时复制。前缀用拼接写，避免
// 下面 renameAll 把这段迁移代码自己也换掉。
(function migrateBrowserKeys() {
  try {
    var nextPrefix = "dsh." + "min" + "d_map" + ".";
    // 两代旧前缀：dsh.talk-map.*（0.1.66）与 dsh.mind-map.*（我改名前那版）
    var legacyPrefixes = ["dsh." + "tal" + "k-map" + ".", "dsh." + "min" + "d-map" + "."];
    var index;
    for (index = 0; index < window.localStorage.length; index += 1) {
      var legacyKey = window.localStorage.key(index);
      if (legacyKey === null) continue;
      for (var which = 0; which < legacyPrefixes.length; which += 1) {
        var legacyPrefix = legacyPrefixes[which];
        if (legacyKey.indexOf(legacyPrefix) !== 0) continue;
        var migratedKey = nextPrefix + legacyKey.slice(legacyPrefix.length);
        if (window.localStorage.getItem(migratedKey) === null) window.localStorage.setItem(migratedKey, window.localStorage.getItem(legacyKey));
        break;
      }
    }
  } catch (error) { }
})();
var GRAPH_MODE_KEY = "dsh.mind_map.graph-mode.v1";
var GRAPH_LAID_KEY = "dsh.mind_map.graph-laid.v1";
var HIDE_ARCHIVED_KEY = "dsh.mind_map.hide-archived.v1";
var graphModeState = true;
// 白板（槽位平铺的卡片视图）已经彻底删掉：这里恒为 true，图表面永远走云图。
// 保留这几个函数是因为下面的补丁点（slot layout / 分组 / 堆叠）都挂在 graphOn 上。
try { window.localStorage.removeItem(GRAPH_MODE_KEY); } catch (error) { }
var graphModeListeners = new Set();
function graphModeGet() { return true; }
function graphModeSubscribe(listener) {
  graphModeListeners.add(listener);
  return function () { graphModeListeners.delete(listener); };
}
function graphModeSet(next) {
  if (graphModeState === next) return;
  graphModeState = next;
  try { window.localStorage.setItem(GRAPH_MODE_KEY, next ? "1" : "0"); } catch (error) { }
  // Entering the graph view re-runs the auto layout: the whiteboard view keeps
  // rewriting card positions into slots, so the stored x/y is stale by then.
  if (next) try { window.localStorage.removeItem(GRAPH_LAID_KEY); } catch (error) { }
  for (const listener of graphModeListeners) { try { listener(); } catch (error) { } }
}
/** "Hide archived cards" is a graph-view preference, persisted per browser.
 * Archived is the DEFAULT: a board where two thirds of the cards are sessions
 * you already archived is noise, so you opt in to seeing them. */
var hideArchivedState = true;
try { hideArchivedState = window.localStorage.getItem(HIDE_ARCHIVED_KEY) !== "0"; } catch (error) { hideArchivedState = true; }
var hideArchivedListeners = new Set();
function hideArchivedGet() { return hideArchivedState; }
function hideArchivedSubscribe(listener) {
  hideArchivedListeners.add(listener);
  return function () { hideArchivedListeners.delete(listener); };
}
function hideArchivedSet(next) {
  if (hideArchivedState === next) return;
  hideArchivedState = next;
  try { window.localStorage.setItem(HIDE_ARCHIVED_KEY, next ? "1" : "0"); } catch (error) { }
  for (const listener of hideArchivedListeners) { try { listener(); } catch (error) { } }
}
/** Hook the canvas surface installs so the "重新排布" button can restart the
 * running simulation instead of only writing new coordinates. */
var mindMapSimKick = { fn: null };
/** The canvas owns its own camera, so React Flow's screenToFlowPosition (which
 * degrades to "return the client point" when no React Flow is mounted) cannot
 * answer where a click landed. The canvas registers the real conversion here;
 * the context menu uses it for "place the new thing at the click". */
var mindMapCanvasToFlow = { fn: null };
/** 跳转居中：点状态栏里的一条（或任何"带我去那张卡"的入口）时，把那张卡
 * 平移到视口正中。图谱模式下 React Flow 没挂载，插件的 setCenter 直接
 * return false，所以镜头必须由 canvas 自己缓动过去。 */
var mindMapCenterKick = { fn: null };
/** Frames actually painted: lets the verification scripts prove that an idle
 * map stops drawing instead of only looking still. */
var mindMapDrawCount = 0;
var FOCUS_MODE_KEY = "dsh.mind_map.focus-mode.v1";
var FOCUS_DEPTH = 2;
var DOT_SIZE = 16;
var focusModeState = true;
try { focusModeState = window.localStorage.getItem(FOCUS_MODE_KEY) !== "0"; } catch (error) { focusModeState = true; }
var focusModeListeners = new Set();
function focusModeGet() { return focusModeState; }
function focusModeSubscribe(listener) {
  focusModeListeners.add(listener);
  return function () { focusModeListeners.delete(listener); };
}
function focusModeSet(next) {
  if (focusModeState === next) return;
  focusModeState = next;
  try { window.localStorage.setItem(FOCUS_MODE_KEY, next ? "1" : "0"); } catch (error) { }
  for (const listener of focusModeListeners) { try { listener(); } catch (error) { } }
}
var GRAPH_TAG_STOP = new Set(["这个", "那个", "一个", "可以", "我们", "什么", "如果", "因为", "所以", "就是", "不是", "没有", "已经", "还是", "这样", "那样", "然后", "现在", "需要", "使用", "通过", "进行", "问题", "东西", "时候", "一些", "这些", "那些", "自己", "他们", "它们", "如何", "以及", "并且", "但是", "而且", "或者", "其中", "一样", "之前", "之后", "里面", "上面", "下面", "这里", "那里", "一下", "一点", "比较", "非常", "应该", "可能", "觉得", "知道", "看到", "出来", "进去", "回到", "开始", "结束", "完成", "直接", "一起", "两个", "三个", "一份", "一次", "目前", "当前", "原来", "其实", "当然", "仍然", "只是", "还有", "例如", "比如", "包括", "相关", "部分", "情况", "结果", "方法", "方式", "内容", "功能", "工具", "数据", "文件", "代码", "项目", "时间", "今天", "昨天", "明天", "最近", "任务", "并且", "没有", "不会", "不能", "是不是", "有没有", "怎么样", "为什么", "怎么办", "一样", "这种", "那种", "多少", "这里", "那边", "起来", "下来", "出去", "过来", "以后", "以前", "同时", "另外", "此外", "因此", "于是", "不过", "虽然", "只要", "只有", "无论", "不管", "即使", "除非", "除了"]);
var GRAPH_TAG_STOP_EN = new Set(["the", "and", "for", "with", "that", "this", "from", "have", "has", "had", "was", "were", "are", "not", "but", "you", "your", "can", "will", "would", "should", "could", "they", "them", "there", "their", "about", "into", "over", "than", "then", "when", "what", "which", "while", "also", "just", "like", "make", "made", "more", "most", "only", "some", "such", "take", "very", "well", "been", "being", "both", "each", "other", "same", "because", "before", "after", "between", "through", "under", "again", "still", "much", "many", "need", "needs", "used", "using", "use", "does", "did", "doing", "done", "get", "gets", "got", "one", "two", "three", "new", "old", "first", "last", "next", "now", "here", "where", "how", "why", "all", "any", "out", "off", "own", "too", "per", "via", "yet", "its", "http", "https", "www", "com", "html", "json", "true", "false", "null"]);
var GRAPH_TAG_CHAR_STOP = "的了与和是在有个也就都而及或把被让使从向对为以于之其这那些上中里外前后时两三二一几第各每全更最很太又再还只才已未不没无非别等着过吧呢啊吗嗯哦呀么";
function graphTagTokens(text) {
  const out = [];
  const source = String(text === undefined || text === null ? "" : text).toLowerCase();
  const ascii = source.match(/[a-z][a-z0-9_+#.\-]{2,}/g);
  if (ascii !== null) for (const word of ascii) { if (!GRAPH_TAG_STOP_EN.has(word)) out.push(word); }
  const cjk = source.match(/[\u4e00-\u9fa5]{2,}/g);
  if (cjk !== null) for (const run of cjk) {
    for (let length = 2; length <= 4; length += 1) {
      for (let cursor = 0; cursor + length <= run.length; cursor += 1) {
        const gram = run.slice(cursor, cursor + length);
        if (GRAPH_TAG_STOP.has(gram)) continue;
        if (GRAPH_TAG_CHAR_STOP.indexOf(gram.charAt(0)) >= 0) continue;
        if (GRAPH_TAG_CHAR_STOP.indexOf(gram.charAt(gram.length - 1)) >= 0) continue;
        out.push(gram);
      }
    }
  }
  return out;
}
/** Keyword tags derived from the digests already on disk (no LLM call). */
function graphDeriveTags(digests) {
  const docs = {};
  const documentFrequency = new Map();
  let total = 0;
  for (const entry of Object.entries(digests || {})) {
    const digest = entry[1];
    if (digest === undefined || digest === null) continue;
    const text = [digest.summary || "", (digest.keyFindings || []).join(" ")].join(" ");
    const termFrequency = new Map();
    for (const token of graphTagTokens(text)) termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
    if (termFrequency.size === 0) continue;
    docs[entry[0]] = termFrequency;
    total += 1;
    for (const token of termFrequency.keys()) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
  const out = {};
  const ceiling = Math.max(3, Math.round(total * 0.2));
  for (const entry of Object.entries(docs)) {
    const scored = [];
    for (const term of entry[1]) {
      const frequency = documentFrequency.get(term[0]) || 0;
      if (frequency < 2 || frequency > ceiling) continue;
      const length = term[0].length;
      const lengthBonus = length >= 3 ? 1.5 + 0.15 * (length - 3) : 1;
      scored.push([term[0], term[1] * Math.log(1 + total / frequency) * lengthBonus]);
    }
    scored.sort(function (left, right) { return right[1] - left[1]; });
    const picked = [];
    for (const candidate of scored) {
      const token = candidate[0];
      let redundant = false;
      for (const chosen of picked) {
        if (chosen.indexOf(token) >= 0) { redundant = true; break; }
      }
      if (redundant) continue;
      for (let index = picked.length - 1; index >= 0; index -= 1) {
        if (token.indexOf(picked[index]) >= 0) picked.splice(index, 1);
      }
      picked.push(token);
      if (picked.length >= 3) break;
    }
    out[entry[0]] = picked;
  }
  return out;
}
/** Fruchterman-Reingold + rectangle separation; deterministic for equal input. */
function graphLayoutForce(entries, links, options) {
  const settings = options || {};
  const width = settings.width || 224;
  const height = settings.height || 120;
  const count = entries.length;
  const result = {};
  if (count === 0) return result;
  if (count === 1) { result[entries[0].id] = { x: entries[0].x, y: entries[0].y }; return result; }
  const ideal = settings.ideal || Math.sqrt((width + 120) * (height + 90)) * 1.45;
  const nodes = entries.map(function (entry, position) {
    const angle = (position / count) * Math.PI * 2;
    return { id: entry.id, x: entry.x + Math.cos(angle) * 8, y: entry.y + Math.sin(angle) * 8, dx: 0, dy: 0 };
  });
  const lookup = new Map();
  nodes.forEach(function (node, position) { lookup.set(node.id, position); });
  const springs = [];
  for (const link of links || []) {
    const from = lookup.get(link[0]);
    const to = lookup.get(link[1]);
    if (from === undefined || to === undefined || from === to) continue;
    springs.push([from, to]);
  }
  let centerX = 0;
  let centerY = 0;
  for (const node of nodes) { centerX += node.x; centerY += node.y; }
  centerX = centerX / count;
  centerY = centerY / count;
  let temperature = ideal * 0.9;
  const iterations = settings.iterations || 180;
  const repulsionRange = settings.repulsionRange || ideal * 1.45;
  const gravity = settings.gravity || 0.12;
  for (let step = 0; step < iterations; step += 1) {
    for (const node of nodes) { node.dx = 0; node.dy = 0; }
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        let deltaX = nodes[left].x - nodes[right].x;
        let deltaY = nodes[left].y - nodes[right].y;
        let distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (distance < 0.01) {
          deltaX = ((left % 7) - 3) + 0.5;
          deltaY = ((right % 7) - 3) + 0.5;
          distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
        }
        // Bounded-range repulsion: without the cutoff a 60-node board explodes
        // to a 25k-pixel square, which is unreadable even zoomed out.
        const force = distance < repulsionRange ? (ideal * ideal) / distance : 0;
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        nodes[left].dx += unitX * force;
        nodes[left].dy += unitY * force;
        nodes[right].dx -= unitX * force;
        nodes[right].dy -= unitY * force;
      }
    }
    for (const spring of springs) {
      const from = nodes[spring[0]];
      const to = nodes[spring[1]];
      const deltaX = to.x - from.x;
      const deltaY = to.y - from.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
      const force = (distance * distance) / ideal;
      const unitX = deltaX / distance;
      const unitY = deltaY / distance;
      from.dx += unitX * force;
      from.dy += unitY * force;
      to.dx -= unitX * force;
      to.dy -= unitY * force;
    }
    for (const node of nodes) {
      node.dx += (centerX - node.x) * gravity;
      node.dy += (centerY - node.y) * gravity;
      const length = Math.sqrt(node.dx * node.dx + node.dy * node.dy) || 1;
      const limited = Math.min(length, temperature);
      node.x += (node.dx / length) * limited;
      node.y += (node.dy / length) * limited;
    }
    temperature = Math.max(ideal * 0.02, temperature * 0.965);
  }
  const padX = 30;
  const padY = 24;
  for (let pass = 0; pass < (settings.collisionPasses || 24); pass += 1) {
    let moved = false;
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        const first = nodes[left];
        const second = nodes[right];
        const overlapX = (width + padX) - Math.abs(second.x - first.x);
        const overlapY = (height + padY) - Math.abs(second.y - first.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        if (overlapX < overlapY) {
          const push = (overlapX / 2) * (second.x >= first.x ? 1 : -1);
          second.x += push;
          first.x -= push;
        } else {
          const push = (overlapY / 2) * (second.y >= first.y ? 1 : -1);
          second.y += push;
          first.y -= push;
        }
      }
    }
    if (!moved) break;
  }
  for (const node of nodes) result[node.id] = { x: Math.round(node.x), y: Math.round(node.y) };
  return result;
}
/** Face pair for a graph edge: dominant axis only. The slot layout's
 * pickFaces searches for clearance between grid neighbours and returns
 * top/bottom faces for far-apart cards, which turns a straight relationship
 * into a loop that sweeps across the board. */
function graphFaces(fromCard, toCard) {
  if (fromCard === void 0 || toCard === void 0) return { sourceHandle: "r", targetHandle: "l" };
  const deltaX = toCard.x - fromCard.x;
  const deltaY = toCard.y - fromCard.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? { sourceHandle: "r", targetHandle: "l" } : { sourceHandle: "l", targetHandle: "r" };
  }
  return deltaY >= 0 ? { sourceHandle: "b", targetHandle: "t" } : { sourceHandle: "t", targetHandle: "b" };
}
function graphSameNode(left, right) {
  if (left.selected !== right.selected) return false;
  if (left.hidden !== right.hidden) return false;
  if (left.className !== right.className) return false;
  if (left.position.x !== right.position.x || left.position.y !== right.position.y) return false;
  const a = left.data;
  const b = right.data;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) { if (a[key] !== b[key]) return false; }
  return true;
}
/** Reuse the previous node object when nothing it renders actually changed:
 * React Flow keys its internal node cache by object identity, so a stable
 * reference lets it skip re-rendering that card entirely. */
function graphStableNode(cache, cardId, next) {
  const previous = cache.get(cardId);
  if (previous !== void 0 && graphSameNode(previous, next)) return previous;
  cache.set(cardId, next);
  return next;
}
var mindMapTapBridge = { live: null };
var mindMapCanvasBridge = { current: null };
(function installMindMapTap() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  var started = null;
  var cardOf = function (target) {
    return target !== null && typeof target === "object" && typeof target.closest === "function" ? target.closest("[data-mindmap-session]") : null;
  };
  window.addEventListener("pointerdown", function (event) {
    var element = cardOf(event.target);
    if (element === null) { started = null; return; }
    var box = element.getBoundingClientRect();
    started = { sessionId: element.getAttribute("data-mindmap-session"), x: event.clientX, y: event.clientY, box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } };
  }, true);
  window.addEventListener("pointerup", function (event) {
    var from = started;
    started = null;
    var live = mindMapTapBridge.live;
    if (from === null || live === null || live.batchMode) return;
    // React Flow's own click dies as soon as the pointer moves a pixel: d3-drag's
    // gesture handlers call stopImmediatePropagation() on the window capture
    // phase, so a real mouse — which always jitters — silently did nothing on a
    // card. Handle 1-10 px of travel here as a tap.
    var moved = Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y);
    if (moved === 0 || moved > 10) return;
    // The card moved with the pointer, so event.target at pointerup is the pane,
    // not the card: hit-test by geometry instead of by target identity.
    if (event.clientX < from.box.left - 12 || event.clientX > from.box.right + 12) return;
    if (event.clientY < from.box.top - 12 || event.clientY > from.box.bottom + 12) return;
    if (live.sessions.byId[from.sessionId] === void 0) return;
    var sessionId = from.sessionId;
    window.setTimeout(function () {
      var current = mindMapTapBridge.live;
      if (current === null) return;
      current.open(sessionId);
    }, 0);
  }, true);
})();
/** Where a line between two centres leaves a rectangle: the classic four-way
 * face pick, but exact (it lands on whichever side actually faces the other
 * node, including corners), so it re-routes continuously while dragging. */
function graphAnchorPoint(centerX, centerY, width, height, towardX, towardY) {
  const deltaX = towardX - centerX;
  const deltaY = towardY - centerY;
  if (deltaX === 0 && deltaY === 0) return { x: centerX, y: centerY };
  const scaleX = Math.abs(deltaX) < 1e-6 ? Infinity : (width / 2) / Math.abs(deltaX);
  const scaleY = Math.abs(deltaY) < 1e-6 ? Infinity : (height / 2) / Math.abs(deltaY);
  const scale = Math.min(scaleX, scaleY);
  return { x: centerX + deltaX * scale, y: centerY + deltaY * scale };
}
function GraphLineEdge(props) {
  const boxes = useStore(function (state) {
    const from = state.nodeLookup.get(props.source);
    const to = state.nodeLookup.get(props.target);
    if (from === void 0 || to === void 0) return null;
    return {
      ax: from.internals.positionAbsolute.x,
      ay: from.internals.positionAbsolute.y,
      aw: from.measured.width || 0,
      ah: from.measured.height || 0,
      bx: to.internals.positionAbsolute.x,
      by: to.internals.positionAbsolute.y,
      bw: to.measured.width || 0,
      bh: to.measured.height || 0
    };
  }, shallow$1);
  if (boxes === null || boxes.aw === 0 || boxes.bw === 0) return null;
  const fromCenterX = boxes.ax + boxes.aw / 2;
  const fromCenterY = boxes.ay + boxes.ah / 2;
  const toCenterX = boxes.bx + boxes.bw / 2;
  const toCenterY = boxes.by + boxes.bh / 2;
  const start = graphAnchorPoint(fromCenterX, fromCenterY, boxes.aw, boxes.ah, toCenterX, toCenterY);
  const end = graphAnchorPoint(toCenterX, toCenterY, boxes.bw, boxes.bh, fromCenterX, fromCenterY);
  const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
  const ready = props.data === void 0 || props.data.ready !== false;
  return (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
    (0, import_jsx_runtime16.jsx)(BaseEdge, {
      id: props.id,
      path: "M " + start.x + " " + start.y + " L " + end.x + " " + end.y,
      style: { stroke: "rgba(198, 206, 220, 0.34)", strokeWidth: 1.1, opacity: ready ? 1 : 0 }
    }),
    (0, import_jsx_runtime16.jsx)("path", {
      d: "M0 0 L-9 -4 L-9 4 Z",
      transform: "translate(" + end.x + " " + end.y + ") rotate(" + angle + ")",
      fill: "rgba(198, 206, 220, 0.42)",
      opacity: ready ? 1 : 0,
      pointerEvents: "none"
    })
  ] });
}
function GraphDotNode(props) {
  const data = props.data ?? {};
  const className = "tm_dot" + (data.running === true ? " tm_dotRunning" : "") + (data.waiting === true ? " tm_dotWaiting" : "") + (data.glow === "done" ? " tm_dotDone" : "");
  const hoverIn = function (event) { if (typeof data.onHover === "function") data.onHover(data.cardId, event.clientX, event.clientY); };
  const hoverOut = function () { if (typeof data.onHover === "function") data.onHover(null, 0, 0); };
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", {
    className: className,
    "data-mindmap-session": data.sessionId,
    "data-mindmap-dot": "1",
    onMouseEnter: hoverIn,
    onMouseMove: hoverIn,
    onMouseLeave: hoverOut,
    children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Handle, { id: "t", type: "source", position: Position.Top, className: "tm_dotHandle" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Handle, { id: "l", type: "source", position: Position.Left, className: "tm_dotHandle" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Handle, { id: "r", type: "source", position: Position.Right, className: "tm_dotHandle" }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(Handle, { id: "b", type: "source", position: Position.Bottom, className: "tm_dotHandle" })
    ]
  });
}
var GRAPH_CAMERA_KEY = "dsh.mind_map.graph-camera.v1";
var GRAPH_CARD_RENDER_H = 124;
var GRAPH_FONT_STACK = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";
function readGraphCamera() {
  try {
    var raw = window.localStorage.getItem(GRAPH_CAMERA_KEY);
    if (raw === null) return null;
    var parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && typeof parsed.x === "number" && typeof parsed.y === "number" && typeof parsed.zoom === "number") {
      return { x: parsed.x, y: parsed.y, zoom: parsed.zoom };
    }
  } catch (error) { }
  return null;
}
function writeGraphCamera(camera) {
  try { window.localStorage.setItem(GRAPH_CAMERA_KEY, JSON.stringify(camera)); } catch (error) { }
}
function graphRoundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
function graphEllipsis(context, text, maxWidth) {
  if (text === "" || context.measureText(text).width <= maxWidth) return text;
  var low = 0;
  var high = text.length;
  while (low < high) {
    var middle = Math.ceil((low + high) / 2);
    if (context.measureText(text.slice(0, middle) + "…").width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return text.slice(0, low) + "…";
}
${GRAPH_SURFACE_BLOCK}
/** 只有一种视图：云图（canvas）。白板 / React Flow 那一套已经删掉，不再挂载。 */
function GraphSurface(props) {
  return (0, import_jsx_runtime16.jsx)(GraphCanvasSurface, props);
}
function GraphBar(props) {
  const children = [];
  children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
    type: "button",
    className: "tm_graphBtn" + (props.focusOn === true ? " tm_graphBtnActive" : ""),
    title: "聚焦：只把当前会话那个点点亮，其余点 / 连线全部压暗；再点一次关闭",
    onClick: props.onToggleFocus,
    children: props.focusOn === true ? "🎯 聚焦中" : "🎯 聚焦"
  }, "focus"));
  children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
    type: "button",
    className: "tm_graphBtn",
    title: "按连线关系重新做一次力导向排布（拖动过的点也会重新排）",
    onClick: props.onRelayout,
    children: "⟲ 重新排布"
  }, "relayout"));
  children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
    type: "button",
    className: "tm_graphBtn",
    disabled: props.tagBusy === true,
    title: "用默认模型给还没有标签的会话生成标签（每个会话一次 LLM 调用）",
    onClick: props.onGenerateTags,
    children: props.tagBusy === true ? "标签生成中…" : "🏷 生成标签"
  }, "tags"));
  children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
    type: "button",
    className: "tm_graphBtn" + (props.hideArchived === true ? " tm_graphBtnActive" : ""),
    title: "隐藏已归档会话和别的会话跑完的子代理；当前对话自己的子代理跑完只灰化、不会消失；开合状态记在浏览器里",
    onClick: props.onToggleHideArchived,
    children: props.hideArchived === true ? "🗄 已隐藏 " + (props.archivedCount > 0 ? props.archivedCount : "0") : "🗄 显示全部"
  }, "archived"));
  if (props.tagCount > 0) children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", {
    className: "tm_graphHint",
    children: props.tagCount + " 个标签"
  }, "count"));
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "tm_graphBar", role: "toolbar", children: children });
}
/* ---- 侧栏席位：把同一张地图挂进 dsh-better-sidebar 的一栏 ---------------
 * 壳给 slot 组件的标准 props（useSessions / useWorkspaces / useSessionStatus）
 * 在侧栏 tab 里拿不到，所以这里用同一批 store 自己造一份选择器 hook：
 * sessions 用 ctx.sessions.list，workspaces 用 ctx.workspaces.list，
 * sessionStatus 用 slots._rootBinding.hooks.sessionStatus（拿不到就省略，
 * 地图会退化成用列表行自带的字段）。 */
var mindMapSidebarSeat = { service: null, mounted: false, lastOpenAt: 0, opens: 0 };
var mindMapStandardCache = null;
var mindMapApplyCtx = null;
/** 侧栏那一栏的「要不要开着」记在浏览器里：关掉就置 '0'，之后重启不自动弹。 */
var MIND_MAP_SIDEBAR_TAB_KEY = "dsh.mind_map.sidebar-tab.v1";
/** 聚焦锚点：钉在某个卡片上，切换对话时不再跟着当前会话跑（点「聚焦」会重新锚定）。 */
var MIND_MAP_FOCUS_ANCHOR_KEY = "dsh.mind_map.focus-anchor.v1";
var mindMapFocusAnchor = { cardId: null, loaded: false };
function mindMapFocusAnchorGet() {
  if (mindMapFocusAnchor.loaded !== true) {
    mindMapFocusAnchor.loaded = true;
    try { mindMapFocusAnchor.cardId = window.localStorage.getItem(MIND_MAP_FOCUS_ANCHOR_KEY); } catch (error) { mindMapFocusAnchor.cardId = null; }
  }
  return mindMapFocusAnchor.cardId;
}
function mindMapFocusAnchorSet(cardId) {
  mindMapFocusAnchor.loaded = true;
  if (mindMapFocusAnchor.cardId === cardId) return;
  mindMapFocusAnchor.cardId = cardId;
  try {
    if (cardId === null) window.localStorage.removeItem(MIND_MAP_FOCUS_ANCHOR_KEY);
    else window.localStorage.setItem(MIND_MAP_FOCUS_ANCHOR_KEY, cardId);
  } catch (error) { }
}
/** 点「聚焦」= 以当前会话为中心重新锚定。 */
function mindMapFocusAnchorReset() { mindMapFocusAnchorSet(null); }
/** 上次收敛后的可见集合签名：切换会话/重挂面板时如果成员没变，就不再重跑布局和镜头。 */
var MIND_MAP_LAID_SIG_KEY = "dsh.mind_map.layout-signature.v1";
/** 「⟲ 重新排布」后请求一次自动缩放：canvas 挂上这个钩子。 */
var mindMapFitKick = { fn: null };
function mindMapSidebarTabWanted() {
  try { return window.localStorage.getItem(MIND_MAP_SIDEBAR_TAB_KEY) !== "0"; } catch (error) { return true; }
}
function mindMapSidebarTabRemember(open) {
  try { window.localStorage.setItem(MIND_MAP_SIDEBAR_TAB_KEY, open ? "1" : "0"); } catch (error) { }
}
/** 屏幕上到底有没有一张「看得见的」地图。
 *  ⚠️ 2026-11-11：不能只看 "document.querySelector('.tm_sbPanel .tm_graphSurface') !== null"
 *  就判「已在屏」——DSH 壳把非当前 session 的 pane 留在 DOM 里只加 display:none，
 *  better-sidebar 的 tab body 也是 keepMounted，所以切过会话之后页面上会同时存在
 *  好几份 .tm_sbPanel，隐藏那份里的 .tm_graphSurface 照样查得到。历史上这个判定把
 *  「已在屏」判成 true，于是占位按钮不出现、自动 openTab 也不触发，地图再也没回来。 */
function mindMapMapSurfaceVisible() {
  if (typeof document === "undefined" || document === null) return false;
  var surfaces = document.querySelectorAll(".tm_sbPanel .tm_graphSurface");
  for (var surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
    var surfaceBox = surfaces[surfaceIndex].getBoundingClientRect();
    // 隐藏/未布局的盒子宽高是 0；40px 是「真的能看见」的下限（tab 最窄也有几百 px）。
    if (surfaceBox.width >= 40 && surfaceBox.height >= 40) return true;
  }
  return false;
}
/** 开那一栏；没有当前会话时返回 false（better-sidebar 的 tab 必须挂在会话上）。 */
function mindMapOpenSidebarTab(service) {
  if (service === null || service === void 0 || typeof service.openTab !== "function") return false;
  try {
    var snap = typeof service.getSnapshot === "function" ? service.getSnapshot() : null;
    if (snap === null || snap === void 0 || snap.sessionId === void 0) return false;
    // 屏幕上已经有一份「看得见的」思维图就别再开新的：切会话时旧 tab 会随会话消失，
    // 这里只在「当前会话看不到地图」时补一次，避免每切一次就多一个 tab 把界面拖死。
    // 必须是可见性判断：隐藏的那份面板也要算「没开」（2026-11-11）。
    if (typeof document !== "undefined" && document !== null && mindMapMapSurfaceVisible() === true) return true;
    // 连打开栏会把 better-sidebar 拖进「每帧重排」的死循环（实测 6 次 openTab 后帧率
    // 从 60 掉到 1，且摘掉地图也不恢复），所以这里做冷却：8 秒内最多开一次。
    var now = Date.now();
    if (now - mindMapSidebarSeat.lastOpenAt < 8000) return false;
    mindMapSidebarSeat.lastOpenAt = now;
    mindMapSidebarSeat.opens += 1;
    service.openTab({ type: "mind_map:map", title: t("map.title") });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 右栏为空时的占位按钮：只有点它才 openTab。
 * better-sidebar 被连续 openTab 会把整页拖到 1fps，所以这里绝不自动开。
 */
function mindMapMountLauncher(service) {
  if (typeof document === "undefined" || document === null) return;
  var button = null;
  var ensure = function () {
    if (button === null) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "tm_launcher";
      button.setAttribute("data-mind-map-launcher", "1");
      button.title = "打开思维图（只有点这里才会开，避免自动开栏把侧栏拖卡）";
      button.appendChild(document.createTextNode("\u{1F9E0} 打开思维图"));
      button.addEventListener("click", function () {
        var now = Date.now();
        if (now - mindMapSidebarSeat.lastOpenAt < 1500) return;
        mindMapSidebarSeat.lastOpenAt = now;
        var opened = false;
        try { opened = mindMapOpenSidebarTab(service) === true; } catch (error) { opened = false; }
        // 侧栏开不出来（没有当前会话 / better-sidebar 不在）时兜底到中间栏，保证点了就有东西。
        if (opened !== true) { try { openMapPanel(); } catch (error) { } }
        window.setTimeout(function () {
          if (mindMapMapSurfaceVisible() !== true) {
            try { openMapPanel(); } catch (error) { }
          }
        }, 2200);
      });
      if (document.body !== null) document.body.appendChild(button);
    }
    // 自愈：面板在、但地图没挂进去（换占位时漏挂 / 宿主被摘下）就补挂一次。
    // ⚠️ 2026-11-11 修：只能认「看得见」的面板。以前这里是
    //   var panel = document.querySelector(".tm_sbPanel");          // 文档序第一份
    // 切过会话之后页面上有好几份 .tm_sbPanel，文档序第一份通常是**上一个 session
    // 的隐藏面板**（display:none，宽高 0），于是每 1.5s 就把宿主 appendChild 搬进去：
    // 可见 tab 里的地图被抢走只剩黑底，而搬完「宿主已在隐藏面板里」又让巡检停手，
    // 再也不会自己回来（占位按钮和自动 openTab 也被「存在即在屏」的判定骗住）。
    // 现在的规则：只在宽高都 ≥ 40 的可见面板里挑最高的那份挂；一份可见的都没有就什么都不做。
    var panel = null;
    var holder = null;
    var bestHeight = 0;
    var allPanels = document.querySelectorAll(".tm_sbPanel");
    for (var panelIndex = 0; panelIndex < allPanels.length; panelIndex += 1) {
      var candidate = allPanels[panelIndex];
      var candidateBox = candidate.getBoundingClientRect();
      if (candidateBox.width < 40 || candidateBox.height < 40) continue;
      var candidateHolder = candidate.querySelector(".tm_sbHost");
      if (candidateHolder === null) continue;
      if (candidateBox.height > bestHeight) {
        bestHeight = candidateBox.height;
        panel = candidate;
        holder = candidateHolder;
      }
    }
    if (panel !== null) {
      var hostEl = mindMapSingleton.host;
      if (hostEl === null) { try { mindMapEnsureSingleton(mindMapSidebarProps()); hostEl = mindMapSingleton.host; } catch (error) { hostEl = null; } }
      if (holder !== null && hostEl !== null && holder.contains(hostEl) !== true) {
        try { holder.appendChild(hostEl); } catch (error) { }
        mindMapPendingFit.until = Date.now() + 8000;
      }
    }
    var onScreen = mindMapMapSurfaceVisible();
    button.style.display = onScreen ? "none" : "flex";
  };
  ensure();
  if (window.__mindMapLauncherTimer !== void 0 && window.__mindMapLauncherTimer !== null) window.clearInterval(window.__mindMapLauncherTimer);
  window.__mindMapLauncherTimer = window.setInterval(ensure, 1500);
  window.__mindMapLauncher = button;
}

/**
 * 一个会话只应该有一张卡。历史上两套补卡逻辑（上游自动同步 + 子代理补卡）会给同一个
 * 会话各建一张，于是同一 session 出现 2~5 张卡。这里直接读 canvas store，同一 sessionId
 * 只保留最早创建的那张，其余 removeCard（连线随卡删除）。
 */
function mindMapDedupeCards() {
  try {
    var state = canvas.get();
    if (state === null || state === void 0 || state.phase !== "ready") return 0;
    var cards = state.cards || {};
    var bySession = new Map();
    var key;
    for (key in cards) {
      if (Object.prototype.hasOwnProperty.call(cards, key) !== true) continue;
      var sessionId = cards[key].sessionId;
      var list = bySession.get(sessionId);
      if (list === void 0) bySession.set(sessionId, [key]);
      else list.push(key);
    }
    var removed = 0;
    bySession.forEach(function (ids) {
      if (ids.length < 2) return;
      ids.sort(function (left, right) {
        return (cards[left].createdAt || 0) - (cards[right].createdAt || 0);
      });
      for (var index = 1; index < ids.length; index += 1) {
        try { canvas.removeCard(ids[index]); removed += 1; } catch (error) { }
      }
    });
    if (removed > 0) console.warn("[mind_map] removed " + removed + " duplicate card(s)");
    return removed;
  } catch (error) {
    return 0;
  }
}


/**
 * 多实例补卡节流（2026-11-12）：DSH 壳会把非当前 session 的整个 pane 留在 DOM 里
 * （只加 display:none），同一个 mind_map 主面板可能同时存在 2~3 份实例。它们各自
 * 拿到的 boardSessionIds 都有一帧滞后，于是「同一个 session 各建一张卡」——
 * 实测一个跑着的子代理一次出现 3 张。模块级时间戳让同页所有实例共享「刚补过」状态；
 * mindMapDedupeCards 每 700ms 再兜底一次。
 */
var mindMapPlacedAt = new Map();
function mindMapPlaceableNow(sessionId) {
  var at = mindMapPlacedAt.get(sessionId);
  if (at !== void 0) {
    if (Date.now() - at < 15000) return false;
    mindMapPlacedAt.delete(sessionId);
  }
  return true;
}
function mindMapMarkPlaced(sessionId) {
  mindMapPlacedAt.set(sessionId, Date.now());
}

/** A. 二部图：分组节点注册表。由「边构建」每帧重建，只有 count>=2 的分组才有节点。 */
var mindMapGroupNodes = new Map();
/** A. 分组节点锚点（每个工作区只算一次，之后固定，避免与力导向互相追）。 */
var mindMapGroupAnchors = new Map();
/** 面板刚打开 / 宿主刚挂回去：下一帧按当前内容做一次初始 fit（留白收紧）。 */
var mindMapPendingFit = { until: 0, last: 0, width: 0, height: 0 };
/** 上次「重新排布」的同步耗时（ms），调试用。 */
var mindMapLastRelayoutMs = 0;
/** 用户自己拖过/缩放过镜头之后，布局收敛时就不再强行 fit（respect 手动视角）。 */
var mindMapCameraTouched = false;
/** 上一次自动取景的时间（节流 400ms）。 */
var mindMapAutoFitAt = 0;
/** C. 悬停星形：cardId -> 共享标签的邻居 cardId（上限 24）。 */
var mindMapStarIndex = new Map();
var MIND_MAP_GROUP_W = 96;
var MIND_MAP_GROUP_H = 26;
/** 把注册表转成节点数组（type=groupNode），供可见集合、boxMap、绘制使用。 */
function mindMapGroupNodesList() {
  var out = [];
  mindMapGroupNodes.forEach(function (entry) {
    if (entry.data.count < 2) return;
    out.push(entry);
  });
  return out;
}

function mindMapSelectorHook(store) {
  return function (selector, equality) {
    var select = typeof selector === "function" ? selector : function (state) { return state; };
    var cacheRef = import_react13.useRef({ has: false, value: void 0 });
    var read = function () {
      var next = select(store.getSnapshot());
      var cache = cacheRef.current;
      var same = typeof equality === "function" ? equality(cache.value, next) : cache.value === next;
      if (cache.has === true && same) return cache.value;
      cache.has = true;
      cache.value = next;
      return next;
    };
    return import_react13.useSyncExternalStore(function (notify) { return store.subscribe(notify); }, read, read);
  };
}

function mindMapSidebarProps() {
  if (mindMapStandardCache !== null) return mindMapStandardCache;
  // 必须用 apply() 拿到的那个 ctx：侧栏 tab 自带的 ctx 没有 sessions/workspaces
  // 的 inject，直接取属性会抛 "cannot get property ... without inject"。
  var ctx = mindMapApplyCtx;
  var sessionsStore = null;
  var workspacesStore = null;
  var statusStore = null;
  try { sessionsStore = ctx !== null && ctx.sessions !== void 0 && ctx.sessions !== null && ctx.sessions.list !== void 0 ? ctx.sessions.list : null; } catch (error) { sessionsStore = null; }
  try { workspacesStore = ctx !== null && ctx.workspaces !== void 0 && ctx.workspaces !== null && ctx.workspaces.list !== void 0 ? ctx.workspaces.list : null; } catch (error) { workspacesStore = null; }
  try { statusStore = ctx !== null && ctx.slots !== void 0 && ctx.slots._rootBinding !== void 0 ? ctx.slots._rootBinding.hooks.sessionStatus : null; } catch (error) { statusStore = null; }
  mindMapStandardCache = {
    useSessions: sessionsStore === null ? function () { return { ids: [], byId: {} }; } : mindMapSelectorHook(sessionsStore),
    useWorkspaces: workspacesStore === null ? function () { return { items: [] }; } : mindMapSelectorHook(workspacesStore),
    useSessionStatus: statusStore === null || statusStore === void 0 ? void 0 : mindMapSelectorHook(statusStore)
  };
  return mindMapStandardCache;
}

/** 侧栏入口：有 betterSidebar 且有当前会话就开那一栏（已开则聚焦）；否则返回 false，
 *  调用方退回中间栏面板（面板不依赖会话，空板上也能看）。 */
function openMindMapSidebar() {
  return mindMapOpenSidebarTab(mindMapSidebarSeat.service);
}
/** 单实例宿主：地图只创建一次 React root，切会话时只把 DOM 节点搬进新占位，
 *  组件（模拟、相机、悬停、选中）全程不卸载 —— 这就是「一套全局的思维图」。 */
var mindMapSingleton = { host: null, root: null, standard: null, engine: null };
var mindMapReactDom = (function () {
  try { return require("react-dom/client"); } catch (error) {
    mindMapSingleton.requireError = String(error && error.message).slice(0, 200);
    return null;
  }
})();
(function resolveReactDom() {
  var candidate = mindMapReactDom;
  if (candidate !== null && candidate !== void 0 && typeof candidate.createRoot !== "function" && candidate.default !== void 0) candidate = candidate.default;
  if (candidate !== null && candidate !== void 0 && typeof candidate.createRoot === "function") {
    mindMapReactDom = candidate;
    mindMapSingleton.supported = true;
  } else {
    mindMapSingleton.supported = false;
    if (mindMapSingleton.requireError === null) {
      var shape = mindMapReactDom === null || mindMapReactDom === void 0 ? String(mindMapReactDom) : Object.keys(mindMapReactDom).join(",");
      mindMapSingleton.requireError = "no createRoot (" + shape + ")";
    }
  }
})();
try { if (typeof window !== "undefined" && window !== null) window.__mindMapSingleton = mindMapSingleton; } catch (error) { }
try { if (typeof window !== "undefined" && window !== null) window.__mindMapSeat = mindMapSidebarSeat; } catch (error) { }
function mindMapEnsureSingleton(standard) {
  if (typeof document === "undefined" || document === null) return null;
  if (mindMapSingleton.host === null) {
    var host = document.createElement("div");
    host.className = "tm_sbHostInner";
    host.setAttribute("data-mind-map-singleton", "1");
    mindMapSingleton.host = host;
  }
  if (mindMapSingleton.root === null && mindMapSingleton.supported === true) {
    try {
      mindMapSingleton.standard = standard;
      mindMapSingleton.root = mindMapReactDom.createRoot(mindMapSingleton.host);
      mindMapSingleton.root.render(import_react13.createElement(MapCanvas, standard));
      mindMapSingleton.engine = "singleton";
    } catch (error) {
      mindMapSingleton.root = null;
      mindMapSingleton.supported = false;
      mindMapSingleton.requireError = String(error && error.message).slice(0, 200);
    }
  }
  return mindMapSingleton.host;
}
function mindMapDetachSingleton() {
  var host = mindMapSingleton.host;
  if (host !== null && host.parentNode !== null && host.parentNode !== void 0) {
    try { host.parentNode.removeChild(host); } catch (error) { }
  }
}
function MapSidebarTab(tabProps) {
  var standard = mindMapSidebarProps();
  var ui = import_react13.useSyncExternalStore(mapUi.subscribe, mapUi.get, mapUi.get);
  var holderRef = import_react13.useRef(null);
  // 挂载即说明这一栏真的开出来了：自动恢复的轮询凭这个信号停止。
  import_react13.useEffect(function () {
    mindMapSidebarSeat.mounted = true;
    return function () { mindMapSidebarSeat.mounted = false; };
  }, []);
  import_react13.useEffect(function () {
    var holder = holderRef.current;
    if (holder === null) return;
    // 全屏面板接管时把宿主摘掉（同一时刻只让一处可见）。
    if (ui.open === true) { mindMapDetachSingleton(); return; }
    var host = null;
    try { host = mindMapEnsureSingleton(standard); } catch (error) { host = null; }
    if (host === null) return;
    if (host.parentNode === holder) return;
    // 同一个 tab 类型可能同时出现在右栏和底部小面板里：宿主只能待在一处，
    // 规则是「谁大挂谁」——底部小面板先挂上去了，右栏挂载时会把宿主抢过来；
    // 一旦宿主所在占位已经从文档里摘下（切会话/关 tab），新占位直接接管。
    // ⚠️ 2026-11-11 修：「可见」必须看盒子尺寸。隐藏面板里的占位仍然是
    // document.body.contains(host) === true，旧代码据此当它有效，于是新占位
    // 挂载瞬间（高度还是 0）出现 0 >= 0 判定成立 → 直接 return 挂不上，
    // 之后 effect 依赖只有 [ui.open] 不会重跑，可见 tab 就一直黑着。
    var current = host.parentNode;
    var currentHeight = -1;
    if (current !== null && current !== void 0 && current.nodeType === 1 && document.body.contains(host)) {
      var currentBox = current.getBoundingClientRect();
      if (currentBox.width >= 40 && currentBox.height >= 40) currentHeight = currentBox.height;
      else currentHeight = 0;
    }
    var nextBox = holder.getBoundingClientRect();
    if (currentHeight >= 40 && nextBox.height >= 40 && currentHeight >= nextBox.height) return;
    holder.appendChild(host);
    mindMapPendingFit.until = Date.now() + 8000;
    // 挂载时机早于布局（holder 还是 0 高）时，上面那次 appendChild 虽然生效，
    // 但量不到尺寸；下一帧再确认一次。1.5s 巡检是给「宿主被摘下」兜底用的，
    // 不该拿来当首次挂载的补救。
    if (nextBox.height < 40) {
      var retryHolder = holder;
      try {
        window.requestAnimationFrame(function () {
          try {
            if (retryHolder.isConnected === true && retryHolder.getBoundingClientRect().height >= 40) {
              if (host.parentNode !== retryHolder) retryHolder.appendChild(host);
              mindMapPendingFit.until = Date.now() + 8000;
            }
          } catch (error) { }
        });
      } catch (error) { }
    }
  }, [ui.open]);
  var singletonReady = mindMapSingleton.supported === true;
  return (0, import_jsx_runtime16.jsxs)("div", {
    className: "tm_sbPanel",
    children: [
      (0, import_jsx_runtime16.jsxs)("div", { className: "tm_sbBar", children: [
        (0, import_jsx_runtime16.jsx)("span", { className: "tm_sbTitle", children: t("map.title") }),
        (0, import_jsx_runtime16.jsx)("button", {
          type: "button",
          className: "tm_graphBtn tm_sbFull",
          title: "在中间栏全屏打开思维图（整理卡片时更好用）",
          onClick: function () { openMapPanel(); },
          children: "⤢ 全屏"
        })
      ] }),
      ui.open === true
        ? (0, import_jsx_runtime16.jsx)("div", { className: "tm_sbNote", children: "地图正在中间栏全屏显示" })
        : singletonReady
          ? (0, import_jsx_runtime16.jsx)("div", { className: "tm_sbHost", ref: holderRef })
          : (0, import_jsx_runtime16.jsx)(MapCanvas, standard)
    ]
  });
}
/** 左栏 panellist 行（插件 / 记忆系统 / SSH 那一排）的图标。壳体负责行框、
 *  标签、tooltip、高亮与折叠，这里只画 glyph，并用 data-dsh-panel-entry 标出
 *  这一行属于哪个面板（壳按它反查，跟 dsh-ssh 的做法一致）。 */
function MindMapPanelIcon(props) {
  var edge = props === void 0 || props.size === void 0 ? 16 : props.size;
  return (0, import_jsx_runtime16.jsxs)("svg", {
    "data-dsh-panel-entry": MAP_PANEL_ID,
    viewBox: "0 0 16 16",
    width: edge,
    height: edge,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    children: [
      (0, import_jsx_runtime16.jsx)("path", { d: "M9.2 2.6 4.2 4.1v9.3l5-1.5 3 1.1 3.8-1.5V2l-3.8 1.5Z" }, "a"),
      (0, import_jsx_runtime16.jsx)("path", { d: "M9.2 2.6v9.2" }, "b"),
      (0, import_jsx_runtime16.jsx)("path", { d: "M12.2 3.5v9.5" }, "c")
    ]
  });
}
/* live 模块在这个块之后才定义，调试钩子在 module-block 的 replace 末尾挂（见下）。 */
// ===== end mind-map graph view patch =====
`;

/* ------------------------------------------------------------------ */
/* 2. client edits                                                     */
/* ------------------------------------------------------------------ */

const GRAPH_CSS = String.raw` .tm_graphBar { position: absolute; top: 12px; right: 12px; z-index: 25; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 8px 24px var(--dsw-alias-bg-mask-2); } .tm_graphBtn { padding: 4px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: calc(12px + var(--tm-font-step, 0px)); cursor: pointer; white-space: nowrap; } .tm_graphBtn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); } .tm_graphBtn:disabled { opacity: 0.5; cursor: default; } .tm_graphBtnActive { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); } .tm_graphHint { padding: 0 4px; font-size: calc(11px + var(--tm-font-step, 0px)); color: var(--dsw-alias-label-tertiary); white-space: nowrap; } .tm_cardTags { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 4px; } .tm_tagChip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px; border-radius: 4px; font-size: calc(9.5px + var(--tm-font-step, 0px)); line-height: 1.7; color: rgba(140, 200, 255, 0.92); background: rgba(90, 160, 255, 0.14); } .tm_canvas[data-lod="far"] .tm_cardSummary, .tm_canvas[data-lod="far"] .tm_cardTags, .tm_canvas[data-lod="far"] .tm_cardFooter, .tm_canvas[data-lod="far"] .tm_cardNext, .tm_canvas[data-lod="far"] .tm_cardHandle, .tm_canvas[data-lod="far"] .tm_cardReticle { display: none !important; } .tm_canvas[data-lod="far"] .tm_card { box-shadow: none; border-color: var(--dsw-alias-border-l1); } .tm_canvas[data-lod="far"] .tm_cardTitle { -webkit-line-clamp: 1; font-size: calc(12px + var(--tm-font-step, 0px)); } .tm_canvas[data-lod="far"] .react-flow__edge path { stroke-width: 0.8; } .tm_canvas[data-lod="far"] .react-flow__node { transition: none; } .tm_canvas[data-lod="far"] .tm_cardLampRunning, .tm_canvas[data-lod="far"] .tm_cardLampDone, .tm_canvas[data-lod="far"] .tm_cardLampError, .tm_canvas[data-lod="far"] .tm_cardLampWaiting, .tm_canvas[data-lod="far"] .tm_cardPin { animation: none; } .tm_canvas[data-lod="far"] .tm_cardLampRunning::after { display: none; } .tm_dot { width: 16px; height: 16px; border-radius: 50%; background: rgba(198, 206, 220, 0.6); border: 2px solid var(--dsw-alias-bg-layer-1); box-shadow: 0 0 0 1px rgba(198, 206, 220, 0.22); transition: transform 120ms ease, background 120ms ease; cursor: pointer; } .tm_dot:hover { transform: scale(1.55); background: var(--dsw-alias-brand-primary); } .tm_dotRunning { background: #ffffff; animation: tm_mindmap-pulse 1.6s ease-in-out infinite; } .tm_dotWaiting { background: rgb(245, 178, 46); } .tm_dotDone { background: rgb(52, 199, 89); } .tm_dotHandle { width: 1px !important; height: 1px !important; min-width: 1px; min-height: 1px; opacity: 0; border: none; background: transparent; } .tm_dotPeek { position: fixed; z-index: 90; width: 272px; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5); pointer-events: none; display: flex; flex-direction: column; gap: 5px; } .tm_dotPeekTitle { font-size: calc(12.5px + var(--tm-font-step, 0px)); font-weight: 600; line-height: 1.35; color: var(--dsw-alias-label-primary); word-break: break-word; } .tm_dotPeekBody { font-size: calc(11.5px + var(--tm-font-step, 0px)); line-height: 1.5; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; } .tm_dotPeekTags { display: flex; flex-wrap: wrap; gap: 4px; } .tm_graphSurface { position: absolute; inset: 0; overflow: hidden; } .tm_graphCanvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; } .tm_graphSurface:active .tm_graphCanvas { cursor: grabbing; } .tm_canvasCtl { position: absolute; left: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 4px; z-index: 5; } .tm_canvasCtl button { width: 30px; height: 30px; padding: 0; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 15px; line-height: 1; cursor: pointer; } .tm_canvasCtl button:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }`;

const GRAPH_SIDEBAR_CSS = String.raw` .tm_sbPanel { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 6px; } .tm_sbPanel > :last-child { flex: 1 1 0; min-height: 0; } .tm_sbBar { display: flex; align-items: center; gap: 8px; padding: 2px 2px 6px; } .tm_sbTitle { font-size: calc(12px + var(--tm-font-step, 0px)); font-weight: 600; color: var(--dsw-alias-label-primary); } .tm_sbBar .tm_sbFull { margin-left: auto; } .tm_launcher { position: fixed; right: 18px; top: 120px; z-index: 9999; display: none; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 10px; border: 1px solid rgba(126, 136, 158, 0.42); background: rgba(24, 26, 33, 0.94); color: #cfd6e4; font-size: 12px; line-height: 1; cursor: pointer; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35); } .tm_launcher:hover { border-color: #5b8cff; color: #fff; } .tm_sbHost { position: relative; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; } .tm_sbHostInner { position: relative; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; } .tm_sbHostInner > * { flex: 1 1 0; min-height: 0; } .tm_sbNote { display: flex; align-items: center; justify-content: center; height: 100%; padding: 16px; font-size: calc(12px + var(--tm-font-step, 0px)); color: var(--dsw-alias-label-tertiary); text-align: center; }
`;
const GRAPH_EDGES_BLOCK = String.raw`    if (graphOn) {
      // 云图只有三种关系：同一个工作区 / 同一个标签 / 子代理（血缘）。
      // 分组节点（药丸）已经删掉 —— 同工作区的点直接互相连线。
      // 隐藏归档后按「当前可见集合」重建，链才不会从中间断掉。
      const graphCardIds = Object.keys(visibleCards).filter(function (cardId) {
        if (foldedSet.has(cardId)) return false;
        if (hideArchivedOn && archivedSessionSet.has(visibleCards[cardId].sessionId)) return false;
        return true;
      });
      const pushGraphEdge = function (fromCardId, toCardId, kind, idTag) {
        if (fromCardId === toCardId) return;
        // id 里带上关系本身（标签名 / 工作区 id），同一对既是同组又是同标签时
        // 是两条独立的边，而不是重复 id。
        out.push({
          id: "graph-" + kind + "-" + (idTag === void 0 ? "" : idTag + "-") + fromCardId + "-" + toCardId,
          source: fromCardId,
          target: toCardId,
          type: "graphLine",
          selectable: false,
          data: {
            fromCardId: fromCardId,
            toCardId: toCardId,
            sync: "idle",
            structural: true,
            graph: true,
            graphKind: kind,
            ready: boardTick > 0
          },
          style: { stroke: "rgba(198, 206, 220, 0.34)", strokeWidth: 1 }
        });
      };
      // 成员多的时候绝不去连完全图：n(n-1)/2 条边会把 200 个会话变成两万条线。
      // 小簇全连接（看得出一团团），大簇连成环 —— 视觉上仍是一团，边数只有 n 条。
      const LINK_CLIQUE_MAX = { ws: 8, tag: 5 };
      const linkCluster = function (members, kind, idTag) {
        if (members.length < 2) return;
        const cap = LINK_CLIQUE_MAX[kind] === void 0 ? 8 : LINK_CLIQUE_MAX[kind];
        if (members.length <= cap) {
          for (let left = 0; left < members.length; left += 1) {
            for (let right = left + 1; right < members.length; right += 1) pushGraphEdge(members[left], members[right], kind, idTag);
          }
          return;
        }
        for (let index = 0; index < members.length; index += 1) {
          pushGraphEdge(members[index], members[(index + 1) % members.length], kind, idTag);
        }
      };
      const byNewest = function (left, right) {
        const leftSession = sessions.byId[visibleCards[left] === void 0 ? "" : visibleCards[left].sessionId];
        const rightSession = sessions.byId[visibleCards[right] === void 0 ? "" : visibleCards[right].sessionId];
        return (rightSession === void 0 ? 0 : rightSession.updatedAt || 0) - (leftSession === void 0 ? 0 : leftSession.updatedAt || 0);
      };
      // A. 同一个工作区直接互连（子代理不参与：它只跟自己的主会话有关系）。
      const byWorkspace = new Map();
      for (const cardId of graphCardIds) {
        const card = visibleCards[cardId];
        if (card === void 0) continue;
        const wsRow = sessions.byId[card.sessionId];
        if (wsRow !== void 0 && wsRow.origin === "subagent") continue;
        const groupId = sessionWs.get(card.sessionId);
        if (groupId === void 0) continue;
        if (!byWorkspace.has(groupId)) byWorkspace.set(groupId, []);
        byWorkspace.get(groupId).push(cardId);
      }
      mindMapGroupNodes.clear();
      mindMapGroupAnchors.clear();
      for (const group of byWorkspace.entries()) {
        group[1].sort(byNewest);
        linkCluster(group[1], "ws", group[0]);
      }
      // B. 关键词（标签）：会话不再两两互连，而是连到它命中的「标签点」。
      //    一个标签被 N 个会话用到 → 那个 key 点度数 N（点更大），会话之间
      //    也就通过它连在一起。只有一个成员用的标签不上图（不是 key，是噪音）。
      //    过滤条件必须和 graphTagNodes 完全一致，否则会出现悬空边 / 孤立的 key 点。
      mindMapStarIndex.clear();
      for (const group of graphTagGroups) {
        const tag = group[0];
        const members = group[1].filter(function (cardId) {
          if (foldedSet.has(cardId)) return false;
          const card = visibleCards[cardId];
          if (card === void 0) return false;
          if (hideArchivedOn && archivedSessionSet.has(card.sessionId)) return false;
          const starRow = sessions.byId[card.sessionId];
          return starRow === void 0 || starRow.origin !== "subagent";
        });
        if (members.length < 2) continue;
        for (const cardId of members) pushGraphEdge(cardId, "tag-" + tag, "tag", tag);
      }
      // C. 子代理 / 血缘：上面 DRAW_LINEAGE_LINKS 那一段已经按 parentId 画好了，
      //    这里不再重复（否则一对母子会出现两根线）。
    }
`;

const AUTO_LAYOUT_BLOCK = String.raw`  const graphCardIds = Object.keys(visibleCards).sort();
  const graphCardSig = graphCardIds.join(",");
  const relayoutGraph = () => {
    const entries = Object.entries(visibleCards).map(function (entry) { return { id: entry[0], x: entry[1].x, y: entry[1].y }; });
    if (entries.length === 0) return;
    const links = [];
    for (const drawn of liveEdges) links.push([drawn.source, drawn.target]);
    // 云图的理想间距是「几十 px」而不是「一张卡宽」：ideal 按点的尺度给 70，
    // 剩下的交给画布的斥力/硬芯去微调。
    const layoutStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    const placed = graphLayoutForce(entries, links, { width: 16, height: 16, ideal: 70 });
    try {
      mindMapLastRelayoutMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - layoutStart;
      if (window.__mindMapDebug !== void 0 && window.__mindMapDebug !== null) window.__mindMapDebug.lastRelayoutMs = mindMapLastRelayoutMs;
      console.info("[mind_map] relayout " + entries.length + " cards in " + mindMapLastRelayoutMs.toFixed(0) + " ms");
    } catch (error) { }
    const points = {};
    for (const cardId of Object.keys(placed)) points[cardId] = { x: snap(placed[cardId].x), y: snap(placed[cardId].y) };
    canvas.moveCards(points);
    // The canvas keeps its own simulation: hand the new coordinates over and
    // heat it back up, otherwise the button would only move the cards on paper.
    if (mindMapSimKick !== null && typeof mindMapSimKick.fn === "function") mindMapSimKick.fn(0.22);
    // 重排之后把镜头缩放到刚排好的范围（收敛完成后 canvas 还会再 fit 一次）。
    if (mindMapFitKick !== null && typeof mindMapFitKick.fn === "function") mindMapFitKick.fn();
  };
  // New cards only: keep every card the user has already placed exactly where it
  // is, and drop the newcomer next to its workspace peers in the first free spot.
  const placeNewGraphCards = (newIds) => {
    const fresh = new Set(newIds);
    const occupied = [];
    let anchorSumX = 0;
    let anchorSumY = 0;
    for (const entry of Object.entries(visibleCards)) {
      if (fresh.has(entry[0])) continue;
      occupied.push({ x: entry[1].x, y: entry[1].y });
      anchorSumX += entry[1].x;
      anchorSumY += entry[1].y;
    }
    let globalX = occupied.length === 0 ? 0 : anchorSumX / occupied.length;
    let globalY = occupied.length === 0 ? 0 : anchorSumY / occupied.length;
    const points = {};
    for (const cardId of newIds) {
      const card = visibleCards[cardId];
      if (card === void 0) continue;
      const groupId = sessionWs.get(card.sessionId);
      let groupX = 0;
      let groupY = 0;
      let groupCount = 0;
      for (const entry of Object.entries(visibleCards)) {
        if (fresh.has(entry[0])) continue;
        if (groupId !== void 0 && sessionWs.get(entry[1].sessionId) !== groupId) continue;
        groupX += entry[1].x;
        groupY += entry[1].y;
        groupCount += 1;
      }
      const centerX = groupCount === 0 ? globalX : groupX / groupCount;
      const centerY = groupCount === 0 ? globalY : groupY / groupCount;
      let spot;
      for (let step = 0; step < 700; step += 1) {
        // 云图的点很小：螺线间距按 44px 起步，撞上已有节点也算「有位」，
        // 反正下一步模拟会把它们推开。
        const radius = step === 0 ? 0 : 44 + step * 9;
        const angle = step * 0.55;
        const pointX = Math.round(centerX + Math.cos(angle) * radius);
        const pointY = Math.round(centerY + Math.sin(angle) * radius);
        let free = true;
        for (const box of occupied) {
          if (Math.abs(box.x - pointX) < 40 && Math.abs(box.y - pointY) < 40) { free = false; break; }
        }
        if (free) { spot = { x: pointX, y: pointY }; break; }
      }
      if (spot === void 0) spot = { x: Math.round(centerX), y: Math.round(centerY) };
      points[cardId] = spot;
      occupied.push(spot);
    }
    if (Object.keys(points).length > 0) canvas.moveCards(points);
  };
  const graphAutoRef = (0, import_react13.useRef)({ full: function () { }, place: function () { } });
  graphAutoRef.current.full = relayoutGraph;
  graphAutoRef.current.place = placeNewGraphCards;
  (0, import_react13.useEffect)(() => {
    if (!graphOn || canvasState.phase !== "ready") return;
    let stored = [];
    try { stored = JSON.parse(window.localStorage.getItem(GRAPH_LAID_KEY) || "[]"); } catch (error) { stored = []; }
    if (!Array.isArray(stored)) stored = [];
    if (stored.length === graphCardIds.length && stored.every(function (cardId, position) { return cardId === graphCardIds[position]; })) return;
    const storedSet = new Set(stored);
    const currentSet = new Set(graphCardIds);
    const additions = graphCardIds.filter(function (cardId) { return !storedSet.has(cardId); });
    const removals = stored.filter(function (cardId) { return !currentSet.has(cardId); });
    const timer = window.setTimeout(function () {
      if (stored.length === 0 || removals.length > 0) graphAutoRef.current.full();
      else if (additions.length > 0) graphAutoRef.current.place(additions);
      try { window.localStorage.setItem(GRAPH_LAID_KEY, JSON.stringify(graphCardIds)); } catch (error) { }
    }, 320);
    return function () { window.clearTimeout(timer); };
  }, [graphOn, canvasState.phase, graphCardSig]);
  const generateTags = async () => {
    const missing = [];
    for (const card of Object.values(visibleCards)) {
      const digest = canvasState.digests[card.sessionId];
      const hasTags = digest !== void 0 && Array.isArray(digest.tags) && digest.tags.length > 0;
      if (!hasTags) missing.push(card.sessionId);
    }
    if (missing.length === 0) { showToast("所有卡片都已有模型标签"); return; }
    setTagBusy(true);
    try {
      const batch = missing.slice(0, 24);
      for (const sessionId of batch) {
        try { await mindMapApi.refreshDigest(sessionId); } catch (error) { console.error("[mind_map] tag digest failed", sessionId, error); }
      }
      canvas.refresh();
      showToast("标签已生成 " + batch.length + " 个" + (missing.length > batch.length ? "，还剩 " + (missing.length - batch.length) + " 个" : ""));
    } finally {
      setTagBusy(false);
    }
  };
`;

const CLIENT_EDITS = [
  {
    label: "status-rail-pointer-gesture",
    // Compile just this module from TSX so the shipped pointer logic cannot drift
    // from the regression-tested source. The rest still uses the verified base.
    find: readLegacyStatusRail(renameAll(readFileSync(existsSync(CLIENT + BACKUP_SUFFIX) ? CLIENT + BACKUP_SUFFIX : CLIENT, "utf8").replace(/\r\n/g, "\n"))),
    replace: compileStatusRail()
  },
  {
    label: "ctx-hook",
    // Exposes the cordis context on window so a verification script (or the
    // console) can inspect the live services this plugin was given: what the
    // sessions/workspaces feeds look like, whether betterSidebar is present,
    // and which slot APIs exist. Read-only in practice; nothing in the UI
    // depends on it.
    find: "var inject = [\"slots\", \"sessions\", \"workspaces\", \"connection\"];\nfunction apply(ctx) {\n  try {",
    replace: "var inject = [\"slots\", \"sessions\", \"workspaces\", \"connection\"];\nfunction apply(ctx) {\n  try {\n    window.__mindMapCtx = ctx;"
  },
  {
    label: "css",
    find: ".tm_statusRailFloating { position: fixed; z-index: 20; pointer-events: none; }",
    replace: ".tm_statusRailFloating { position: fixed; z-index: 20; pointer-events: none; }" + GRAPH_CSS + GRAPH_SIDEBAR_CSS
  },
  {
    label: "module-block",
    find: "\t} catch (error) {\n\t\tconsole.error('[mind_map] client bundle failed to evaluate",
    replace: MODULE_BLOCK + "\n" + LIVE_BLOCK + "\ntry { if (typeof window !== \"undefined\" && window !== null) window.__mindMapLive = mindMapLive; } catch (error) { }\n\t} catch (error) {\n\t\tconsole.error('[mind_map] client bundle failed to evaluate"
  },
  {
    label: "graphOn-hook",
    find: "  const locale = (0, import_react13.useSyncExternalStore)(subscribeLocale, activeLocale, activeLocale);",
    replace: "  const locale = (0, import_react13.useSyncExternalStore)(subscribeLocale, activeLocale, activeLocale);\n" +
      "  const graphOn = (0, import_react13.useSyncExternalStore)(graphModeSubscribe, graphModeGet, graphModeGet);\n" +
      "  const [tagBusy, setTagBusy] = (0, import_react13.useState)(false);"
  },
  {
    label: "tag-memos",
    find: "  const previewInputs = (0, import_react13.useRef)({ cards: visibleCards, sessions });",
    replace: String.raw`  // Archived cards: session summaries carry no archived flag, the workspace
  // store does (archived sessions stay in sessions.byId, the sidebar only
  // filters them out). Declared first: the tag groups, the card data, the node
  // list and the edge builder all read it.
  const archivedSessionSet = (0, import_react13.useMemo)(() => new Set(workspaces.archivedSessionIds ?? []), [workspaces]);
  const hideArchivedOn = (0, import_react13.useSyncExternalStore)(hideArchivedSubscribe, hideArchivedGet, hideArchivedGet);
  // 一个会话的血缘根（主会话）：判断「这是不是当前对话自己的子代理」全靠它。
  const sessionRootOf = (sessionId) => {
    let cursor = sessionId;
    for (let hops = 0; hops < 32; hops += 1) {
      const row = sessions.byId[cursor];
      if (row === void 0 || row.parentId === void 0 || row.parentId === cursor) return cursor;
      cursor = row.parentId;
    }
    return cursor;
  };
  const currentSessionRoot = (() => {
    const current = currentSessionId();
    return current === void 0 ? void 0 : sessionRootOf(current);
  })();
  const archivedCardCount = (0, import_react13.useMemo)(() => {
    // 「已隐藏」= 已归档会话 + 别人家的已跑完子代理（自己的子代理跑完照样显示，只是灰化）。
    let count = 0;
    for (const cardId of Object.keys(visibleCards)) {
      const card = visibleCards[cardId];
      if (archivedSessionSet.has(card.sessionId)) { count += 1; continue; }
      const row = sessions.byId[card.sessionId];
      if (row !== void 0 && row.origin === "subagent" && row.running !== true && (currentSessionRoot === void 0 || sessionRootOf(card.sessionId) !== currentSessionRoot)) count += 1;
    }
    return count;
  }, [visibleCards, archivedSessionSet, sessions]);
  const graphTagIndex = (0, import_react13.useMemo)(() => {
    const derived = graphDeriveTags(canvasState.digests);
    const out = {};
    for (const sessionId of Object.keys(canvasState.digests || {})) {
      const digest = canvasState.digests[sessionId];
      const explicit = digest !== void 0 && Array.isArray(digest.tags) ? digest.tags.filter(function (tag) { return typeof tag === "string" && tag.trim() !== ""; }) : [];
      out[sessionId] = explicit.length > 0 ? explicit.slice(0, 6) : (derived[sessionId] || []);
    }
    return out;
  }, [canvasState.digests]);
  const graphTagGroups = (0, import_react13.useMemo)(() => {
    const groups = new Map();
    for (const entry of Object.entries(visibleCards)) {
      // A hidden archived card takes no part in the graph at all — leaving it in
      // would chain its neighbours to something nobody can see.
      if (hideArchivedOn && archivedSessionSet.has(entry[1].sessionId)) continue;
      var tagRow = sessions.byId[entry[1].sessionId];
      // 子代理只和主会话连线：不参与同标签分组（悬停星形也不连它）。
      if (tagRow !== void 0 && tagRow.origin === "subagent") continue;
      const tags = graphTagIndex[entry[1].sessionId];
      if (tags === void 0 || tags.length === 0) continue;
      for (const tag of tags) {
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(entry[0]);
      }
    }
    for (const members of groups.values()) {
      members.sort(function (left, right) {
        const leftSession = sessions.byId[visibleCards[left] === void 0 ? "" : visibleCards[left].sessionId];
        const rightSession = sessions.byId[visibleCards[right] === void 0 ? "" : visibleCards[right].sessionId];
        return (leftSession === void 0 ? 0 : leftSession.updatedAt || 0) - (rightSession === void 0 ? 0 : rightSession.updatedAt || 0);
      });
    }
    return groups;
  }, [visibleCards, graphTagIndex, sessions, hideArchivedOn, archivedSessionSet]);
  const graphTagCount = (0, import_react13.useMemo)(() => {
    let count = 0;
    for (const members of graphTagGroups.values()) if (members.length > 1) count += 1;
    return count;
  }, [graphTagGroups]);
  const previewInputs = (0, import_react13.useRef)({ cards: visibleCards, sessions });`
  },
  {
    label: "visible-slots",
    find: "      const visibleSlots = visibleCount(capacity, preview.length);",
    replace: "      const visibleSlots = graphOn ? preview.length : visibleCount(capacity, preview.length);"
  },
  {
    label: "reslot-guard",
    find: "    if (canvasState.phase !== \"ready\") return;\n    if (draggingCardId !== null || liveFrame !== null) return;\n    const timer4 = window.setTimeout(() => {",
    replace: "    if (canvasState.phase !== \"ready\") return;\n    if (draggingCardId !== null || liveFrame !== null) return;\n    if (graphOn) return;\n    const timer4 = window.setTimeout(() => {"
  },
  {
    label: "promote-guard",
    find: "    if (draggingCardId !== null || liveFrame !== null) return;\n    const seen = lastActivitySeen;",
    replace: "    if (draggingCardId !== null || liveFrame !== null) return;\n    if (graphOn) return;\n    const seen = lastActivitySeen;"
  },
  {
    label: "frame-nodes",
    find: "    const frameNodes = Object.entries(frameRects).map(([groupId, rect]) => {",
    replace: "    const frameNodes = graphOn ? [] : Object.entries(frameRects).map(([groupId, rect]) => {"
  },
  {
    label: "card-position",
    find: "        position: dragging || slot === void 0 ? { x: card.x, y: card.y } : { x: slot.x, y: slot.y },",
    replace: "        position: dragging || graphOn || slot === void 0 ? { x: card.x, y: card.y } : { x: slot.x, y: slot.y },"
  },
  {
    label: "stack-nodes",
    find: "    const stackNodes = Object.entries(foldedCards).map(([groupId, folded]) => {",
    replace: "    const stackNodes = graphOn ? [] : Object.entries(foldedCards).map(([groupId, folded]) => {"
  },
  {
    label: "drop-guard",
    find: "          if (droppedLayout !== void 0 && droppedRect !== void 0) {",
    replace: "          if (!graphOn && droppedLayout !== void 0 && droppedRect !== void 0) {"
  },
  {
    label: "focus-card",
    find: "    const point = slot ?? (card === void 0 ? void 0 : { x: card.x, y: card.y });",
    replace: "    const point = (graphOn ? void 0 : slot) ?? (card === void 0 ? void 0 : { x: card.x, y: card.y });"
  },
  {
    label: "graph-edges",
    find: "    return out;\n  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch, lineageHidden, liveNodes, boardTick]);",
    replace: GRAPH_EDGES_BLOCK + "    return out;\n  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch, lineageHidden, liveNodes, boardTick, graphOn, graphTagGroups, hideArchivedOn, archivedSessionSet]);"
  },
  {
    label: "subagent-workspace",
    // 子会话没有 workspace 归属：把它挂到父会话所在的分组上，这样自动同步会把它
    // 摆进同一个「文件夹」，图谱里也就落在父卡旁边（血缘边本来就有）。
    find: "  const sessionWs = (0, import_react13.useMemo)(() => sessionWorkspaceIndex(workspaces), [workspaces]);",
    replace: "  const sessionWs = (0, import_react13.useMemo)(() => {\n" +
      "    const index = sessionWorkspaceIndex(workspaces);\n" +
      "    for (const childId of Object.keys(sessions.byId)) {\n" +
      "      const row = sessions.byId[childId];\n" +
      "      if (row === void 0 || row.origin !== \"subagent\" || index.has(childId)) continue;\n" +
      "      const parentWs = row.parentId === void 0 ? void 0 : index.get(row.parentId);\n" +
      "      if (parentWs !== void 0) index.set(childId, parentWs);\n" +
      "    }\n" +
      "    return index;\n" +
      "  }, [workspaces, sessions]);"
  },
  {
    label: "subagent-no-unread",
    // 子代理跑完不算「待查看」：它的结果写在父会话里，没人会去"读"子代理会话，
    // 40 多个子代理会把左侧状态栏淹掉。运行中/等你/异常 三种灯照旧。
    find: "    if (status?.completionUnread === true || finishedById.has(sessionId)) return \"done\";",
    replace: "    if (status?.completionUnread === true || finishedById.has(sessionId)) {\n" +
      "      if (summary !== void 0 && summary.origin === \"subagent\") return void 0;\n" +
      "      return \"done\";\n" +
      "    }"
  },
  {
    label: "subagent-no-unread-card",
    // 卡片上的「待查看」小灯同理关掉（灯语 :has-done 那种样式会跟着消失）。
    find: "        done: status?.completionUnread === true,",
    replace: "        done: status?.completionUnread === true && !(summary !== void 0 && summary.origin === \"subagent\"),"
  },
  {
    label: "subagent-placeable",
    // 子会话（subagent）也上板：它们是真会话，只是执行完毕后按「像归档那样」灰化并可隐藏。
    find: "    return summary !== void 0 && !summary.blank && summary.origin !== \"subagent\";",
    replace: "    return summary !== void 0 && !summary.blank;"
  },
  {
    label: "card-tags-data",
    find: "        ...pinnedSessions.has(card.sessionId) ? { pinned: true } : {}\n      };",
    replace: "        ...pinnedSessions.has(card.sessionId) ? { pinned: true } : {},\n        ...archivedSessionSet.has(card.sessionId) ? { archived: true } : {},\n        ...summary !== void 0 && summary.origin === \"subagent\" ? { subagent: true, subagentFinished: summary.running !== true } : {},\n        ...graphTagIndex[card.sessionId] !== void 0 && graphTagIndex[card.sessionId].length > 0 ? { tags: graphTagIndex[card.sessionId] } : {}\n      };"
  },
  {
    label: "live-nodes-deps",
    find: "batchMode, batchPicks, locale]);",
    replace: "batchMode, batchPicks, locale, graphOn, graphTagIndex, hideArchivedOn, archivedSessionSet, currentSessionRoot]);"
  },
  {
    label: "tag-nodes",
    // 关键词（标签）也上云图：一个标签 = 一个"key 点"，会话连到它，
    // 而不是让同标签的会话两两互连。度数 = 有多少会话用到这个 key，
    // 所以"重点的 key"自己就是大点，相关会话通过它连成一片。
    find: "  const liveNodes = (0, import_react13.useMemo)(() => {",
    replace: String.raw`  /** 关键词节点：从 graphTagGroups 派生，只有一个会话用到的标签不算 key。 */
  const graphTagNodes = (0, import_react13.useMemo)(() => {
    if (!graphOn) return [];
    const out = [];
    for (const group of graphTagGroups) {
      const tag = group[0];
      const members = group[1].filter(function (cardId) {
        if (foldedSet.has(cardId)) return false;
        const card = visibleCards[cardId];
        if (card === void 0) return false;
        if (hideArchivedOn && archivedSessionSet.has(card.sessionId)) return false;
        return true;
      });
      if (members.length < 2) continue;
      let sumX = 0;
      let sumY = 0;
      for (const cardId of members) {
        const card = visibleCards[cardId];
        sumX += card.x;
        sumY += card.y;
      }
      out.push({
        id: "tag-" + tag,
        type: "tagNode",
        // 先落在成员会话的质心；画布的模拟会按真实连线把它拉到该在的位置。
        position: { x: Math.round(sumX / members.length), y: Math.round(sumY / members.length) },
        draggable: false,
        selectable: false,
        data: { tagNode: true, tag: tag, title: "#" + tag, count: members.length }
      });
    }
    return out;
  }, [graphOn, graphTagGroups, visibleCards, hideArchivedOn, archivedSessionSet, foldedSet]);
  const liveNodes = (0, import_react13.useMemo)(() => {`
  },
  {
    label: "tag-nodes-append",
    find: "    return [...frameNodes, ...cardNodes, ...stackNodes];",
    replace: "    return [...frameNodes, ...cardNodes, ...stackNodes, ...graphTagNodes];"
  },
  {
    label: "tag-nodes-deps",
    find: "batchMode, batchPicks, locale, graphOn, graphTagIndex, hideArchivedOn, archivedSessionSet, currentSessionRoot]);",
    replace: "batchMode, batchPicks, locale, graphOn, graphTagIndex, hideArchivedOn, archivedSessionSet, currentSessionRoot, graphTagNodes]);"
  },
  {
    label: "auto-layout",
    find: "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);",
    replace: AUTO_LAYOUT_BLOCK + "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);"
  },
  {
    label: "graph-bar",
    find: "        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(StatusRail, { entries: statusEntries, cardWidth: CARD_W, onFocus: focusCard }),",
    replace: "        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(StatusRail, { entries: statusEntries, cardWidth: CARD_W, onFocus: focusCard }),\n        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(GraphBar, { onRelayout: relayoutGraph, onGenerateTags: generateTags, tagBusy: tagBusy, tagCount: graphTagCount }),"
  },
  {
    label: "status-rail-open",
    // 状态栏那一行是"待办"，点它必须真的打开那个会话：
    // 宿主只在会话成为主视图时才清 completionUnread（dsh-client-ui-session 里
    // 没有任何插件可调用的 mark-read 接口），插件自己的「已完成」也只在
    // openSession 里 acknowledge。以前点行只调 focusCard（挪镜头 + 选中），
    // 所以在云图里看起来"点了没反应"，而且「待查看」永远消不掉。
    // ⚠️ 必须排在 graph-bar 之后：那条把同一行扩成两行 JSX（并保留原文）。
    find: "        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(StatusRail, { entries: statusEntries, cardWidth: CARD_W, onFocus: focusCard }),",
    replace: String.raw`        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(StatusRail, {
          entries: statusEntries,
          cardWidth: CARD_W,
          onFocus: function (cardId) {
            // 先挪镜头：万一宿主没有会话打开器（openSession 会保住地图不关），
            // 至少能看到它落在哪儿。
            focusCard(cardId);
            const railCard = visibleCards[cardId];
            if (railCard !== void 0) openSession(railCard.sessionId);
          }
        }),`
  },
  {
    label: "acknowledge-after-open",
    find: "  const openSession = (sessionId) => {\n    sessionActivity.acknowledge(sessionId);\n    if (openSessionInUi(sessionId)) closeMapPanel();\n  };",
    replace: "  const openSession = (sessionId) => {\n    if (openSessionInUi(sessionId)) {\n      sessionActivity.acknowledge(sessionId);\n      closeMapPanel();\n    }\n  };"
  },
  {
    label: "jump-center",
    find: "    setCenter(point.x + CARD_W / 2, point.y + CARD_H / 2, { zoom: getZoom(), duration: 320 });",
    replace: "    setCenter(point.x + CARD_W / 2, point.y + CARD_H / 2, { zoom: getZoom(), duration: 320 });\n" +
      "    // 图谱模式没有挂 React Flow，上面这句是空操作（setCenter 直接 return false）；\n" +
      "    // 镜头改由 canvas 自己缓动，把这张卡平移到视口正中。\n" +
      "    if (mindMapCenterKick !== null && typeof mindMapCenterKick.fn === \"function\") mindMapCenterKick.fn(cardId);"
  },
  {
    label: "focus-hook",
    find: "  const graphOn = (0, import_react13.useSyncExternalStore)(graphModeSubscribe, graphModeGet, graphModeGet);\n  const [tagBusy, setTagBusy] = (0, import_react13.useState)(false);",
    replace: "  const graphOn = (0, import_react13.useSyncExternalStore)(graphModeSubscribe, graphModeGet, graphModeGet);\n  const focusOn = (0, import_react13.useSyncExternalStore)(focusModeSubscribe, focusModeGet, focusModeGet);\n  const focusAnchorRef = (0, import_react13.useRef)(null);\n  const [tagBusy, setTagBusy] = (0, import_react13.useState)(false);"
  },
  {
    label: "focus-set",
    find: "    return out;\n  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch, lineageHidden, liveNodes, boardTick, graphOn, graphTagGroups, hideArchivedOn, archivedSessionSet]);",
    replace: "    return out;\n  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch, lineageHidden, liveNodes, boardTick, graphOn, graphTagGroups, hideArchivedOn, archivedSessionSet]);\n" +
      String.raw`  // 聚焦（spotlight）：不隐藏任何卡片 —— 只把「当前会话」那张卡点亮，其余卡片、
  // 连线、分组药丸全部压暗（绘制层用 props.focusAnchorId 决定透明度，见 GraphCanvasSurface）。
  // 旧实现是「只显示相关的那几张」，切会话会重排 + 重新取景，看起来像地图被换掉了。
  // 返回 null = 聚焦关闭。
  const focusAnchorId = (0, import_react13.useMemo)(() => {
    if (!focusOn) { focusAnchorRef.current = null; return null; }
    const current = currentSessionId();
    let anchorCardId = current === void 0 ? void 0 : sessionIdToCardId.get(current);
    if (anchorCardId !== void 0 && visibleCards[anchorCardId] === void 0) anchorCardId = void 0;
    if (anchorCardId === void 0) {
      // 当前会话不在板上（刚删掉 / 还没导入）：退化成最近更新的那张卡。
      let newest;
      for (const entry of Object.entries(visibleCards)) {
        const stamp = sessions.byId[entry[1].sessionId]?.updatedAt ?? 0;
        if (newest === void 0 || stamp > newest.stamp) newest = { cardId: entry[0], stamp: stamp };
      }
      anchorCardId = newest === void 0 ? void 0 : newest.cardId;
    }
    focusAnchorRef.current = anchorCardId === void 0 ? null : anchorCardId;
    return anchorCardId === void 0 ? null : anchorCardId;
  }, [focusOn, visibleCards, sessions, sessionIdToCardId]);
  const focusEdges = liveEdges;
  const focusNodes = liveNodes;
  const focusCount = focusAnchorId === null ? 0 : 1;`
  },
  {
    label: "focus-nodes-edges",
    find: "  const nodes = isSelecting && frozenRef.current !== null ? frozenRef.current.nodes : liveNodes;\n  const edges = isSelecting && frozenRef.current !== null ? frozenRef.current.edges : liveEdges;",
    replace: "  const nodes = isSelecting && frozenRef.current !== null ? frozenRef.current.nodes : focusNodes;\n  const edges = isSelecting && frozenRef.current !== null ? frozenRef.current.edges : focusEdges;"
  },
  {
    label: "focus-center",
    find: "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);",
    replace: String.raw`  // 打开聚焦的那一刻把镜头挪到被点亮的那张卡上（它可能在视口外，不挪过去就只看到一片灰）。
  // 只响应「关 → 开」：面板刚打开时不动镜头（打开即 fit 的既有行为保留），
  // 切换会话也只换高亮、不抢视角。挪镜头时顺手关掉自动取景守卫，
  // 否则它每 400ms 发现内容出界就又 fit 回去，亮点刚居中就被拉走。
  const focusWasOnRef = (0, import_react13.useRef)(focusOn === true);
  (0, import_react13.useEffect)(() => {
    const was = focusWasOnRef.current === true;
    focusWasOnRef.current = focusOn === true;
    if (focusOn !== true || was === true || focusAnchorId === null) return;
    const kick = mindMapCenterKick;
    if (kick === null || typeof kick.fn !== "function") return;
    mindMapCameraTouched = true;
    mindMapPendingFit.until = 0;
    kick.fn(focusAnchorId);
  }, [focusOn, focusAnchorId]);
  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);`
  },
  {
    label: "graph-bar-props",
    find: "        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(GraphBar, { onRelayout: relayoutGraph, onGenerateTags: generateTags, tagBusy: tagBusy, tagCount: graphTagCount }),",
    replace: "        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(GraphBar, { onRelayout: relayoutGraph, onGenerateTags: generateTags, tagBusy: tagBusy, tagCount: graphTagCount, focusOn: focusOn, focusCount: focusCount, onToggleFocus: function () { mindMapFocusAnchorReset(); focusModeSet(!focusOn); }, hideArchived: hideArchivedOn, archivedCount: archivedCardCount, onToggleHideArchived: function () { hideArchivedSet(!hideArchivedOn); } }),"
  },
  {
    label: "node-cache-ref",
    find: "  const focusAnchorRef = (0, import_react13.useRef)(null);",
    replace: "  const focusAnchorRef = (0, import_react13.useRef)(null);\n  const nodeCacheRef = (0, import_react13.useRef)(/* @__PURE__ */ new Map());"
  },
  {
    label: "card-node-object",
    find: "      return {\n        id: cardId,\n        type: \"sessionCard\",",
    replace: "      const node = {\n        id: cardId,\n        type: \"sessionCard\","
  },
  {
    label: "card-node-stable",
    find: "        hidden: foldedSet.has(cardId),\n        className: dragging ? \"tmDragging\" : \"\"\n      };\n    });",
    replace: "        hidden: foldedSet.has(cardId) || (graphOn && hideArchivedOn && (archivedSessionSet.has(card.sessionId) || (summary !== void 0 && summary.origin === \"subagent\" && summary.running !== true && (currentSessionRoot === void 0 || sessionRootOf(card.sessionId) !== currentSessionRoot)))),\n        className: dragging ? \"tmDragging\" : \"\"\n      };\n      return graphStableNode(nodeCacheRef.current, cardId, node);\n    });\n    for (const cachedId of nodeCacheRef.current.keys()) if (visibleCards[cachedId] === void 0) nodeCacheRef.current.delete(cachedId);"
  },
  {
    label: "lod-onmove",
    find: "            onMoveEnd: (_event, viewport) => {\n              canvas.setCamera(INBOX_BOARD_ID, viewport);\n            },",
    replace: "            onMove: (_event, viewport) => {\n              const root = wrapperRef.current;\n              if (root === null) return;\n              const level = viewport.zoom < 0.4 ? \"far\" : \"near\";\n              if (root.dataset.lod !== level) root.dataset.lod = level;\n            },\n            onMoveEnd: (_event, viewport) => {\n              canvas.setCamera(INBOX_BOARD_ID, viewport);\n            },"
  },
  {
    label: "only-render-visible",
    find: "            proOptions: { hideAttribution: true },",
    replace: "            proOptions: { hideAttribution: true },\n            onlyRenderVisibleElements: true,"
  },
  {
    label: "lod-initial",
    find: "  const graphCardIds = Object.keys(visibleCards).sort();",
    replace: String.raw`  (0, import_react13.useEffect)(() => {
    const apply = () => {
      const root = wrapperRef.current;
      if (root === null) return;
      const level = getZoom() < 0.4 ? "far" : "near";
      if (root.dataset.lod !== level) root.dataset.lod = level;
    };
    apply();
    const timer = window.setTimeout(apply, 420);
    return function () { window.clearTimeout(timer); };
  }, [graphOn, getZoom]);
  const graphCardIds = Object.keys(visibleCards).sort();`
  },
  {
    label: "dot-node-type",
    find: "var nodeTypes = {\n  sessionCard: SessionCardNode,\n  wsFrame: WsFrameNode,\n  stackCell: StackNode\n};",
    replace: "var nodeTypes = {\n  sessionCard: SessionCardNode,\n  wsFrame: WsFrameNode,\n  stackCell: StackNode,\n  sessionDot: GraphDotNode\n};"
  },
  {
    label: "dot-click-open",
    find: "              if (node.type === \"sessionCard\") {\n                const data = node.data;\n                if (!data.ghost) openSession(data.sessionId);\n                return;\n              }",
    replace: "              if (node.type === \"sessionCard\" || node.type === \"sessionDot\") {\n                const data = node.data;\n                if (!data.ghost) openSession(data.sessionId);\n                return;\n              }"
  },
  {
    label: "dot-context-menu",
    find: "              if (node.type === \"sessionCard\") openMenu(event, \"card\", node.id);",
    replace: "              if (node.type === \"sessionCard\" || node.type === \"sessionDot\") openMenu(event, \"card\", node.id);"
  },
  {
    label: "node-click-distance",
    find: "            proOptions: { hideAttribution: true },\n            onlyRenderVisibleElements: true,",
    replace: "            proOptions: { hideAttribution: true },\n            onlyRenderVisibleElements: true,\n            // Without this React Flow treats any pointer movement as a drag and\n            // never fires onNodeClick: a normal mouse jitters 1-3px, so clicking\n            // a card silently did nothing.\n            nodeClickDistance: 6,"
  },
  {
    label: "graph-edge-type",
    find: "var edgeTypes = { mindMap: MindMapEdge };",
    replace: "var edgeTypes = { mindMap: MindMapEdge, graphLine: GraphLineEdge };"
  },
  {
    label: "card-tags-render",
    find: "/* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(\"div\", { className: mind_map_default[\"cardFooter\"], children: [",
    replace: "data.tags !== void 0 && data.tags.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(\"div\", { className: \"tm_cardTags\", children: data.tags.map((tag) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(\"span\", { className: \"tm_tagChip\", children: tag }, tag)) }) : null,\n        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(\"div\", { className: mind_map_default[\"cardFooter\"], children: ["
  },
  {
    label: "drag-ref",
    find: "  const [draggingCardId, setDraggingCardId] = (0, import_react13.useState)(null);",
    replace: "  const [draggingCardId, setDraggingCardId] = (0, import_react13.useState)(null);\n  const dragPosRef = (0, import_react13.useRef)(null);\n  const dragTickRef = (0, import_react13.useRef)(0);\n  const tapRef = (0, import_react13.useRef)(null);\n  const pushedRef = (0, import_react13.useRef)({});"
  },
  {
    label: "drop-reset-dragref",
    find: "          setDraggingCardId(null);\n          setDragCenter(null);\n          const droppedGroupId = sessionWs.get(visibleCards[change.id]?.sessionId ?? \"\");",
    replace: "          setDraggingCardId(null);\n          setDragCenter(null);\n          dragPosRef.current = null;\n          if (Object.keys(pushedRef.current).length > 0) { canvas.moveCards(pushedRef.current); pushedRef.current = {}; }\n          const droppedGroupId = sessionWs.get(visibleCards[change.id]?.sessionId ?? \"\");"
  },
  {
    label: "drop-persist-graph",
    find: "          if (!graphOn && droppedLayout !== void 0 && droppedRect !== void 0) {",
    replace: "          if (graphOn) {\n            canvas.moveCard(change.id, change.position.x, change.position.y);\n          } else if (droppedLayout !== void 0 && droppedRect !== void 0) {"
  },
  {
    label: "drag-no-store-write",
    find: "        } else if (change.dragging === true) {\n          setDraggingCardId(change.id);\n          setDragCenter({ x: change.position.x + CARD_W / 2, y: change.position.y + CARD_H / 2 });\n          canvas.moveCard(change.id, change.position.x, change.position.y);\n        }",
    replace: "        } else if (change.dragging === true) {\n          // Drag frames: React Flow already moves the node in its own store at\n          // pointer speed. Writing the plugin store here re-rendered all 63\n          // cards + 88 edges on every pointermove (measured: p95 100 ms/frame,\n          // 134 long tasks while dragging one card). Keep the live position in\n          // a ref, persist once on drop.\n          if (draggingCardId !== change.id) setDraggingCardId(change.id);\n          dragPosRef.current = { x: change.position.x, y: change.position.y };\n          const dragNow = typeof performance !== \"undefined\" ? performance.now() : Date.now();\n          if (!graphOn && dragNow - dragTickRef.current > 90) {\n            dragTickRef.current = dragNow;\n            setDragCenter({ x: change.position.x + CARD_W / 2, y: change.position.y + CARD_H / 2 });\n          }\n        }"
  },
  {
    label: "drag-position-ref",
    find: "        position: dragging || graphOn || slot === void 0 ? { x: card.x, y: card.y } : { x: slot.x, y: slot.y },",
    replace: "        position: dragging && dragPosRef.current !== null ? dragPosRef.current : dragging || graphOn || slot === void 0 ? { x: card.x, y: card.y } : { x: slot.x, y: slot.y },"
  },
  {
    label: "skip-slot-layout-in-graph",
    find: "  const folderLayouts = (0, import_react13.useMemo)(() => {\n    const out = {};\n    for (const [groupId, rect] of Object.entries(frameRects)) {",
    replace: "  const folderLayouts = (0, import_react13.useMemo)(() => {\n    const out = {};\n    if (graphOn) return out;\n    for (const [groupId, rect] of Object.entries(frameRects)) {"
  },
  {
    label: "skip-slot-layout-deps",
    find: "  }, [frameRects, membersByGroup, visibleCards, pinnedSessions, draggingCardId, dragCenter]);",
    replace: "  }, [frameRects, membersByGroup, visibleCards, pinnedSessions, draggingCardId, dragCenter, graphOn]);"
  },
  {
    label: "surface-swap",
    find: "          index,\n          {\n            nodes,\n            edges,",
    replace: "          GraphSurface,\n          {\n            nodes,\n            edges,"
  },
  {
    label: "live-attach",
    // 实时活动（正在思考 / 正在执行）：$on 上没有任何 agent/* 帧，真正的通道是
    // 每会话一条 remote.session.follow 异步流。优先 ctx.get（实测免 inject），
    // 拿不到再走 ctx.inject 的迟到绑定；两条都失败就静默降级成原来的预览文本。
    find: "    }, \"mind_map: session alerts\");",
    replace: "    }, \"mind_map: session alerts\");\n" +
      "    ctx.effect(function () {\n" +
      "      var attached = false;\n" +
      "      var attachWith = function (remote, namespace) {\n" +
      "        if (attached === true || remote === void 0 || remote === null) return;\n" +
      "        try { attached = mindMapLive.attach(remote, ctx.sessions !== void 0 && ctx.sessions !== null ? ctx.sessions.list : null, namespace); } catch (error) { attached = false; }\n" +
      "      };\n" +
      "      try { attachWith(ctx.get(\"remote\"), ctx.get(\"remote.session\")); } catch (error) { }\n" +
      "      if (attached !== true) {\n" +
      "        try { ctx.inject([\"remote\", \"remote.session\"], function (scoped) { attachWith(scoped.remote, scoped[\"remote.session\"]); }); } catch (error) { }\n" +
      "      }\n" +
      "      return function () { try { mindMapLive.dispose(); } catch (error) { } };\n" +
      "    }, \"mind_map: live activity\");"
  },
  {
    label: "sidebar-seat",
    // Docks the same map into dsh-better-sidebar's right column (next to
    // 文件 / Git / 上下文) instead of only owning the centre column. Optional:
    // without that plugin the `main` panel above stays the only seat, which is
    // exactly the behaviour before this patch.
    find: "    }, MapOverlay), \"main panel\");",
    replace: "    }, MapOverlay), \"main panel\");\n" +
      "    // 侧栏席位：只注册，绝不自动 openTab。\n" +
      "    // 连打开栏会把 better-sidebar 拖进每帧重排（实测 6 次 openTab 后整页 60→1fps 且不恢复），\n" +
      "    // 所以这里只在用户点「打开思维图」时开一次。\n" +
      "    (function registerSidebarSeat() {\n" +
      "      var acquired = false;\n" +
      "      var tries = 0;\n" +
      "      var tryAcquire = function () {\n" +
      "        if (acquired === true) return true;\n" +
      "        var better = null;\n" +
      "        try { better = typeof ctx.get === \"function\" ? ctx.get(\"betterSidebar\") : void 0; } catch (error) { better = void 0; }\n" +
      "        if (better === void 0 || better === null || typeof better.registerTab !== \"function\") return false;\n" +
      "        acquired = true;\n" +
      "        mindMapSidebarSeat.service = better;\n" +
      "        mindMapApplyCtx = ctx;\n" +
      "        try {\n" +
      "          ctx.effect(function () {\n" +
      "            var dispose = better.registerTab({\n" +
      "              id: \"mind_map:map\",\n" +
      "              title: function () { return t(\"map.title\"); },\n" +
      "              order: 45,\n" +
      "              single: true,\n" +
      "              onOpen: function () { mindMapSidebarTabRemember(true); },\n" +
      "              onActivate: function () { mindMapSidebarTabRemember(true); },\n" +
      "              onClose: function () { mindMapSidebarTabRemember(false); },\n" +
      "              component: function (tabProps) { return (0, import_jsx_runtime16.jsx)(MapSidebarTab, tabProps); }\n" +
      "            });\n" +
      "            return function () { mindMapSidebarSeat.service = null; dispose(); };\n" +
      "          }, \"mind_map: sidebar tab\");\n" +
      "        } catch (error) { console.error(\"[mind_map] sidebar tab registration failed:\", error); }\n" +
      "        mindMapMountLauncher(better);\n" +
      "        // 启动后只自动开「一次」（每次页面加载最多一次 openTab，不会像会话切换那样连打）：\n" +
      "        // 这样刷新/重启后那一栏自己就回来了；之后切会话不再自动开（避免 1fps 风暴）。\n" +
      "        window.setTimeout(function () {\n" +
      "          try { if (document.querySelector(\".tm_sbPanel .tm_graphSurface\") === null) mindMapOpenSidebarTab(mindMapSidebarSeat.service); } catch (error) { }\n" +
      "        }, 2500);\n" +
      "        window.setTimeout(mindMapDedupeCards, 2500);\n" +
      "        window.setTimeout(mindMapDedupeCards, 7000);\n" +
      "        return true;\n" +
      "      };\n" +
      "      var acquireTimer = window.setInterval(function () {\n" +
      "        tries += 1;\n" +
      "        if (tryAcquire() === true || tries > 60) {\n" +
      "          window.clearInterval(acquireTimer);\n" +
      "          acquireTimer = 0;\n" +
      "        }\n" +
      "      }, 500);\n" +
      "      tryAcquire();" +
      "    })();"
  },
  {
    label: "panellist-seat",
    // 左栏那排（插件 / 自动化任务 / 上下文洞察 / 任务看板 / 记忆系统 / SSH）是
    // `sidebar.panellist` 插槽，每个插件自己注册一行；地图以前只挂了底部切换
    // 按钮和 better-sidebar 的右栏 tab，所以在那一排里看不到它。行的 id 必须
    // 等于 main 面板的 key —— 壳按 id 切到那张面板，行框/标签/高亮也由壳负责。
    find: String.raw`    }, MapToggleButton), "sidebar.footer.action");`,
    replace: String.raw`    }, MapToggleButton), "sidebar.footer.action");
    registerSafely("sidebar.panellist", () => ctx.slots.register({
      name: "sidebar.panellist",
      id: MAP_PANEL_ID,
      order: 35,
      label: () => t("map.title")
    }, MindMapPanelIcon), "sidebar.panellist");`
  },
  {
    label: "toggle-sidebar-first",
    // The footer button now prefers the sidebar seat and falls back to the
    // centre panel when betterSidebar is not installed.
    find: "        onClick: () => {\n          mapUi.toggle();\n        },",
    replace: "        onClick: () => {\n          if (!openMindMapSidebar()) mapUi.toggle();\n        },"
  },
  {
    label: "subagent-place-cards",
    // 子代理补卡：父卡在板上就落在父卡右侧；父卡不在（父会话从没导入过地图）就沿血缘
    // 往上找最近的祖先卡；一个祖先卡都没有的统一排到板子右侧的「子代理」带里。
    // 只在每个 session 上做一次（ref 去重），避免和用户删掉的卡互相打架。
    find: "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);",
    replace: String.raw`  const subagentPlacedRef = (0, import_react13.useRef)(new Set());
  (0, import_react13.useEffect)(() => {
    if (canvasState.phase !== "ready") return;
    // 隐藏实例（别的 session 的 pane / 没显示的 tab）不许补卡：否则同一个子代理
    // 会被每个实例各补一张，板上一会话三张卡（2026-11-12 实测）。
    const surfaceEl = wrapperRef.current;
    if (surfaceEl === null) return;
    const surfaceBox = surfaceEl.getBoundingClientRect();
    if (surfaceBox.width < 40 || surfaceBox.height < 40) return;
    const cardOfSession = (sessionId) => {
      for (const entry of Object.entries(visibleCards)) {
        if (entry[1].sessionId === sessionId) return entry[1];
      }
      return null;
    };
    let rightEdge = 0;
    for (const entry of Object.entries(visibleCards)) {
      const card = entry[1];
      if (card.x + CARD_W > rightEdge) rightEdge = card.x + CARD_W;
    }
    let orphanIndex = 0;
    const batch = {};
    for (const sessionId of placeableSessionIds(sessions)) {
      const row = sessions.byId[sessionId];
      if (row === void 0 || row.origin !== "subagent") continue;
      if (boardSessionIds.has(sessionId) || subagentPlacedRef.current.has(sessionId) || mindMapPlaceableNow(sessionId) !== true) continue;
      subagentPlacedRef.current.add(sessionId);
      mindMapMarkPlaced(sessionId);
      let cursor = row.parentId;
      let hops = 0;
      let anchor = null;
      while (cursor !== void 0 && hops < 6) {
        const hit = cardOfSession(cursor);
        if (hit !== null) { anchor = hit; break; }
        const up = sessions.byId[cursor];
        cursor = up === void 0 ? void 0 : up.parentId;
        hops += 1;
      }
      const column = orphanIndex % 3;
      const rowIndex = (orphanIndex - column) / 3;
      const spot = anchor === null
        ? { x: snap(rightEdge + 90 + column * (CARD_W + 30)), y: snap(400 + rowIndex * (CARD_H + 30)) }
        : { x: snap(anchor.x + CARD_W + 40), y: snap(anchor.y + (hops + 1) * 26) };
      orphanIndex += 1;
      batch[newCardId()] = { boardId: INBOX_BOARD_ID, sessionId: sessionId, x: spot.x, y: spot.y, createdAt: Date.now() };
    }
    if (Object.keys(batch).length > 0) canvas.addCards(batch);
  }, [canvasState.phase, sessions, visibleCards, boardSessionIds]);
  // 兜底去重：多实例 / SSE 延迟下同一会话仍可能被建出 2~3 张卡（2026-11-12 实测一个
  // 子代理一次出现在板上三次）。cards 一变就排一次，保留最早创建的那张；
  // mindMapDedupeCards 是模块级函数，几个实例同时跑也幂等。
  (0, import_react13.useEffect)(() => {
    if (canvasState.phase !== "ready") return;
    const dedupeTimer = window.setTimeout(mindMapDedupeCards, 700);
    return function () { window.clearTimeout(dedupeTimer); };
  }, [canvasState.phase, canvasState.cards]);
` + "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);"
  },
  {
    label: "start-fork",
    // Shift + drag out of a card on the canvas lands here: hand the plugin the
    // exact PendingSpawn state its own handle-drag path builds, so the existing
    // SpawnPreview dialog (and its context injection) is reused unchanged.
    find: "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);",
    replace: String.raw`  const startForkFrom = (forkCardId, flowX, flowY) => {
    const forkCard = visibleCards[forkCardId];
    if (forkCard === void 0) return;
    const forkSummary = sessions.byId[forkCard.sessionId];
    const forkWorkspaceId = sessionWs.get(forkCard.sessionId);
    const forkPending = {
      parent: { cardId: forkCardId, sessionId: forkCard.sessionId, title: forkSummary === void 0 ? forkCard.sessionId : forkSummary.displayTitle },
      x: snap(flowX - CARD_W / 2),
      y: snap(flowY - CARD_H / 2)
    };
    if (forkWorkspaceId !== void 0) forkPending.parentWorkspaceId = forkWorkspaceId;
    setPendingSpawn(forkPending);
  };
` + "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);"
  },
  {
    label: "menu-flow",
    // Canvas mode has no React Flow mounted, and React Flow's
    // screenToFlowPosition then returns the raw client point — so a context
    // menu action that places something "at the click" would drop it at the
    // wrong place. Ask the canvas for the real conversion when it is live.
    find: "    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });",
    replace: "    const flow = mindMapCanvasToFlow.fn !== null ? mindMapCanvasToFlow.fn(event.clientX, event.clientY) : screenToFlowPosition({ x: event.clientX, y: event.clientY });"
  },
  {
    label: "tap-bridge",
    // Two entries used to share this anchor with two `replace:` keys in one
    // object literal — the second key won and the `savedCamera` line got
    // replaced by drag-push code, which is exactly why the panel stopped
    // opening. Keep one edit per anchor and one anchor per edit.
    find: "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);",
    replace: "  mindMapTapBridge.live = { sessions: sessions, batchMode: batchMode, open: openSession, commit: function (points) { canvas.moveCards(points); } };\n" +
      "  mindMapCanvasBridge.current = {\n" +
      "    startSessionAt: function (flowX, flowY) { startSessionIn(folderAt(flowX, flowY)); },\n" +
      "    openCardMenu: function (fakeEvent, cardId) { openMenu(fakeEvent, \"card\", cardId); },\n" +
      "    openPaneMenu: function (fakeEvent) { openMenu(fakeEvent, \"pane\"); },\n" +
      "    forkFrom: function (cardId, flowX, flowY) { startForkFrom(cardId, flowX, flowY); }\n" +
      "  };\n" +
      "  (0, import_react13.useEffect)(() => () => { mindMapTapBridge.live = null; mindMapCanvasBridge.current = null; }, []);\n" +
      "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);"
  },
  {
    label: "graph-surface-focus-anchor",
    // 聚焦锚点交给 canvas 绘制层（propsRef.focusAnchorId）；白板模式在 GraphSurface
    // 里把这条 prop 摘掉，免得透传给 React Flow。
    find: "          GraphSurface,\n          {\n            nodes,\n            edges,",
    replace: "          GraphSurface,\n          {\n            nodes,\n            edges,\n            focusAnchorId: focusAnchorId,"
  },
  {
    label: "auto-sync-continuous",
    // 自动补卡从「每次挂载只跑一次」改成「跟着会话列表一直补」。地图是单实例、
    // 启动时就挂好，一次性守卫意味着启动之后新建的会话永远不上板
    // （2026-11-12 实测：09:00 之后新建的两个会话在 mind_map.json 里查无此卡）。
    find: "  const autoSyncedRef = (0, import_react13.useRef)(false);\n  (0, import_react13.useEffect)(() => {\n    if (canvasState.phase !== \"ready\" || !workspacesReady || autoSyncedRef.current) return;\n    autoSyncedRef.current = true;\n    const remembered = canvasState.global?.layoutMemory ?? {};",
    replace: "  // 连续自动补卡（2026-11-12）：原来这里是 autoSyncedRef 一次性守卫——地图是单实例、\n" +
      "  // 启动时就挂好，所以「只跑一次」等于「启动之后新建的会话永远不上板」。现在每次\n" +
      "  // sessions 更新都补一次缺卡；没有缺卡时只对比、不写库。用户显式移除 / 归档的会话\n" +
      "  // 记进 removedSessionIdsRef，不会被补回来（刷新页面后重置，和以前的「打开即补齐」一致）。\n" +
      "  const removedSessionIdsRef = (0, import_react13.useRef)(/* @__PURE__ */ new Set());\n" +
      "  (0, import_react13.useEffect)(() => {\n" +
      "    if (canvasState.phase !== \"ready\" || !workspacesReady) return;\n" +
      "    // 隐藏实例（别的 session 的 pane）不许补卡：DSH 壳会把旧 pane 留在 DOM 里，\n" +
      "    // 多份实例各建一张就出现重复卡（2026-11-12 实测一个子代理 3 张）。\n" +
      "    const surfaceEl = wrapperRef.current;\n" +
      "    if (surfaceEl === null) return;\n" +
      "    const surfaceBox = surfaceEl.getBoundingClientRect();\n" +
      "    if (surfaceBox.width < 40 || surfaceBox.height < 40) return;\n" +
      "    const missingSessionIds = placeableSessionIds(sessions).filter((sessionId) => {\n" +
      "      if (removedSessionIdsRef.current.has(sessionId)) return false;\n" +
      "      // 子代理有自己的补卡逻辑（贴着主卡摆），这里不重复建卡。\n" +
      "      const row = sessions.byId[sessionId];\n" +
      "      return row === void 0 || row.origin !== \"subagent\";\n" +
      "    });\n" +
      "    const remembered = canvasState.global?.layoutMemory ?? {};"
  },
  {
    label: "auto-sync-continuous-newcomers",
    find: "    const newcomers = /* @__PURE__ */ new Map();\n    for (const sessionId of placeableSessionIds(sessions)) {\n      const groupId = sessionWs.get(sessionId);\n      if (groupId === void 0 || framed.has(groupId) || boardSessionIds.has(sessionId)) continue;",
    replace: "    const newcomers = /* @__PURE__ */ new Map();\n    for (const sessionId of missingSessionIds) {\n      const groupId = sessionWs.get(sessionId);\n      if (groupId === void 0 || framed.has(groupId) || boardSessionIds.has(sessionId)) continue;"
  },
  {
    label: "auto-sync-continuous-missing",
    find: "      const missing = placeableSessionIds(sessions).filter((id2) => sessionWs.get(id2) === groupId && !boardSessionIds.has(id2)).sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0));",
    replace: "      const missing = missingSessionIds.filter((id2) => sessionWs.get(id2) === groupId && !boardSessionIds.has(id2)).sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0));"
  },
  {
    label: "removed-card-memory-actions",
    // 归档 / 删除会连带把卡从板上摘掉；连续补卡必须记住「这是用户主动移除的」，
    // 否则下一轮 sessions 刷新就又把卡建回来。
    find: "      for (const cardId of cardIds) canvas.removeCard(cardId);",
    replace: "      for (const sessionId of sessionIds) removedSessionIdsRef.current.add(sessionId);\n      for (const cardId of cardIds) canvas.removeCard(cardId);"
  },
  {
    label: "removed-card-memory-delete",
    // 白板里 Delete 掉一张卡也属于主动移除：同样记下来，别被自动补卡加回来。
    find: "        } else if (!change.id.startsWith(\"stack-\")) {\n          canvas.removeCard(change.id);\n        }",
    replace: "        } else if (!change.id.startsWith(\"stack-\")) {\n          const removedCard = visibleCards[change.id];\n          if (removedCard !== void 0) removedSessionIdsRef.current.add(removedCard.sessionId);\n          canvas.removeCard(change.id);\n        }"
  },
  {
    label: "auto-sync-newcomer-guard",
    // 多实例节流：同一秒里几个实例都会看到「这个会话还没卡」，模块级 guard 只放一个进去。
    find: "    const newcomers = /* @__PURE__ */ new Map();\n    for (const sessionId of missingSessionIds) {\n      const groupId = sessionWs.get(sessionId);\n      if (groupId === void 0 || framed.has(groupId) || boardSessionIds.has(sessionId)) continue;",
    replace: "    const newcomers = /* @__PURE__ */ new Map();\n    for (const sessionId of missingSessionIds) {\n      if (mindMapPlaceableNow(sessionId) !== true) continue;\n      const groupId = sessionWs.get(sessionId);\n      if (groupId === void 0 || framed.has(groupId) || boardSessionIds.has(sessionId)) continue;"
  },
  {
    label: "auto-sync-newcomer-mark",
    find: "        for (const card of cards) batch[newCardId()] = card;\n        canvas.addCards(batch);\n        canvas.setWsFrameRect(groupId, rect);",
    replace: "        for (const card of cards) batch[newCardId()] = card;\n        canvas.addCards(batch);\n        for (const sessionId of ordered) mindMapMarkPlaced(sessionId);\n        canvas.setWsFrameRect(groupId, rect);"
  },
  {
    label: "auto-sync-missing-guard",
    find: "      const missing = missingSessionIds.filter((id2) => sessionWs.get(id2) === groupId && !boardSessionIds.has(id2)).sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0));",
    replace: "      const missing = missingSessionIds.filter((id2) => sessionWs.get(id2) === groupId && !boardSessionIds.has(id2) && mindMapPlaceableNow(id2) === true).sort((a, b) => (sessions.byId[b]?.updatedAt ?? 0) - (sessions.byId[a]?.updatedAt ?? 0));"
  },
  {
    label: "auto-sync-missing-mark",
    find: "        added[newCardId()] = {\n          boardId: INBOX_BOARD_ID,\n          sessionId,",
    replace: "        mindMapMarkPlaced(sessionId);\n        added[newCardId()] = {\n          boardId: INBOX_BOARD_ID,\n          sessionId,"
  },
];

const HOST_EDITS = [
  {
    label: "prompt-rules",
    find: String.raw`	"- Output raw JSON only: no markdown fences, no commentary."`,
    replace: String.raw`	"- tags: 2 to 4 SHORT topical tags (1-3 characters each, or one English word), reused consistently",
	"  across conversations: name the project, technology, product or recurring subject, never a status",
	"  or a one-off action. Same subject in two conversations MUST yield the same tag string.",
	"- Output raw JSON only: no markdown fences, no commentary."`
  },
  {
    label: "parse-tags",
    find: String.raw`		nextStep: parsed.nextStep.slice(0, 120)
	};`,
    replace: String.raw`		nextStep: parsed.nextStep.slice(0, 120),
		tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag) => typeof tag === "string" && tag.trim() !== "").slice(0, 6).map((tag) => tag.trim().slice(0, 24)) : []
	};`
  },
  {
    label: "digest-fallback-tags",
    find: String.raw`			nextStep: previous?.nextStep ?? "",`,
    replace: String.raw`			nextStep: previous?.nextStep ?? "",
			tags: previous?.tags ?? [],`,
    count: 2
  },
  {
    label: "digest-success-tags",
    find: String.raw`			nextStep: parsed.nextStep,`,
    replace: String.raw`			nextStep: parsed.nextStep,
			tags: parsed.tags,`
  },
  {
    label: "digest-schema-tags",
    find: String.raw`	keyFindings: z.array(z.string()),`,
    replace: String.raw`	keyFindings: z.array(z.string()),
	/** Stable topical tags: the graph view links conversations that share one. */
	tags: z.array(z.string()).optional(),`
  }
];

/* ------------------------------------------------------------------ */
/* 4. run                                                              */
/* ------------------------------------------------------------------ */

assertUniqueLabels(CLIENT_EDITS, "client");
assertUniqueLabels(HOST_EDITS, "host");

if (listOnly) {
  console.log("client edits (" + CLIENT_EDITS.length + "):");
  for (const edit of CLIENT_EDITS) console.log("  " + edit.label);
  console.log("host edits (" + HOST_EDITS.length + "):");
  for (const edit of HOST_EDITS) console.log("  " + edit.label);
  process.exit(0);
}

if (revert) {
  for (const file of [CLIENT, HOST]) {
    const bak = file + BACKUP_SUFFIX;
    if (existsSync(bak)) { copyFileSync(bak, file); unlinkSync(bak); console.log("reverted " + file); }
    else console.log("no backup for " + file + " (nothing to revert)");
  }
  process.exit(0);
}

const clientSource = renameAll(readFileSync(CLIENT, "utf8").replace(/\r\n/g, "\n"));
const hostSource = renameAll(readFileSync(HOST, "utf8").replace(/\r\n/g, "\n"));

if (clientSource.includes(MARK) || hostSource.includes(MARK)) {
  console.log("already patched (marker present) — run --revert first if you want to re-apply");
  process.exit(0);
}

const clientEdits = selectEdits(CLIENT_EDITS, "client");
const hostEdits = selectEdits(HOST_EDITS, "host");

const patchedClient = applyEdits(clientSource, clientEdits, "client");
const patchedHost = applyEdits(hostSource, hostEdits, "host");
assertParses(patchedClient, "client", "script");
assertParses(patchedHost, "host", "module");

if (dryRun) {
  console.log("dry run — nothing written");
  console.log("client: " + clientSource.length + " -> " + patchedClient.length + " chars");
  console.log("host:   " + hostSource.length + " -> " + patchedHost.length + " chars");
  process.exit(0);
}

backup(CLIENT);
backup(HOST);

writeFileSync(CLIENT, patchedClient);
writeFileSync(HOST, patchedHost);

console.log("client: " + clientSource.length + " -> " + patchedClient.length + " chars");
console.log("host:   " + hostSource.length + " -> " + patchedHost.length + " chars");
console.log("patched OK: " + CLIENT);
console.log("patched OK: " + HOST);
