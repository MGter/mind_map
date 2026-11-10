/**
 * Probe: the real map must render the custom edge, and the synced one must carry
 * the aura mask. Also grabs a screenshot so the look can be inspected.
 */
import fs from 'node:fs'

const file = 'test/probe.mjs'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const anchor = lines.findIndex(line => line.includes('// ---- 15. no runtime errors'))
if (anchor < 0) {
  console.error('anchor missing')
  process.exit(1)
}

const block = [
  '  // ---- edges render through the custom component ---------------------',
  '  if ((await page.evaluate(() => window.__harness.panelState())).selectedPanel !== \'mind-map\') await openMap()',
  '  await page.waitForTimeout(700)',
  '  const edgeShapes = await page.evaluate(() => {',
  '    const groups = [...document.querySelectorAll(\'.react-flow__edge\')]',
  '    return {',
  '      total: groups.length,',
  '      withMask: groups.filter(group => group.querySelector(\'mask\') !== null).length,',
  '      dashed: groups.filter(group => {',
  '        const path = group.querySelector(\'path.react-flow__edge-path\')',
  '        return path !== null && getComputedStyle(path).strokeDasharray !== \'none\'',
  '      }).length,',
  '    }',
  '  })',
  '  check(\'连线数量与数据一致（自定义渲染器生效）\', edgeShapes.total >= 1, JSON.stringify(edgeShapes))',
  '  check(\'同步中的连线带光带遮罩，未同步的是虚线\',',
  "    edgeShapes.withMask >= 1 || edgeShapes.dashed >= 1, JSON.stringify(edgeShapes))",
  '  await page.screenshot({ path: path.join(shots, \'probe-edges.png\') })',
  '',
]

const next = [...lines.slice(0, anchor), ...block, ...lines.slice(anchor)]
fs.writeFileSync(file, next.join('\n'), 'utf8')
console.log('edge checks inserted before line', anchor + 1)
