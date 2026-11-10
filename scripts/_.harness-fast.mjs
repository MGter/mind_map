/** Harness: single-hit search + per-session extra hits. */
import fs from 'node:fs'

const file = 'test/harness.js'
let source = fs.readFileSync(file, 'utf8')

source = source.replace(
  `  const searchContextCalls = []`,
  `  const searchContextCalls = []
  const searchSessionCalls = []`,
)

source = source.replace(
  `    // Lazy passage for one hit (hover).`,
  `    // Extra hits inside one conversation (asked for with the ＋ button).
    if (path.indexOf('/mind-map/search-session') >= 0) {
      searchSessionCalls.push({ sessionId: body?.sessionId, query: body?.query })
      return json({
        blocks: [['…按 SI 单位换算 Matter.js 的物理参数…'], ['…物理量单位统一走 PX_PER_M…']],
        seqs: [42, 43],
      })
    }
    // Lazy passage for one hit (hover).`,
)

// search returns ONE line per conversation now
source = source.replace(
  `      const items = query.includes('物理') || query.includes('Matter')
        ? [{
          sessionId: 's3',
          blocks: [
            ['…按 SI 单位换算 Matter.js 的物理参数…'],
            ['…物理量单位统一走 PX_PER_M…'],
          ],
          seqs: [42, 43],
        }]
        : []`,
  `      const items = query.includes('物理') || query.includes('Matter')
        ? [{ sessionId: 's3', blocks: [['…按 SI 单位换算 Matter.js 的物理参数…']], seqs: [42] }]
        : []`,
)

source = source.replace(
  `    /** Which hits asked for their passage (hover), and when. */
    searchContextCalls() {
      return searchContextCalls.slice()
    },`,
  `    /** Which hits asked for their passage (hover), and when. */
    searchContextCalls() {
      return searchContextCalls.slice()
    },
    /** Which conversations asked for their extra hits (the ＋ button). */
    searchSessionCalls() {
      return searchSessionCalls.slice()
    },`,
)

fs.writeFileSync(file, source, 'utf8')
console.log('harness: single-hit search fixture')
