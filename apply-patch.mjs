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
try { graphModeState = window.localStorage.getItem(GRAPH_MODE_KEY) !== "0"; } catch (error) { graphModeState = true; }
var graphModeListeners = new Set();
function graphModeGet() { return graphModeState; }
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
  const iterations = settings.iterations || 400;
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
  for (let pass = 0; pass < 90; pass += 1) {
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
/** Canvas graph surface: one draw call per frame instead of a DOM tree per card.
 * It speaks the same event vocabulary as React Flow (onNodesChange /
 * onMoveEnd), so the persistence, tap-to-open and repulsion logic above keep
 * working unchanged. */
function GraphCanvasSurface(props) {
  var react = import_react13;
  var rootRef = react.useRef(null);
  var canvasRef = react.useRef(null);
  var propsRef = react.useRef(props);
  propsRef.current = props;
  var cameraRef = react.useRef(null);
  if (cameraRef.current === null) cameraRef.current = readGraphCamera();
  var dragRef = react.useRef(null);
  var frameRef = react.useRef(0);
  var hoverRef = react.useRef(null);
  var drawRef = react.useRef(function () { });
  var fitRef = react.useRef(null);

  // ---- force simulation -------------------------------------------------
  // Continuous and d3-force shaped: all-pairs Coulomb repulsion, spring edges
  // with a hard length ceiling, velocity decay and annealing. Unlike the
  // "shove the neighbour aside when you bump into it" behaviour it replaces,
  // every node keeps pushing every other node all the time, so the board
  // settles into an equilibrium instead of only reacting to collisions.
  // Positions live in this ref; the plugin store is written once per settle.
  var simRef = react.useRef(null);
  var tweenRef = react.useRef(null);
  var forkRef = react.useRef(null);
  // Set when an outside writer (the "重新排布" button, a restored layout) has
  // just moved the cards: the next tick re-reads every position from the store
  // instead of keeping the simulation's old coordinates.
  var reseedRef = react.useRef(false);
  /** 「⟲ 重新排布」把坐标写完之后要自动缩放到合适大小（收敛后再来一次）。 */
  var pendingFitRef = react.useRef(false);
  var simSettings = {
    // Sized for 224x120 cards: an isolated pair settles at roughly 420 px
    // (k*(d-L) = charge/d^2). d3's defaults are for 30 px dots, so they are
    // useless here — with charge -30 nothing moves at all.
    charge: -320000,       // repulsion constant: a = charge / d^2
    linkDistance: 330,     // spring rest length, a little over one card width
    stiffness: 0.02,       // spring constant below the ceiling
    stiffCeiling: 0.3,     // pull when stretched past maxStretch * linkDistance
    maxStretch: 1.35,
    gravity: 0.003,        // weak pull to the centroid so nothing escapes
    repulsionRange: 1150,  // beyond this the pairs stop pushing: dragging one
                           // card then relaxes its neighbourhood instead of
                           // rearranging the whole board
    forceScale: 1,         // multiplier on every force
    velocityDecay: 0.5,    // v = (v + a) * 0.5 — heavy damping: the board stops
                           // where it is instead of gliding on for seconds
    maxVelocity: 45,
    alphaDecay: 0.955,     // ~2.0 s from rest-heat to a standstill at 60 fps
    alphaMin: 0.004
  };

  var ensureSim = function () {
    var sim = simRef.current;
    if (sim === null) { sim = { nodes: new Map(), alpha: 0 }; simRef.current = sim; }
    if (reseedRef.current === true) {
      reseedRef.current = false;
      sim.nodes.clear();
    }
    var nodes = visibleNodes();
    var alive = new Set();
    var idle = sim.alpha <= simSettings.alphaMin;
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      alive.add(node.id);
      var state = sim.nodes.get(node.id);
      if (state === void 0) {
        sim.nodes.set(node.id, { x: node.position.x, y: node.position.y, vx: 0, vy: 0 });
        continue;
      }
      // While the simulation stands still the store wins: a relayout, a restored
      // drag or a card placed by the plugin must not be overruled by the last
      // tick, otherwise the canvas would show stale coordinates forever.
      if (idle) {
        state.x = node.position.x;
        state.y = node.position.y;
        state.vx = 0;
        state.vy = 0;
      }
    }
    var stale = [];
    sim.nodes.forEach(function (value, key) { if (!alive.has(key)) stale.push(key); });
    for (var drop = 0; drop < stale.length; drop += 1) sim.nodes.delete(stale[drop]);
    return sim;
  };

  var reheat = function (value) {
    var sim = ensureSim();
    if (sim.alpha < value) sim.alpha = value;
  };

  var tickSim = function () {
    var sim = ensureSim();
    var settings = simSettings;
    if (sim.alpha <= settings.alphaMin) return false;
    var ids = [];
    sim.nodes.forEach(function (value, key) { ids.push(key); });
    var count = ids.length;
    var list = [];
    var centroidX = 0;
    var centroidY = 0;
    for (var index = 0; index < count; index += 1) {
      var state = sim.nodes.get(ids[index]);
      state.fx = 0;
      state.fy = 0;
      list.push(state);
      centroidX += state.x;
      centroidY += state.y;
    }
    centroidX = count === 0 ? 0 : centroidX / count;
    centroidY = count === 0 ? 0 : centroidY / count;
    var alpha = sim.alpha;
    // All-pairs repulsion. 62 cards are ~2k pairs per frame: cheap, and unlike
    // a collision test it keeps pushing long before the cards touch.
    for (var left = 0; left < count; left += 1) {
      for (var right = left + 1; right < count; right += 1) {
        var deltaX = list[right].x - list[left].x;
        var deltaY = list[right].y - list[left].y;
        var distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared < 1) {
          // Two cards sitting exactly on top of each other: nudge them apart on
          // a deterministic axis so they cannot stay welded together.
          deltaX = 0.7 + left * 0.001;
          deltaY = 0.7 + right * 0.001;
          distanceSquared = deltaX * deltaX + deltaY * deltaY;
        }
        var distance = Math.sqrt(distanceSquared);
        if (distance > settings.repulsionRange) continue;
        var push = (settings.charge / distanceSquared) * alpha * settings.forceScale;
        var unitX = deltaX / distance;
        var unitY = deltaY / distance;
        list[left].fx += unitX * push;
        list[left].fy += unitY * push;
        list[right].fx -= unitX * push;
        list[right].fy -= unitY * push;
      }
    }
    // Spring edges: linear below the ceiling, hard pull above it, so a card can
    // never be dragged arbitrarily far from the conversations it belongs to.
    // 组内现在全连接，如果不按度数归一，一个大组会被十几根弹簧压成一团：
    // 每条弹簧按 2/(degA+degB) 加权，使每个节点受到的总弹力大致恒定。
    var edges = propsRef.current.edges || [];
    var edgeDegree = new Map();
    for (var degreeIndex = 0; degreeIndex < edges.length; degreeIndex += 1) {
      edgeDegree.set(edges[degreeIndex].source, (edgeDegree.get(edges[degreeIndex].source) || 0) + 1);
      edgeDegree.set(edges[degreeIndex].target, (edgeDegree.get(edges[degreeIndex].target) || 0) + 1);
    }
    for (var edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      var from = sim.nodes.get(edges[edgeIndex].source);
      var to = sim.nodes.get(edges[edgeIndex].target);
      if (from === void 0 || to === void 0) continue;
      var springX = to.x - from.x;
      var springY = to.y - from.y;
      var length = Math.sqrt(springX * springX + springY * springY);
      if (length < 0.5) length = 0.5;
      var edgeWeight = 2 / ((edgeDegree.get(edges[edgeIndex].source) || 1) + (edgeDegree.get(edges[edgeIndex].target) || 1));
      var stiffness = (length > settings.linkDistance * settings.maxStretch ? settings.stiffCeiling : settings.stiffness) * edgeWeight;
      var pull = (length - settings.linkDistance) * stiffness * alpha * settings.forceScale;
      var springUnitX = springX / length;
      var springUnitY = springY / length;
      from.fx += springUnitX * pull;
      from.fy += springUnitY * pull;
      to.fx -= springUnitX * pull;
      to.fy -= springUnitY * pull;
    }
    var drag = dragRef.current;
    var pinned = drag !== null && drag.kind === "node" && drag.preview !== null ? drag.preview : null;
    for (var step = 0; step < count; step += 1) {
      var node = list[step];
      // A dragged card is pinned under the pointer and does not integrate; the
      // rest of the board keeps sliding around it.
      if (pinned !== null && ids[step] === drag.id) {
        node.x = pinned.x;
        node.y = pinned.y;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.fx += (centroidX - node.x) * settings.gravity * alpha;
      node.fy += (centroidY - node.y) * settings.gravity * alpha;
      node.vx = (node.vx + node.fx) * settings.velocityDecay;
      node.vy = (node.vy + node.fy) * settings.velocityDecay;
      if (node.vx > settings.maxVelocity) node.vx = settings.maxVelocity;
      if (node.vx < -settings.maxVelocity) node.vx = -settings.maxVelocity;
      if (node.vy > settings.maxVelocity) node.vy = settings.maxVelocity;
      if (node.vy < -settings.maxVelocity) node.vy = -settings.maxVelocity;
      node.x += node.vx;
      node.y += node.vy;
    }
    sim.alpha = alpha * settings.alphaDecay;
    return true;
  };

  /** Write the settled layout back to the plugin store — once, not per frame.
   * Goes through the tap bridge because moveCards is the only entry point
   * that does not re-enter the drop/click logic of the parent component. */
  var commitSim = function () {
    var sim = simRef.current;
    if (sim === null) return;
    var live = mindMapTapBridge.live;
    if (live === null || typeof live.commit !== "function") return;
    var points = {};
    var any = false;
    sim.nodes.forEach(function (state, key) {
      var x = Math.round(state.x);
      var y = Math.round(state.y);
      var node = null;
      var nodes = propsRef.current.nodes || [];
      for (var index = 0; index < nodes.length; index += 1) if (nodes[index].id === key) node = nodes[index];
      if (node === null) return;
      if (Math.abs(node.position.x - x) < 1 && Math.abs(node.position.y - y) < 1) return;
      points[key] = { x: x, y: y };
      any = true;
    });
    if (any) live.commit(points);
    // 收敛后：记住这次布局的成员签名（下次挂载/切会话时成员没变就不再重排），
    // 并且如果刚才点过「重新排布」，把镜头缩放到合适大小。
    try { window.localStorage.setItem(MIND_MAP_LAID_SIG_KEY, laidSignatureRef.current); } catch (error) { }
    if (pendingFitRef.current === true) {
      pendingFitRef.current = false;
      fitRef.current({ ease: true });
    }
  };

  var animateCameraTo = function (target, duration) {
    var camera = cameraRef.current;
    if (camera === null || duration <= 0) {
      cameraRef.current = target;
      writeGraphCamera(target);
      schedule();
      return;
    }
    tweenRef.current = {
      from: { x: camera.x, y: camera.y, zoom: camera.zoom },
      to: target,
      start: typeof performance !== "undefined" ? performance.now() : Date.now(),
      duration: duration
    };
    schedule();
  };

  var stepTween = function (now) {
    var tween = tweenRef.current;
    if (tween === null) return false;
    var progress = Math.min(1, (now - tween.start) / tween.duration);
    var eased = 1 - Math.pow(1 - progress, 3);
    cameraRef.current = {
      x: tween.from.x + (tween.to.x - tween.from.x) * eased,
      y: tween.from.y + (tween.to.y - tween.from.y) * eased,
      zoom: tween.from.zoom + (tween.to.zoom - tween.from.zoom) * eased
    };
    if (progress >= 1) {
      tweenRef.current = null;
      writeGraphCamera(cameraRef.current);
    }
    return true;
  };

  var schedule = function () {
    if (frameRef.current !== 0) return;
    frameRef.current = window.requestAnimationFrame(function () {
      frameRef.current = 0;
      drawRef.current();
    });
  };

  var visibleNodes = function () {
    var out = [];
    var nodes = propsRef.current.nodes || [];
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (node.hidden === true) continue;
      if (node.type !== "sessionCard" && node.type !== "sessionDot") continue;
      out.push(node);
    }
    return out;
  };

  var boxMap = function () {
    var drag = dragRef.current;
    var boxes = new Map();
    var nodes = visibleNodes();
    var sim = simRef.current;
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var position = node.position;
      // The simulation owns the positions while it runs; reading node.position
      // here would draw the previous frame and fight the layout.
      var state = sim === null ? null : sim.nodes.get(node.id);
      if (state !== void 0 && state !== null) position = { x: state.x, y: state.y };
      if (drag !== null && drag.kind === "node" && drag.id === node.id && drag.preview !== null) position = drag.preview;
      boxes.set(node.id, { x: position.x, y: position.y, w: CARD_W, h: GRAPH_CARD_RENDER_H });
    }
    return boxes;
  };

  fitRef.current = function (options) {
    var root = rootRef.current;
    if (root === null) return;
    var boxes = boxMap();
    if (boxes.size === 0) return;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    boxes.forEach(function (box) {
      if (box.x < minX) minX = box.x;
      if (box.y < minY) minY = box.y;
      if (box.x + box.w > maxX) maxX = box.x + box.w;
      if (box.y + box.h > maxY) maxY = box.y + box.h;
    });
    var viewWidth = Math.max(160, root.clientWidth - 120);
    var viewHeight = Math.max(160, root.clientHeight - 160);
    var spanX = Math.max(CARD_W, maxX - minX);
    var spanY = Math.max(GRAPH_CARD_RENDER_H, maxY - minY);
    var zoom = Math.max(0.06, Math.min(1, Math.min(viewWidth / spanX, viewHeight / spanY)));
    var target = {
      x: root.clientWidth / 2 - ((minX + maxX) / 2) * zoom,
      y: root.clientHeight / 2 - ((minY + maxY) / 2) * zoom,
      zoom: zoom
    };
    // First paint snaps; everything after eases, so switching focus no longer
    // teleports the camera (250 ms ease-out, the same beat the plugin's own
    // setCenter uses).
    var ease = options !== undefined && options !== null && options.ease === true;
    if (ease) animateCameraTo(target, 250);
    else {
      cameraRef.current = target;
      writeGraphCamera(target);
      schedule();
    }
  };

  drawRef.current = function () {
    mindMapDrawCount += 1;
    var root = rootRef.current;
    var canvas = canvasRef.current;
    if (root === null || canvas === null) return;
    var width = root.clientWidth;
    var height = root.clientHeight;
    if (width < 4 || height < 4) return;
    if (cameraRef.current === null) {
      fitRef.current();
      return;
    }
    var dpr = window.devicePixelRatio || 1;
    var pixelWidth = Math.round(width * dpr);
    var pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
    }
    var context = canvas.getContext("2d");
    if (context === null) return;
    var camera = cameraRef.current;
    var now = typeof performance !== "undefined" ? performance.now() : Date.now();
    var dark = propsRef.current.colorMode !== "light";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = dark ? "#14161b" : "#fbfbfd";
    context.fillRect(0, 0, width, height);
    var step = 24 * camera.zoom;
    if (step > 10) {
      context.fillStyle = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.055)";
      var offsetX = camera.x % step;
      var offsetY = camera.y % step;
      for (var dotX = offsetX; dotX < width; dotX += step) {
        for (var dotY = offsetY; dotY < height; dotY += step) context.fillRect(dotX, dotY, 1, 1);
      }
    }
    var boxes = boxMap();
    var zoom = camera.zoom;
    var lod = zoom < 0.42;
    var lodBlock = zoom < 0.22;
    var hovered = hoverRef.current;
    var edges = propsRef.current.edges || [];
    context.save();
    context.translate(camera.x, camera.y);
    context.scale(zoom, zoom);
    context.lineWidth = 1.1 / zoom;
    var edgePalette = {
      ws: dark ? "rgba(150,165,190,0.34)" : "rgba(70,85,105,0.30)",
      tag: dark ? "rgba(120,180,255,0.38)" : "rgba(40,110,200,0.34)",
      lineage: dark ? "rgba(255,206,120,0.42)" : "rgba(190,130,30,0.36)",
      other: dark ? "rgba(198,206,220,0.26)" : "rgba(40,48,60,0.24)"
    };
    context.fillStyle = dark ? "rgba(198,206,220,0.42)" : "rgba(40,48,60,0.34)";
    for (var edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      var edge = edges[edgeIndex];
      var fromBox = boxes.get(edge.source);
      var toBox = boxes.get(edge.target);
      if (fromBox === void 0 || toBox === void 0) continue;
      var fromCenterX = fromBox.x + fromBox.w / 2;
      var fromCenterY = fromBox.y + fromBox.h / 2;
      var toCenterX = toBox.x + toBox.w / 2;
      var toCenterY = toBox.y + toBox.h / 2;
      // ws = same workspace chain, tag = shared tag chain, lineage = the
      // plugin's own fork/draw edges, other = manual links and the rest.
      var kind = edge.data !== void 0 && edge.data.graphKind !== void 0 ? edge.data.graphKind : (edge.type === "mindMap" ? "lineage" : "other");
      var touchesHover = hovered !== null && (edge.source === hovered || edge.target === hovered);
      context.globalAlpha = hovered === null ? 1 : (touchesHover ? 1 : 0.18);
      context.strokeStyle = edgePalette[kind] === void 0 ? edgePalette.other : edgePalette[kind];
      context.lineWidth = (touchesHover ? 2.2 : 1.1) / zoom;
      var start = graphAnchorPoint(fromCenterX, fromCenterY, fromBox.w, fromBox.h, toCenterX, toCenterY);
      var end = graphAnchorPoint(toCenterX, toCenterY, toBox.w, toBox.h, fromCenterX, fromCenterY);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      // No arrowheads: these relationships are undirected, arrows only add noise.
    }
    context.globalAlpha = 1;
    context.lineWidth = 1.1 / zoom;
    var nodes = visibleNodes();
    for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      var node = nodes[nodeIndex];
      var box = boxes.get(node.id);
      if (box === void 0) continue;
      var data = node.data || {};
      var archived = data.archived === true;
      // 子会话：跑着时正常显示（角标「子代理 · 运行中」），跑完就和归档一样灰化。
      var isSubagent = data.subagent === true;
      var subagentDone = isSubagent && data.subagentFinished === true;
      var dormant = archived || subagentDone;
      var isHovered = hovered === node.id;
      var isDimmed = hovered !== null && hovered !== node.id;
      context.globalAlpha = dormant ? 0.42 : (isDimmed ? 0.45 : 1);
      graphRoundRect(context, box.x, box.y, box.w, box.h, 10);
      context.fillStyle = dark ? "#1b1e25" : "#ffffff";
      context.fill();
      var isCurrent = data.current === true;
      context.lineWidth = (isCurrent ? 2 : (isHovered ? 2 : 1)) / zoom;
      context.strokeStyle = isCurrent ? "#ffd66a" : (isHovered ? "#8ab4ff" : (dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)"));
      context.stroke();
      if (dormant) {
        context.fillStyle = dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)";
        context.font = "10px " + GRAPH_FONT_STACK;
        context.fillText(archived ? "已归档" : "子代理 · 已完成", box.x + 12, box.y + box.h - 8);
      } else if (isSubagent) {
        context.fillStyle = "rgba(150,190,255,0.9)";
        context.font = "10px " + GRAPH_FONT_STACK;
        context.fillText("子代理 · 运行中", box.x + 12, box.y + box.h - 8);
      }
      if (data.running === true || data.glow === "running") {
        context.beginPath();
        context.arc(box.x + box.w - 14, box.y + 14, 4, 0, Math.PI * 2);
        context.fillStyle = "#ffffff";
        context.fill();
      } else if (data.waiting === true) {
        context.beginPath();
        context.arc(box.x + box.w - 14, box.y + 14, 4, 0, Math.PI * 2);
        context.fillStyle = "#f5b22e";
        context.fill();
      } else if (data.done === true) {
        context.beginPath();
        context.arc(box.x + box.w - 14, box.y + 14, 4, 0, Math.PI * 2);
        context.fillStyle = "#34c759";
        context.fill();
      }
      if (data.running === true || data.glow === "running") {
        // Travelling light around the card, the canvas version of the CSS ring sweep.
        var phase = (now % 2400) / 2400;
        var perimeter = 2 * (box.w + box.h);
        context.save();
        context.lineWidth = 2 / zoom;
        context.strokeStyle = "rgba(255,255,255,0.92)";
        context.shadowColor = "rgba(255,255,255,0.75)";
        context.shadowBlur = 10 / zoom;
        graphRoundRect(context, box.x - 2, box.y - 2, box.w + 4, box.h + 4, 12);
        context.setLineDash([perimeter * 0.16, perimeter]);
        context.lineDashOffset = -perimeter * phase;
        context.stroke();
        context.restore();
        var pulse = 0.5 + 0.5 * Math.sin(now / 420);
        context.save();
        context.beginPath();
        context.arc(box.x + box.w - 14, box.y + 14, 4, 0, Math.PI * 2);
        context.fillStyle = "#ffffff";
        context.shadowColor = "rgba(255,255,255,0.9)";
        context.shadowBlur = (4 + 10 * pulse) / zoom;
        context.fill();
        context.restore();
      }
      if (!lodBlock) {
        context.fillStyle = dark ? "#e9ebf1" : "#1b1e25";
        context.font = "600 13px " + GRAPH_FONT_STACK;
        context.fillText(graphEllipsis(context, String(data.title === void 0 ? "" : data.title), box.w - 28), box.x + 12, box.y + 26);
        var preview = data.preview === void 0 ? "" : String(data.preview);
        if (preview !== "" && !lod) {
          context.fillStyle = dark ? "rgba(233,235,241,0.60)" : "rgba(27,30,37,0.60)";
          context.font = "12px " + GRAPH_FONT_STACK;
          context.fillText(graphEllipsis(context, preview, box.w - 24), box.x + 12, box.y + 48);
        }
        var activity = mindMapLive.textFor(data.sessionId === void 0 ? "" : data.sessionId);
        if (activity !== "") {
          // 正在执行 = 琥珀、正在思考 = 蓝、正在回复 = 绿；一眼能分清这条会话在干什么。
          context.fillStyle = activity.indexOf("正在执行") === 0 ? "rgba(255,196,110,0.94)" : activity.indexOf("正在思考") === 0 ? "rgba(150,190,255,0.94)" : activity.indexOf("正在分析") === 0 ? "rgba(170,178,196,0.92)" : "rgba(150,235,180,0.94)";
          context.font = "11px " + GRAPH_FONT_STACK;
          context.fillText(graphEllipsis(context, activity, box.w - 24), box.x + 12, box.y + 66);
        }
        var tags = lod || data.tags === void 0 ? [] : data.tags;
        var tagX = box.x + 12;
        context.font = "10px " + GRAPH_FONT_STACK;
        for (var tagIndex = 0; tagIndex < tags.length && tagIndex < 3; tagIndex += 1) {
          var tag = String(tags[tagIndex]);
          var tagWidth = context.measureText(tag).width + 12;
          if (tagX + tagWidth > box.x + box.w - 12) break;
          graphRoundRect(context, tagX, box.y + box.h - 30, tagWidth, 16, 4);
          context.fillStyle = "rgba(90,160,255,0.16)";
          context.fill();
          context.fillStyle = "rgba(140,200,255,0.95)";
          context.fillText(tag, tagX + 6, box.y + box.h - 18);
          tagX += tagWidth + 5;
        }
      }
      context.globalAlpha = 1;
    }
    // Rubber band while shift-dragging out of a card: release over empty canvas
    // and the plugin's own "spawn a session with injected context" dialog opens.
    var fork = forkRef.current;
    if (fork !== null) {
      var forkBox = boxes.get(fork.id);
      if (forkBox !== void 0) {
        var forkStart = graphAnchorPoint(forkBox.x + forkBox.w / 2, forkBox.y + forkBox.h / 2, forkBox.w, forkBox.h, fork.flowX, fork.flowY);
        context.save();
        context.setLineDash([6 / zoom, 5 / zoom]);
        context.lineWidth = 2 / zoom;
        context.strokeStyle = "rgba(120,180,255,0.92)";
        context.beginPath();
        context.moveTo(forkStart.x, forkStart.y);
        context.lineTo(fork.flowX, fork.flowY);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(fork.flowX, fork.flowY, 4 / zoom, 0, Math.PI * 2);
        context.fillStyle = "rgba(120,180,255,0.92)";
        context.fill();
        context.restore();
      }
    }
    context.restore();
  };

  var emitNodeChange = function (id, position, dragging) {
    var handler = propsRef.current.onNodesChange;
    if (typeof handler !== "function") return;
    handler([{ id: id, type: "position", position: position, dragging: dragging }]);
  };

  var hitTest = function (flowX, flowY) {
    var boxes = boxMap();
    var nodes = visibleNodes();
    for (var index = nodes.length - 1; index >= 0; index -= 1) {
      var box = boxes.get(nodes[index].id);
      if (box === void 0) continue;
      if (flowX >= box.x && flowX <= box.x + box.w && flowY >= box.y && flowY <= box.y + box.h) return nodes[index];
    }
    return null;
  };

  var toFlow = function (clientX, clientY) {
    var root = rootRef.current;
    var camera = cameraRef.current;
    if (root === null || camera === null) return { x: 0, y: 0 };
    var rect = root.getBoundingClientRect();
    return { x: (clientX - rect.left - camera.x) / camera.zoom, y: (clientY - rect.top - camera.y) / camera.zoom };
  };

  var onWheel = function (event) {
    event.preventDefault();
    var root = rootRef.current;
    var camera = cameraRef.current;
    if (root === null || camera === null) return;
    var rect = root.getBoundingClientRect();
    var pointerX = event.clientX - rect.left;
    var pointerY = event.clientY - rect.top;
    var factor = Math.exp(-event.deltaY * 0.0015);
    var zoom = Math.max(0.05, Math.min(2.6, camera.zoom * factor));
    var ratio = zoom / camera.zoom;
    cameraRef.current = { x: pointerX - (pointerX - camera.x) * ratio, y: pointerY - (pointerY - camera.y) * ratio, zoom: zoom };
    writeGraphCamera(cameraRef.current);
    schedule();
  };

  var onPointerDown = function (event) {
    if (event.button !== 0) return;
    if (event.target !== null && typeof event.target.closest === "function" && event.target.closest(".tm_canvasCtl") !== null) return;
    var root = rootRef.current;
    if (root === null) return;
    var flow = toFlow(event.clientX, event.clientY);
    var hit = hitTest(flow.x, flow.y);
    hoverRef.current = hit === null ? null : hit.id;
    if (root.setPointerCapture !== void 0) {
      try { root.setPointerCapture(event.pointerId); } catch (error) { }
    }
    if (hit === null) {
      var camera = cameraRef.current;
      dragRef.current = { kind: "pan", startClientX: event.clientX, startClientY: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false, preview: null };
    } else if (event.shiftKey === true) {
      // Shift + drag out of a card is the fork gesture: it never moves the card,
      // it draws a rubber band and hands the release point to the plugin.
      dragRef.current = { kind: "fork", id: hit.id, startClientX: event.clientX, startClientY: event.clientY, moved: false, preview: null };
      forkRef.current = { id: hit.id, flowX: flow.x, flowY: flow.y };
    } else {
      dragRef.current = { kind: "node", id: hit.id, offsetX: flow.x - hit.position.x, offsetY: flow.y - hit.position.y, startClientX: event.clientX, startClientY: event.clientY, moved: false, preview: null };
      // Pressing a card wakes the layout up: neighbours start sliding away
      // before the card has even moved 1 px.
      reheat(0.8);
      emitNodeChange(hit.id, hit.position, true);
    }
    event.preventDefault();
  };

  var onPointerMove = function (event) {
    var drag = dragRef.current;
    if (drag === null) {
      var hoverFlow = toFlow(event.clientX, event.clientY);
      var hoverNode = hitTest(hoverFlow.x, hoverFlow.y);
      var hoverId = hoverNode === null ? null : hoverNode.id;
      if (hoverId !== hoverRef.current) {
        hoverRef.current = hoverId;
        schedule();
      }
      return;
    }
    var deltaX = event.clientX - drag.startClientX;
    var deltaY = event.clientY - drag.startClientY;
    if (drag.kind === "fork") {
      if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) > 6) drag.moved = true;
      var forkPoint = toFlow(event.clientX, event.clientY);
      if (forkRef.current !== null) {
        forkRef.current.flowX = forkPoint.x;
        forkRef.current.flowY = forkPoint.y;
      }
      schedule();
      return;
    }
    if (!drag.moved && Math.abs(deltaX) + Math.abs(deltaY) > 6) {
      drag.moved = true;
      if (drag.kind === "node") emitNodeChange(drag.id, drag.preview === null ? drag.origin : drag.preview, true);
    }
    if (drag.kind === "pan") {
      cameraRef.current = { x: drag.cameraX + deltaX, y: drag.cameraY + deltaY, zoom: cameraRef.current.zoom };
      writeGraphCamera(cameraRef.current);
    } else {
      var flow = toFlow(event.clientX, event.clientY);
      var position = { x: Math.round(flow.x - drag.offsetX), y: Math.round(flow.y - drag.offsetY) };
      drag.preview = position;
      // Keep the heat high while the pointer is down so the rest of the board
      // keeps flowing instead of freezing after the first 300 ms.
      var sim = simRef.current;
      if (sim !== null && sim.alpha < 0.4) sim.alpha = 0.4;
      if (drag.moved) emitNodeChange(drag.id, position, true);
    }
    schedule();
  };

  var onPointerUp = function (event) {
    var drag = dragRef.current;
    dragRef.current = null;
    if (drag === null) return;
    if (drag.kind === "fork") {
      var fork = forkRef.current;
      forkRef.current = null;
      if (drag.moved && fork !== null) {
        var forkPoint = toFlow(event.clientX, event.clientY);
        var bridge = mindMapCanvasBridge.current;
        var landed = hitTest(forkPoint.x, forkPoint.y);
        if (bridge !== null && landed === null && typeof bridge.forkFrom === "function") bridge.forkFrom(drag.id, forkPoint.x, forkPoint.y);
      }
      schedule();
      return;
    }
    if (drag.kind === "node") {
      if (drag.moved) {
        var position = drag.preview !== null ? drag.preview : drag.origin;
        emitNodeChange(drag.id, position, false);
        // Hand the board back to the simulation: the neighbours are still off
        // equilibrium after being pushed around, so let them find it.
        reheat(0.55);
      } else {
        // A plain click: hand it to the plugin's own node-click handler, which
        // knows how to open the session and when not to.
        var node = null;
        var nodes = propsRef.current.nodes || [];
        for (var index = 0; index < nodes.length; index += 1) if (nodes[index].id === drag.id) node = nodes[index];
        if (node !== null && typeof propsRef.current.onNodeClick === "function") {
          propsRef.current.onNodeClick(event, node);
        }
      }
    } else {
      var handler = propsRef.current.onMoveEnd;
      if (typeof handler === "function") handler(null, cameraRef.current);
    }
    schedule();
  };

  var zoomBy = function (factor) {
    var root = rootRef.current;
    var camera = cameraRef.current;
    if (root === null || camera === null) return;
    var centerX = root.clientWidth / 2;
    var centerY = root.clientHeight / 2;
    var zoom = Math.max(0.05, Math.min(2.6, camera.zoom * factor));
    var ratio = zoom / camera.zoom;
    cameraRef.current = { x: centerX - (centerX - camera.x) * ratio, y: centerY - (centerY - camera.y) * ratio, zoom: zoom };
    writeGraphCamera(cameraRef.current);
    schedule();
  };

  react.useEffect(function () {
    var root = rootRef.current;
    if (root === null) return;
    var observer = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(function () { schedule(); });
      observer.observe(root);
    }
    // React attaches wheel listeners as passive, where preventDefault() throws;
    // register a native non-passive one so the canvas can own the zoom gesture.
    var wheelHandler = function (event) {
      event.preventDefault();
      var target = rootRef.current;
      var camera = cameraRef.current;
      if (target === null || camera === null) return;
      var rect = target.getBoundingClientRect();
      var pointerX = event.clientX - rect.left;
      var pointerY = event.clientY - rect.top;
      var factor = Math.exp(-event.deltaY * 0.0015);
      var zoom = Math.max(0.05, Math.min(2.6, camera.zoom * factor));
      var ratio = zoom / camera.zoom;
      cameraRef.current = { x: pointerX - (pointerX - camera.x) * ratio, y: pointerY - (pointerY - camera.y) * ratio, zoom: zoom };
      writeGraphCamera(cameraRef.current);
      schedule();
    };
    root.addEventListener("wheel", wheelHandler, { passive: false });
    // The frame loop does three jobs in priority order: advance the force
    // simulation, advance the camera tween, otherwise repaint only while a
    // session is actually running. Everything is driven from one rAF so an idle
    // map still costs zero.
    var animationFrame = 0;
    var animationTick = 0;
    var animate = function () {
      animationFrame = window.requestAnimationFrame(animate);
      animationTick += 1;
      var now = typeof performance !== "undefined" ? performance.now() : Date.now();
      var sim = simRef.current;
      var simRunning = sim !== null && sim.alpha > simSettings.alphaMin;
      if (simRunning) tickSim();
      var tweening = stepTween(now);
      if (simRunning || tweening) {
        drawRef.current();
        if (simRunning && simRef.current !== null && simRef.current.alpha <= simSettings.alphaMin) commitSim();
        return;
      }
      if (animationTick % 2 !== 0) return;
      var nodes = propsRef.current.nodes || [];
      for (var index = 0; index < nodes.length; index += 1) {
        var node = nodes[index];
        if (node.hidden !== true && node.data !== void 0 && node.data.running === true) {
          drawRef.current();
          return;
        }
      }
    };
    // Deliberately does NOT call ensureSim here: the store write that triggered
    // this may not have re-rendered yet, and re-seeding from the old props would
    // throw the new layout away. The next tick re-seeds from the fresh props.
    var offLive = mindMapLive.subscribe(function () { schedule(); });
    mindMapFitKick.fn = function () { pendingFitRef.current = true; reheat(1); schedule(); };
    mindMapSimKick.fn = function () {
      reseedRef.current = true;
      var sim = simRef.current;
      if (sim === null) { sim = { nodes: new Map(), alpha: 0 }; simRef.current = sim; }
      sim.alpha = 1;
      schedule();
    };
    mindMapCanvasToFlow.fn = function (clientX, clientY) { return toFlow(clientX, clientY); };
    // Read-only introspection for the verification scripts (alpha, node count,
    // committed positions); nothing in the UI reads it.
    window.__mindMapDebug = {
      alpha: function () { var sim = simRef.current; return sim === null ? null : sim.alpha; },
      size: function () { var sim = simRef.current; return sim === null ? 0 : sim.nodes.size; },
      nodes: function () { var sim = simRef.current; var out = {}; if (sim !== null) sim.nodes.forEach(function (value, key) { out[key] = { x: Math.round(value.x), y: Math.round(value.y), vx: value.vx, vy: value.vy }; }); return out; },
      reheat: function () { reheat(1); },
      draws: function () { return mindMapDrawCount; },
      // Live force tuning: mutate these from the console to feel the difference
      // without a rebuild, e.g. __mindMapDebug.settings.velocityDecay = 0.55
      settings: simSettings
    };
    animationFrame = window.requestAnimationFrame(animate);
    if (cameraRef.current === null) fitRef.current();
    schedule();
    return function () {
      root.removeEventListener("wheel", wheelHandler);
      if (typeof offLive === "function") offLive();
      mindMapSimKick.fn = null;
      mindMapFitKick.fn = null;
      mindMapCanvasToFlow.fn = null;
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      if (observer !== null) observer.disconnect();
      if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, []);

  var signatureRef = react.useRef("");
  var laidSignatureRef = react.useRef("");
  react.useEffect(function () {
    var nodes = props.nodes || [];
    var ids = [];
    for (var index = 0; index < nodes.length; index += 1) if (nodes[index].hidden !== true) ids.push(nodes[index].id);
    ids.sort();
    var signature = ids.join(",");
    var laidSignature = "";
    try { laidSignature = window.localStorage.getItem(MIND_MAP_LAID_SIG_KEY) || ""; } catch (error) { laidSignature = ""; }
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      laidSignatureRef.current = signature;
      if (signature !== laidSignature) {
        // A different set of cards is in play (focus switched, a card appeared):
        // re-seed from the store, heat the layout up and ease the camera onto the
        // new bounding box instead of snapping.
        simRef.current = null;
        reheat(1);
        fitRef.current({ ease: cameraRef.current !== null });
      } else {
        // 成员和上次收敛时一模一样：只可能是面板重挂（切对话/切 tab）——
        // 保持原样，不重跑布局也不动镜头，图看起来就没变。
        schedule();
      }
    } else {
      schedule();
    }
  }, [props.nodes, props.edges, props.colorMode]);

  return (0, import_jsx_runtime16.jsxs)("div", {
    className: "tm_graphSurface",
    ref: rootRef,
    onPointerDown: onPointerDown,
    onPointerMove: onPointerMove,
    onPointerUp: onPointerUp,
    onPointerCancel: onPointerUp,
    onPointerLeave: function () {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        schedule();
      }
    },
    onDoubleClick: function (event) {
      event.stopPropagation();
      var flow = toFlow(event.clientX, event.clientY);
      var bridge = mindMapCanvasBridge.current;
      if (bridge !== null && hitTest(flow.x, flow.y) === null && typeof bridge.startSessionAt === "function") bridge.startSessionAt(flow.x, flow.y);
    },
    onContextMenu: function (event) {
      event.preventDefault();
      var bridge = mindMapCanvasBridge.current;
      if (bridge === null) return;
      var flow = toFlow(event.clientX, event.clientY);
      var node = hitTest(flow.x, flow.y);
      var fake = { clientX: event.clientX, clientY: event.clientY, preventDefault: function () { }, stopPropagation: function () { } };
      if (node === null) { if (typeof bridge.openPaneMenu === "function") bridge.openPaneMenu(fake); }
      else if (typeof bridge.openCardMenu === "function") bridge.openCardMenu(fake, node.id);
    },
    children: [
      (0, import_jsx_runtime16.jsx)("canvas", { ref: canvasRef, className: "tm_graphCanvas" }),
      (0, import_jsx_runtime16.jsxs)("div", { className: "tm_canvasCtl", children: [
        (0, import_jsx_runtime16.jsx)("button", { type: "button", title: "放大", onClick: function () { zoomBy(1.25); }, children: "+" }),
        (0, import_jsx_runtime16.jsx)("button", { type: "button", title: "缩小", onClick: function () { zoomBy(0.8); }, children: "−" }),
        (0, import_jsx_runtime16.jsx)("button", { type: "button", title: "适配视图", onClick: function () { fitRef.current(); }, children: "⤢" })
      ] })
    ]
  });
}
/** Switches the renderer: canvas in graph mode, React Flow in whiteboard mode.
 * Both receive the exact same props object. */
