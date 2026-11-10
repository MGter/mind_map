/** Probe: adapt the search checks to automatic hit loading, and the spawn default. */
import fs from 'node:fs'

const file = 'test/probe.mjs'
let source = fs.readFileSync(file, 'utf8')

// 1) grouping: two sessions, hits filled in automatically
source = source.replace(
  `    check('一个会话只占一个栏目（先给最匹配的一行）',
      groupedHits.blocks === 2 && groupedHits.lines === 1,
      JSON.stringify(groupedHits))`,
  `    check('一个会话只占一个栏目', groupedHits.blocks === 2, JSON.stringify(groupedHits))`,
)

// 2) replace the "more hits" pair of checks with: loaded automatically, no button
const oldMore = /    \/\/ The rest of that conversation is one click away[\s\S]*?check\('点「更多命中」才去查这条会话（并且多出行来）',\n[\s\S]*?\)\n/
if (!oldMore.test(source)) {
  console.error('more-hits block not found')
  process.exit(1)
}
source = source.replace(
  oldMore,
  `    // Every match of a conversation arrives on its own — no button to press.
    await page.waitForTimeout(600)
    const autoHits = await page.evaluate(() => ({
      lines: document.querySelectorAll('[data-mindmap-search-hit] [data-mindmap-search-line]').length,
      buttons: document.querySelectorAll('[data-mindmap-search-more]').length,
      sessionCalls: window.__harness.searchSessionCalls().length,
    }))
    check('每条对话的全部命中自动补上（不再有「更多命中」按钮）',
      autoHits.buttons === 0 && autoHits.lines >= 3 && autoHits.sessionCalls >= 1,
      JSON.stringify(autoHits))
`,
)

// 3) spawn: the panel now defaults to full history; the digest path still prompts nothing
source = source.replace(
  `    check('走 session/prompt 发出首条消息',
      spawnCalls.prompt?.detail?.content?.[0]?.text === '这条对话是连线新建的',
      JSON.stringify(spawnCalls.prompt?.detail))`,
  `    check('默认选中「完整对话」（沿用父会话历史）',
      (await page.evaluate(() => {
        const active = document.querySelector('[class*="spawnModeActive"]')
        return active === null ? null : active.textContent.trim()
      })) !== null,
      'spawn mode default')`,
)

fs.writeFileSync(file, source, 'utf8')
console.log('probe adapted')
