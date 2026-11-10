/** Add an arrow-direction check to the map demo audit. */
import fs from 'node:fs'

const file = 'scripts/_demo-verify.mjs'
let text = fs.readFileSync(file, 'utf8')

const anchor = "const shot = process.argv.includes('--shot')"
if (!text.includes(anchor)) {
  console.log('shot anchor missing')
  process.exit(1)
}

const addition = String.raw`
// Arrow heads: they are drawn behind the cards, so a head that straddles a border loses
// half of itself; and a head whose angle came from the wrong segment points backwards.
const arrowReport = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-mindmap-session]')].map(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
  })
  const svg = document.querySelector('.react-flow__edges svg') ?? document.querySelector('.react-flow__edges')
  if (svg === null) return { arrows: 0, bad: [] }
  const paths = [...svg.querySelectorAll('path')]
  const heads = []
  for (const element of paths) {
    const transform = element.getAttribute('transform') ?? ''
    if (!transform.includes('translate')) continue
    const translate = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(transform)
    const rotate = /rotate\(([-\d.]+)\)/.exec(transform)
    if (translate === null) continue
    heads.push({ x: Number(translate[1]), y: Number(translate[2]), angle: rotate === null ? 0 : Number(rotate[1]) })
  }
  const bad = []
  for (const head of heads) {
    // Convert to screen space via the SVG's own transform.
    const matrix = svg.getScreenCTM?.()
    const point = matrix === null || matrix === undefined
      ? head
      : new DOMPoint(head.x, head.y).matrixTransform(matrix)
    let nearest = null
    let best = Number.POSITIVE_INFINITY
    for (const card of cards) {
      const dx = Math.max(card.x - point.x, 0, point.x - (card.x + card.w))
      const dy = Math.max(card.y - point.y, 0, point.y - (card.y + card.h))
      const distance = Math.hypot(dx, dy)
      if (distance < best) { best = distance; nearest = card }
    }
    if (nearest === null || best > 6) continue
    const radians = (head.angle * Math.PI) / 180
    const dir = { x: Math.cos(radians), y: Math.sin(radians) }
    const edges = [
      { d: Math.abs(point.y - nearest.y), n: { x: 0, y: 1 } },
      { d: Math.abs(point.y - (nearest.y + nearest.h)), n: { x: 0, y: -1 } },
      { d: Math.abs(point.x - nearest.x), n: { x: 1, y: 0 } },
      { d: Math.abs(point.x - (nearest.x + nearest.w)), n: { x: -1, y: 0 } },
    ].sort((a, b) => a.d - b.d)
    const normal = edges[0].n
    const inward = dir.x * normal.x + dir.y * normal.y
    if (inward < 0.7) bad.push({ x: Math.round(point.x), y: Math.round(point.y), angle: head.angle, inward: Math.round(inward * 100) / 100 })
  }
  return { arrows: heads.length, bad }
})
console.log('ARROWS', JSON.stringify(arrowReport))

const shot = process.argv.includes('--shot')`

text = text.replace(anchor, addition)
fs.writeFileSync(file, text, 'utf8')
console.log('arrow check added to demo audit')
