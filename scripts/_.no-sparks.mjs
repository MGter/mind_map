/** 去掉粒子，流光提速。 */
import fs from 'node:fs'

const file = 'src/client/MindMapEdge.tsx'
let source = fs.readFileSync(file, 'utf8')
const EOL = source.includes('\r\n') ? '\r\n' : '\n'
const before = source

// 1) 提速：3.6s → 1.8s（一次扫过更短 = 光带更频繁地穿过整条线）
source = source.replace(
  '/** One sweep across the line, in seconds (the card ring takes 1.8s per lap). */\nconst SWEEP_S = 3.6',
  '/** One sweep across the line, in seconds — same tempo as the card ring. */\nconst SWEEP_S = 1.8',
)
source = source.replace(
  '/** One sweep across the line, in seconds (the card ring takes 1.8s per lap). */\r\nconst SWEEP_S = 3.6',
  '/** One sweep across the line, in seconds — same tempo as the card ring. */\r\nconst SWEEP_S = 1.8',
)

// 2) 删除粒子常量与噪声函数
const sparkConsts = source.indexOf('/** How many sparks drift along the line')
if (sparkConsts >= 0) {
  const end = source.indexOf('function prefersReducedMotion', sparkConsts)
  if (end > sparkConsts) source = source.slice(0, sparkConsts) + source.slice(end)
}

// 3) 删除组件里的 sparks 计算
const sparkCalc = source.indexOf('  // Small glowing motes drifting the same way as the sweep')
if (sparkCalc >= 0) {
  const end = source.indexOf('  }))', sparkCalc)
  if (end > sparkCalc) source = source.slice(0, sparkCalc) + source.slice(end + '  }))'.length + EOL.length)
}

// 4) 删除 sparkId / routeId
source = source.replace(`  const sparkId = 'tms' + uid${EOL}`, '')
source = source.replace(`  // Invisible geometry the sparks ride on (the sweep uses a mask instead).${EOL}  const routeId = 'tmr' + uid${EOL}`, '')

// 5) 删除 spark 渐变 defs
const gradStart = source.indexOf('                <radialGradient id={sparkId}>')
if (gradStart >= 0) {
  const gradEnd = source.indexOf('</radialGradient>', gradStart)
  if (gradEnd > gradStart) source = source.slice(0, gradStart) + source.slice(gradEnd + '</radialGradient>'.length + EOL.length)
}

// 6) 删除 route path
const routeLine = source.indexOf('              {/* Invisible: only a route for the sparks. */}')
if (routeLine >= 0) {
  const routeEnd = source.indexOf(EOL, source.indexOf('<path id={routeId}', routeLine))
  if (routeEnd > routeLine) source = source.slice(0, routeLine) + source.slice(routeEnd + EOL.length)
}

// 7) 删除粒子渲染块
const sparkBlock = source.indexOf('                {/* Sparks live OUTSIDE the sweep mask')
if (sparkBlock >= 0) {
  const blockEnd = source.indexOf('))}', sparkBlock)
  if (blockEnd > sparkBlock) source = source.slice(0, sparkBlock) + source.slice(blockEnd + '))}'.length + EOL.length)
}

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('particles removed, sweep sped up')
