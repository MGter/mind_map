/**
 * Probe rewrite for the LOCAL search:
 *  - drop every check that assumed a corpus query (network, skeleton, peek,
 *    roles, disabled index, cwd scope, refetching…)
 *  - add a compact block that proves both searches now filter rendered cards
 *    and highlight the match.
 */
import fs from 'node:fs'

const probe = 'test/probe.mjs'
let lines = fs.readFileSync(probe, 'utf8').split('\n')

const DROP = [
  '按标题筛选抽屉里的对话',
  '抽屉搜索只搜本工作区',
  '唤起了宿主全文搜索',
  '显示全部对话里的内容命中',
  '命中项带出处片段',
  '一个会话只占一个栏目',
  '每条对话的全部命中自动补上',
  '搜索时出现加载动画',
  '结果里的搜索词高亮',
  '标注是「你」还是「AI」',
  '片段的 Markdown 被渲染',
  '悬停后弹出框显示更多上下文',
  '弹出框里也高亮搜索词',
  '移开鼠标后弹出框消失',
  '两条通道都失败时显示真实原因',
  '索引被部署关掉时给出明确说明',
  '重新打开抽屉时保留上次的搜索',
  '重开抽屉不再重新拉取',
  '回车后弹出全局搜索面板并列出结果',
  '全局搜索不带工作区限定',
  '搜索能按会话标题命中',
  '打字不触发搜索',
]

/** Remove one `check('label', …)` statement, however many lines it spans. */
function dropCheck(source, label) {
  const out = []
  let index = 0
  while (index < source.length) {
    const line = source[index]
    if (line.includes(`check('${label}`) || line.includes(`check(\`${label}`)) {
      // consume until the statement's parens balance
      let depth = 0
      let started = false
      let cursor = index
      for (; cursor < source.length; cursor += 1) {
        for (const char of source[cursor]) {
          if (char === '(') { depth += 1; started = true }
          if (char === ')') depth -= 1
        }
        if (started && depth <= 0) break
      }
      index = cursor + 1
      continue
    }
    out.push(line)
    index += 1
  }
  return out
}

for (const label of DROP) lines = dropCheck(lines, label)

let source = lines.join('\n')

// insert the new local-search block right after the drawer's search box check
const anchor = "check('抽屉里有搜索框'"
const at = source.indexOf(anchor)
if (at < 0) {
  console.error('anchor not found')
  process.exit(1)
}
let paren = 0
let started = false
let cursor = at
for (; cursor < source.length; cursor += 1) {
  const char = source[cursor]
  if (char === '(') { paren += 1; started = true }
  if (char === ')') paren -= 1
  if (started && paren <= 0) break
}
const insertAt = source.indexOf('\n', cursor) + 1

const block = `
  // The search is LOCAL now: it filters the rows this folder is rendering.
  const routeCallsBeforeSearch = await page.evaluate(() => window.__harness.searchRouteCalls().length)
  await page.fill('[data-mindmap-drawer-search]', '清理')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const localHits = await page.evaluate(() => ({
    hits: document.querySelectorAll('[data-mindmap-search-hit]').length,
    text: document.querySelector('[data-mindmap-search-hit]')?.textContent ?? null,
    marks: document.querySelectorAll('[data-mindmap-search-hit] mark').length,
    routeCalls: window.__harness.searchRouteCalls().length,
  }))
  check('抽屉搜索命中卡片正文（不查宿主语料）',
    localHits.hits >= 1 && (localHits.text ?? '').includes('清理')
      && localHits.routeCalls === routeCallsBeforeSearch,
    JSON.stringify(localHits))
  check('命中处有高亮', localHits.marks >= 1, JSON.stringify(localHits))

  // Header search: same idea, over the cards on the board.
  await page.fill('[data-mindmap-global-search]', '网格')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const globalLocal = await page.evaluate(() => ({
    panel: document.querySelector('[class*="globalSearchPanel"]') !== null,
    hits: document.querySelectorAll('[data-mindmap-search-hit]').length,
    marks: document.querySelectorAll('[data-mindmap-search-hit] mark').length,
    routeCalls: window.__harness.searchRouteCalls().length,
  }))
  check('顶栏搜索也只在地图上的卡片里找',
    globalLocal.panel === true && globalLocal.hits >= 1
      && globalLocal.routeCalls === routeCallsBeforeSearch,
    JSON.stringify(globalLocal))
  check('顶栏搜索结果同样高亮', globalLocal.marks >= 1, JSON.stringify(globalLocal))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
`

source = source.slice(0, insertAt) + block + source.slice(insertAt)
fs.writeFileSync(probe, source, 'utf8')
console.log('probe rewritten for local search')
