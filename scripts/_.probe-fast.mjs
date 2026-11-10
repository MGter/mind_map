/** Probe: adapt the search assertions to the fast path. */
import fs from 'node:fs'

const file = 'test/probe.mjs'
let source = fs.readFileSync(file, 'utf8')
const J = (lines) => lines.join('\n')

// 1) session grouping: one line first, more after the ＋ button
source = source.replace(
  J([
    "    check('同一会话的多个命中归到一个栏目里',",
    '      groupedHits.blocks === 1 && groupedHits.lines === 2,',
    '      JSON.stringify(groupedHits))',
  ]),
  J([
    "    check('一个会话只占一个栏目（先给最匹配的一行）',",
    '      groupedHits.blocks === 1 && groupedHits.lines === 1,',
    '      JSON.stringify(groupedHits))',
  ]),
)

// 2) the ＋ button pulls the rest of that conversation
source = source.replace(
  J([
    "    check('每条命中先只占一行，完整上下文留给悬停框',",
    '      groupedHits.lines === 2, JSON.stringify(groupedHits))',
  ]),
  J([
    '    const beforeMore = await page.evaluate(() =>',
    "      window.__harness.searchSessionCalls().length)",
    "    check('搜索阶段不去翻每条会话的其它命中', beforeMore === 0, String(beforeMore))",
    '    await page.evaluate(() => {',
    "      const button = document.querySelector('[data-mindmap-search-more]')",
    '      if (button !== null) button.click()',
    '    })',
    '    await page.waitForTimeout(500)',
    "    const afterMore = await page.evaluate(() => ({",
    "      calls: window.__harness.searchSessionCalls().length,",
    "      lines: document.querySelectorAll('[data-mindmap-search-hit] [data-mindmap-search-line]').length,",
    '    }))',
    "    check('点「更多命中」才去查这条会话（并且多出行来）',",
    '      afterMore.calls === 1 && afterMore.lines >= 2, JSON.stringify(afterMore))',
  ]),
)

// 3) highlight count
source = source.replace(
  '    check(\'结果里的搜索词高亮\', groupedHits.marks >= 2',
  '    check(\'结果里的搜索词高亮\', groupedHits.marks >= 1',
)
source = source.replace(
  '&& (groupedHits.markText ?? []).every(text => text === \'物理\'),',
  '&& (groupedHits.markText ?? []).every(text => text === \'物理\'),',
)

// 4) failure checks must use an uncached query (the cache answers repeats)
source = source.replace(
  "    await page.evaluate(() => window.__harness.failSearchRpc(true))\n    await page.fill('[data-mindmap-drawer-search]', '')\n    await page.keyboard.type('物理')",
  "    await page.evaluate(() => window.__harness.failSearchRpc(true))\n    await page.fill('[data-mindmap-drawer-search]', '')\n    await page.keyboard.type('没有任何缓存的新词')",
)
source = source.replace(
  "      window.__harness.failSearchRpc(true)\n      window.__harness.failSearchRoute(true)\n    })\n    await page.fill('[data-mindmap-drawer-search]', '')\n    await page.keyboard.type('物理')",
  "      window.__harness.failSearchRpc(true)\n      window.__harness.failSearchRoute(true)\n    })\n    await page.fill('[data-mindmap-drawer-search]', '')\n    await page.keyboard.type('索引关闭测试词')",
)
source = source.replace(
  "      window.__harness.searchRouteError('session search is disabled: this deployment configures the session-query index with openAt never')\n      window.__harness.failSearchRpc(true)\n      window.__harness.failSearchRoute(true)\n    })\n    await page.fill('[data-mindmap-drawer-search]', '')\n    await page.keyboard.type('物理')",
  "      window.__harness.searchRouteError('session search is disabled: this deployment configures the session-query index with openAt never')\n      window.__harness.failSearchRpc(true)\n      window.__harness.failSearchRoute(true)\n    })\n    await page.fill('[data-mindmap-drawer-search]', '')\n    await page.keyboard.type('索引关闭另一测试词')",
)

fs.writeFileSync(file, source, 'utf8')
console.log('probe search assertions updated')