function GraphSurface(props) {
  var graphOn = (0, import_react13.useSyncExternalStore)(graphModeSubscribe, graphModeGet, graphModeGet);
  if (graphOn) return (0, import_jsx_runtime16.jsx)(GraphCanvasSurface, props);
  return (0, import_jsx_runtime16.jsx)(index, props);
}
function GraphBar(props) {
  const graphOn = (0, import_react13.useSyncExternalStore)(graphModeSubscribe, graphModeGet, graphModeGet);
  const children = [];
  children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
    type: "button",
    className: "tm_graphBtn" + (graphOn ? " tm_graphBtnActive" : ""),
    title: graphOn ? "切回白板（槽位平铺）视图" : "切换到图谱视图：节点按关系连线、自动排布、可拖动",
    onClick: function () { graphModeSet(!graphOn); },
    children: graphOn ? "🕸 图谱" : "▦ 白板"
  }, "mode"));
  if (graphOn) {
    children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
      type: "button",
      className: "tm_graphBtn" + (props.focusOn === true ? " tm_graphBtnActive" : ""),
      title: "只显示当前会话和与它相关（连在一起）的对话；点卡片打开会话后，聚焦会跟过去",
      onClick: props.onToggleFocus,
      children: props.focusOn === true ? "🎯 聚焦 " + props.focusCount : "🎯 聚焦"
    }, "focus"));
    children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("button", {
      type: "button",
      className: "tm_graphBtn",
      title: "按连线关系重新做力导向排布（拖动过的卡片也会重新排）",
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
      title: "隐藏已归档会话和已跑完的子代理（子代理跑完会灰化，和归档一样藏起来）；开合状态记在浏览器里",
      onClick: props.onToggleHideArchived,
      children: props.hideArchived === true ? "🗄 已隐藏 " + (props.archivedCount > 0 ? props.archivedCount : "0") : "🗄 显示全部"
    }, "archived"));
    if (props.tagCount > 0) children.push(/* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", {
      className: "tm_graphHint",
      children: props.tagCount + " 个标签"
    }, "count"));
  }
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "tm_graphBar", role: "toolbar", children: children });
}
/* ---- 侧栏席位：把同一张地图挂进 dsh-better-sidebar 的一栏 ---------------
 * 壳给 slot 组件的标准 props（useSessions / useWorkspaces / useSessionStatus）
 * 在侧栏 tab 里拿不到，所以这里用同一批 store 自己造一份选择器 hook：
 * sessions 用 ctx.sessions.list，workspaces 用 ctx.workspaces.list，
 * sessionStatus 用 slots._rootBinding.hooks.sessionStatus（拿不到就省略，
 * 地图会退化成用列表行自带的字段）。 */
var mindMapSidebarSeat = { service: null, mounted: false };
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
/** 开那一栏；没有当前会话时返回 false（better-sidebar 的 tab 必须挂在会话上）。 */
function mindMapOpenSidebarTab(service) {
  if (service === null || service === void 0 || typeof service.openTab !== "function") return false;
  try {
    var snap = typeof service.getSnapshot === "function" ? service.getSnapshot() : null;
    if (snap === null || snap === void 0 || snap.sessionId === void 0) return false;
    service.openTab({ type: "mind_map:map", title: t("map.title") });
    return true;
  } catch (error) {
    return false;
  }
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
function MapSidebarTab(tabProps) {
  var standard = mindMapSidebarProps();
  var ui = import_react13.useSyncExternalStore(mapUi.subscribe, mapUi.get, mapUi.get);
  // 挂载即说明这一栏真的开出来了：自动恢复的轮询凭这个信号停止。
  import_react13.useEffect(function () {
    mindMapSidebarSeat.mounted = true;
    return function () { mindMapSidebarSeat.mounted = false; };
  }, []);
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

const GRAPH_SIDEBAR_CSS = String.raw` .tm_sbPanel { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 6px; } .tm_sbPanel > :last-child { flex: 1 1 0; min-height: 0; } .tm_sbBar { display: flex; align-items: center; gap: 8px; padding: 2px 2px 6px; } .tm_sbTitle { font-size: calc(12px + var(--tm-font-step, 0px)); font-weight: 600; color: var(--dsw-alias-label-primary); } .tm_sbBar .tm_sbFull { margin-left: auto; } .tm_sbNote { display: flex; align-items: center; justify-content: center; height: 100%; padding: 16px; font-size: calc(12px + var(--tm-font-step, 0px)); color: var(--dsw-alias-label-tertiary); text-align: center; }
`;
const GRAPH_EDGES_BLOCK = String.raw`    if (graphOn) {
      // Hidden archived cards are out of the graph entirely, so the chains are
      // rebuilt between the cards that are actually on screen: hiding a card
      // must re-link its two neighbours, not cut the chain in half.
      const graphCardIds = Object.keys(visibleCards).filter(function (cardId) {
        if (foldedSet.has(cardId)) return false;
        if (hideArchivedOn && archivedSessionSet.has(visibleCards[cardId].sessionId)) return false;
        var chainRow = sessions.byId[visibleCards[cardId].sessionId];
        if (hideArchivedOn && chainRow !== void 0 && chainRow.origin === "subagent" && chainRow.running !== true) return false;
        return true;
      });
      // 不再去重：同一对卡片可能既是同工作区又是同标签，两种关系各画一条。
      // 这样「链式」也不会再让中间的卡把两端的连线挡掉。
      const pushGraphEdge = function (fromCardId, toCardId, tag, idTag) {
        if (fromCardId === toCardId) return;
        // id 里带上关系本身（标签名），两个标签共享同一对时是两条独立的边而不是重复 id。
        out.push({
          id: "graph-" + tag + "-" + (idTag === void 0 ? "" : idTag + "-") + fromCardId + "-" + toCardId,
          source: fromCardId,
          target: toCardId,
          // No handles: the renderer intersects the centre line with each
          // card's rectangle, so the line always leaves from the side that
          // faces the other node and re-routes live while dragging.
          type: "graphLine",
          selectable: false,
          data: {
            fromCardId: fromCardId,
            toCardId: toCardId,
            sync: "idle",
            structural: true,
            graph: true,
            graphKind: tag,
            ready: boardTick > 0
          },
          style: { stroke: "rgba(198, 206, 220, 0.34)", strokeWidth: 1.1 }
        });
      };
      const byWorkspace = new Map();
      for (const cardId of graphCardIds) {
        const card = visibleCards[cardId];
        if (card === void 0) continue;
        const groupId = sessionWs.get(card.sessionId);
        if (groupId === void 0) continue;
        if (!byWorkspace.has(groupId)) byWorkspace.set(groupId, []);
        byWorkspace.get(groupId).push(cardId);
      }
      for (const members of byWorkspace.values()) {
        members.sort(function (left, right) {
          const leftSession = sessions.byId[visibleCards[left].sessionId];
          const rightSession = sessions.byId[visibleCards[right].sessionId];
          return (leftSession === void 0 ? 0 : leftSession.updatedAt || 0) - (rightSession === void 0 ? 0 : rightSession.updatedAt || 0);
        });
        // 同组任意两点都连（组内全连接），不是只连成一条链。
        for (let left = 0; left < members.length; left += 1) {
          for (let right = left + 1; right < members.length; right += 1) pushGraphEdge(members[left], members[right], "ws");
        }
      }
      for (const group of graphTagGroups) {
        const members = group[1].filter(function (cardId) { return !foldedSet.has(cardId); });
        if (members.length < 2) continue;
        for (let left = 0; left < members.length; left += 1) {
          for (let right = left + 1; right < members.length; right += 1) pushGraphEdge(members[left], members[right], "tag", group[0]);
        }
      }
    }
`;

const AUTO_LAYOUT_BLOCK = String.raw`  const graphCardIds = Object.keys(visibleCards).sort();
  const graphCardSig = graphCardIds.join(",");
  const relayoutGraph = () => {
    const entries = Object.entries(visibleCards).map(function (entry) { return { id: entry[0], x: entry[1].x, y: entry[1].y }; });
    if (entries.length === 0) return;
    const links = [];
    for (const drawn of liveEdges) links.push([drawn.source, drawn.target]);
    const placed = graphLayoutForce(entries, links, { width: CARD_W, height: CARD_H });
    const points = {};
    for (const cardId of Object.keys(placed)) points[cardId] = { x: snap(placed[cardId].x), y: snap(placed[cardId].y) };
    canvas.moveCards(points);
    // The canvas keeps its own simulation: hand the new coordinates over and
    // heat it back up, otherwise the button would only move the cards on paper.
    if (mindMapSimKick !== null && typeof mindMapSimKick.fn === "function") mindMapSimKick.fn();
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
        const radius = step === 0 ? 0 : 48 + step * 13;
        const angle = step * 0.55;
        const pointX = Math.round(centerX + Math.cos(angle) * radius);
        const pointY = Math.round(centerY + Math.sin(angle) * radius);
        let free = true;
        for (const box of occupied) {
          if (Math.abs(box.x - pointX) < CARD_W + 32 && Math.abs(box.y - pointY) < CARD_H + 28) { free = false; break; }
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
  const archivedCardCount = (0, import_react13.useMemo)(() => {
    let count = 0;
    for (const cardId of Object.keys(visibleCards)) {
      const row = sessions.byId[visibleCards[cardId].sessionId];
      if (archivedSessionSet.has(visibleCards[cardId].sessionId)) { count += 1; continue; }
      // 已跑完的子代理和归档一样会被这个开关藏起来，所以一起计数。
      if (row !== void 0 && row.origin === "subagent" && row.running !== true) count += 1;
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
      if (hideArchivedOn && tagRow !== void 0 && tagRow.origin === "subagent" && tagRow.running !== true) continue;
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
    replace: "batchMode, batchPicks, locale, graphOn, graphTagIndex, hideArchivedOn, archivedSessionSet]);"
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
    label: "focus-hook",
    find: "  const graphOn = (0, import_react13.useSyncExternalStore)(graphModeSubscribe, graphModeGet, graphModeGet);\n  const [tagBusy, setTagBusy] = (0, import_react13.useState)(false);",
    replace: "  const graphOn = (0, import_react13.useSyncExternalStore)(graphModeSubscribe, graphModeGet, graphModeGet);\n  const focusOn = (0, import_react13.useSyncExternalStore)(focusModeSubscribe, focusModeGet, focusModeGet);\n  const focusAnchorRef = (0, import_react13.useRef)(null);\n  const [tagBusy, setTagBusy] = (0, import_react13.useState)(false);"
  },
  {
    label: "focus-set",
    find: "    return out;\n  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch, lineageHidden, liveNodes, boardTick, graphOn, graphTagGroups, hideArchivedOn, archivedSessionSet]);",
    replace: "    return out;\n  }, [visibleCards, canvasState.edges, sessions, sessionIdToCardId, liveSelectedEdgeIds, foldedSet, locale, pushEpoch, lineageHidden, liveNodes, boardTick, graphOn, graphTagGroups, hideArchivedOn, archivedSessionSet]);\n" +
      String.raw`  // Focus view: keep only the session you are working in plus everything linked
  // to it (fork lineage, same workspace, shared tag, manual links) within
  // FOCUS_DEPTH hops. Null means "no filtering".
  const focusSet = (0, import_react13.useMemo)(() => {
    if (!focusOn) { focusAnchorRef.current = null; return null; }
    // 锚点钉住：优先用上次锚定的卡（切换对话时不再换中心），板上没有它了才退化成
    // 「当前会话 → 最近更新的卡」并重新钉住。
    const pinnedAnchor = mindMapFocusAnchorGet();
    let anchorCardId = pinnedAnchor !== null && visibleCards[pinnedAnchor] !== void 0 ? pinnedAnchor : void 0;
    if (anchorCardId === void 0) {
      const anchorSession = currentSessionId();
      anchorCardId = anchorSession === void 0 ? void 0 : sessionIdToCardId.get(anchorSession);
    }
    if (anchorCardId === void 0) {
      let newest;
      for (const entry of Object.entries(visibleCards)) {
        const stamp = sessions.byId[entry[1].sessionId]?.updatedAt ?? 0;
        if (newest === void 0 || stamp > newest.stamp) newest = { cardId: entry[0], stamp: stamp };
      }
      anchorCardId = newest === void 0 ? void 0 : newest.cardId;
    }
    focusAnchorRef.current = anchorCardId === void 0 ? null : anchorCardId;
    if (anchorCardId !== void 0) mindMapFocusAnchorSet(anchorCardId);
    if (anchorCardId === void 0) return null;
    const adjacency = new Map();
    const connect = function (left, right) {
      if (!adjacency.has(left)) adjacency.set(left, []);
      adjacency.get(left).push(right);
    };
    for (const drawn of liveEdges) { connect(drawn.source, drawn.target); connect(drawn.target, drawn.source); }
    const keep = new Map([[anchorCardId, 0]]);
    let frontier = [anchorCardId];
    for (let depth = 0; depth < FOCUS_DEPTH; depth += 1) {
      const next = [];
      for (const cardId of frontier) {
        for (const neighbour of adjacency.get(cardId) ?? []) {
          if (keep.has(neighbour)) continue;
          keep.set(neighbour, depth + 1);
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    return keep;
  }, [focusOn, liveEdges, visibleCards, sessions, sessionIdToCardId]);
  const focusEdges = focusSet === null ? liveEdges : liveEdges.filter(function (drawn) { return focusSet.has(drawn.source) && focusSet.has(drawn.target); });
  // First ring stays a readable card; everything further out collapses to a dot
  // you can hover for the details (hundreds of full cards at once is what made
  // the graph heavy in the first place).
  const focusNodes = focusSet === null ? liveNodes : liveNodes.map(function (node) {
    if (node.type !== "sessionCard") return node;
    const depth = focusSet.get(node.id);
    if (depth === void 0) return { ...node, hidden: true };
    if (depth < 2) return node;
    return {
      ...node,
      type: "sessionDot",
      position: { x: node.position.x + (CARD_W - DOT_SIZE) / 2, y: node.position.y + (CARD_H - DOT_SIZE) / 2 },
      data: { ...node.data, depth: depth, onHover: handleDotHover }
    };
  });
  const focusCount = focusSet === null ? 0 : focusSet.size;`
  },
  {
    label: "focus-nodes-edges",
    find: "  const nodes = isSelecting && frozenRef.current !== null ? frozenRef.current.nodes : liveNodes;\n  const edges = isSelecting && frozenRef.current !== null ? frozenRef.current.edges : liveEdges;",
    replace: "  const nodes = isSelecting && frozenRef.current !== null ? frozenRef.current.nodes : focusNodes;\n  const edges = isSelecting && frozenRef.current !== null ? frozenRef.current.edges : focusEdges;"
  },
  {
    label: "focus-center",
    find: "  const savedCamera = canvas.savedCamera(INBOX_BOARD_ID);",
    replace: String.raw`  (0, import_react13.useEffect)(() => {
    if (!focusOn || focusSet === null) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cardId of focusSet.keys()) {
      const card = visibleCards[cardId];
      if (card === void 0) continue;
      minX = Math.min(minX, card.x);
      minY = Math.min(minY, card.y);
      maxX = Math.max(maxX, card.x + CARD_W);
      maxY = Math.max(maxY, card.y + CARD_H);
    }
    if (!Number.isFinite(minX)) return;
    const root = wrapperRef.current;
    const viewWidth = root === null ? 900 : Math.max(240, root.clientWidth - 96);
    const viewHeight = root === null ? 700 : Math.max(200, root.clientHeight - 150);
    const spanX = Math.max(CARD_W, maxX - minX);
    const spanY = Math.max(CARD_H, maxY - minY);
    const zoom = Math.max(0.25, Math.min(0.92, Math.min(viewWidth / spanX, viewHeight / spanY)));
    const timer = window.setTimeout(function () {
      setCenter((minX + maxX) / 2, (minY + maxY) / 2, { zoom: zoom, duration: 320 });
    }, 160);
    return function () { window.clearTimeout(timer); };
  }, [focusOn, focusSet]);
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
    replace: "        hidden: foldedSet.has(cardId) || (graphOn && hideArchivedOn && (archivedSessionSet.has(card.sessionId) || (summary !== void 0 && summary.origin === \"subagent\" && summary.running !== true))),\n        className: dragging ? \"tmDragging\" : \"\"\n      };\n      return graphStableNode(nodeCacheRef.current, cardId, node);\n    });\n    for (const cachedId of nodeCacheRef.current.keys()) if (visibleCards[cachedId] === void 0) nodeCacheRef.current.delete(cachedId);"
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
    label: "relayout-respects-focus",
    find: "    const entries = Object.entries(visibleCards).map(function (entry) { return { id: entry[0], x: entry[1].x, y: entry[1].y }; });",
    replace: "    const entries = Object.entries(visibleCards).filter(function (entry) { return focusSet === null || focusSet.has(entry[0]); }).map(function (entry) { return { id: entry[0], x: entry[1].x, y: entry[1].y }; });"
  },
  {
    label: "relayout-links-respect-focus",
    find: "    for (const drawn of liveEdges) links.push([drawn.source, drawn.target]);",
    replace: "    for (const drawn of focusEdges) links.push([drawn.source, drawn.target]);"
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
    label: "no-dots",
    find: "  const focusNodes = focusSet === null ? liveNodes : liveNodes.map(function (node) {\n    if (node.type !== \"sessionCard\") return node;\n    const depth = focusSet.get(node.id);\n    if (depth === void 0) return { ...node, hidden: true };\n    if (depth < 2) return node;\n    return {\n      ...node,\n      type: \"sessionDot\",\n      position: { x: node.position.x + (CARD_W - DOT_SIZE) / 2, y: node.position.y + (CARD_H - DOT_SIZE) / 2 },\n      data: { ...node.data, depth: depth, onHover: handleDotHover }\n    };\n  });",
    replace: "  const focusNodes = focusSet === null ? liveNodes : liveNodes.map(function (node) {\n    if (node.type !== \"sessionCard\") return node;\n    if (!focusSet.has(node.id)) return { ...node, hidden: true };\n    return node;\n  });"
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
      "    // 侧栏席位。两个不确定点都要兜住：\n" +
      "    //  1) 启动时 betterSidebar 可能还没注册 —— 以前直接 return，那一窗就永远没有这个 tab\n" +
      "    //     （用户看到的「重启后右侧又没有思维图」就是它）。现在每 500ms 重试，最多 60 次。\n" +
      "    //  2) better-sidebar 只按会话记已开的 tab，冷启动不回填 —— 拿到服务后自己轮询 openTab，\n" +
      "    //     直到 tab 真的挂载（MapSidebarTab 的 effect 置 mounted）为止。\n" +
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
      "        // 启动即尝试把那一栏开出来（不再看「上次关没关」的偏好：重启后就是要回来）。\n" +
      "        var seatAttempts = 0;\n" +
      "        var seatTimer = window.setInterval(function () {\n" +
      "          seatAttempts += 1;\n" +
      "          if (mindMapSidebarSeat.mounted === true || seatAttempts > 20) {\n" +
      "            window.clearInterval(seatTimer);\n" +
      "            seatTimer = 0;\n" +
      "            return;\n" +
      "          }\n" +
      "          mindMapOpenSidebarTab(better);\n" +
      "        }, 1200);\n" +
      "        mindMapOpenSidebarTab(better);\n" +
      "        return true;\n" +
      "      };\n" +
      "      var acquireTimer = window.setInterval(function () {\n" +
      "        tries += 1;\n" +
      "        if (tryAcquire() === true || tries > 60) {\n" +
      "          window.clearInterval(acquireTimer);\n" +
      "          acquireTimer = 0;\n" +
      "        }\n" +
      "      }, 500);\n" +
      "      tryAcquire();\n" +
      "      // 切换对话时也把这一栏开出来：tab 在 better-sidebar 里是按会话存的，切过去\n" +
      "      // 就没有「已开」记录了。这里盯 sessionId 变化补开一次，配合「锚点钉住 +\n" +
      "      // 成员没变不重排」，看到的就始终是同一张图。\n" +
      "      var lastSeatSession = null;\n" +
      "      var ensureSeat = function () {\n" +
      "        var service = mindMapSidebarSeat.service;\n" +
      "        if (service === null || service === void 0 || typeof service.getSnapshot !== \"function\") return;\n" +
      "        var snap = null;\n" +
      "        try { snap = service.getSnapshot(); } catch (error) { return; }\n" +
      "        var sessionId = snap === null || snap === void 0 ? void 0 : snap.sessionId;\n" +
      "        if (sessionId === void 0 || sessionId === lastSeatSession) return;\n" +
      "        lastSeatSession = sessionId;\n" +
      "        var attempts = 0;\n" +
      "        var timer = window.setInterval(function () {\n" +
      "          attempts += 1;\n" +
      "          if (mindMapOpenSidebarTab(service) === true || attempts > 12) {\n" +
      "            window.clearInterval(timer);\n" +
      "            timer = 0;\n" +
      "          }\n" +
      "        }, 300);\n" +
      "      };\n" +
      "      var attachSessionWatch = function () {\n" +
      "        var service = mindMapSidebarSeat.service;\n" +
      "        if (service === null || service === void 0) return false;\n" +
      "        try {\n" +
      "          if (typeof service.subscribeState === \"function\") service.subscribeState(ensureSeat);\n" +
      "          else if (typeof service.subscribe === \"function\") service.subscribe(ensureSeat);\n" +
      "          else return false;\n" +
      "        } catch (error) { return false; }\n" +
      "        ensureSeat();\n" +
      "        return true;\n" +
      "      };\n" +
      "      attachSessionWatch();\n" +
      "      // 兜底：即便 subscribeState 不在会话切换时通知，也每 2 秒对一次 sessionId。\n" +
      "      window.setInterval(ensureSeat, 2000);\n" +
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
      if (boardSessionIds.has(sessionId) || subagentPlacedRef.current.has(sessionId)) continue;
      subagentPlacedRef.current.add(sessionId);
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
