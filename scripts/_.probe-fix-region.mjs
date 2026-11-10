/** Rewrite the mangled probe region (grouping + auto-hits + loading). */
import fs from 'node:fs'

const probe = 'test/probe.mjs'
const lines = fs.readFileSync(probe, 'utf8').split('\n')

// region: from the stray duplicate check line to just before "结果里的搜索词高亮"
const start = 1289 // 0-based index of line 1290
const endMarker = "    check('结果里的搜索词高亮', groupedHits.marks >= 1"
let end = lines.findIndex(line => line.includes(endMarker))
if (end < 0) {
  console.error('end marker missing')
  process.exit(1)
}

const block = [
  "    check('一个会话只占一个栏目', groupedHits.blocks === 2, JSON.stringify(groupedHits))",
  '    // Every match of a conversation arrives on its own — no button to press.',
  '    await page.waitForTimeout(800)',
  '    const autoHits = await page.evaluate(() => ({',
  "      lines: document.querySelectorAll('[data-mindmap-search-hit] [data-mindmap-search-line]').length,",
  "      buttons: document.querySelectorAll('[data-mindmap-search-more]').length,",
  '      sessionCalls: window.__harness.searchSessionCalls().length,',
  '    }))',
  "    check('每条对话的全部命中自动补上（不再有按钮）',",
  '      autoHits.buttons === 0 && autoHits.lines >= 3 && autoHits.sessionCalls >= 1,',
  '      JSON.stringify(autoHits))',
  '    // Loading state: a thin bar + placeholder rows while the corpus query runs.',
  '    await page.evaluate(() => window.__harness.slowSearch(600))',
  "    await page.fill('[data-mindmap-drawer-search]', '物理加载测试')",
  "    await page.keyboard.press('Enter')",
  '    await page.waitForTimeout(220)',
  '    const loadingVisible = await page.evaluate(() => ({',
  "      bar: document.querySelector('[data-mindmap-search-loading]') !== null,",
  '      skeleton: document.querySelectorAll(\'[class*="searchSkeletonRow"]\').length,',
  '    }))',
  "    check('搜索时出现加载动画（细进度条 + 骨架行）',",
  '      loadingVisible.bar === true && loadingVisible.skeleton >= 1, JSON.stringify(loadingVisible))',
  '    await page.waitForTimeout(900)',
  '    await page.evaluate(() => window.__harness.slowSearch(0))',
  '    // Back to the plain query the hover checks below rely on.',
  "    await page.fill('[data-mindmap-drawer-search]', '物理')",
  "    await page.keyboard.press('Enter')",
  '    await page.waitForTimeout(800)',
]

const next = [...lines.slice(0, start), ...block, ...lines.slice(end)]
fs.writeFileSync(probe, next.join('\n'), 'utf8')
console.log(`rewrote lines ${start + 1}..${end}`)
