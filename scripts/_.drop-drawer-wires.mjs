/**
 * 撤掉抽屉里的连线层。
 *
 * 那批线是逐张测量卡片位置后手画的曲线：卡片换行/换序、字号变化时很容易
 * 穿过卡片、互相交叉，看起来就是一坨乱线。整层删除，抽屉回到"卡片 + 文字
 * 标签"的干净状态。
 */
import fs from 'node:fs'

// ------------------------------------------------------------------ drawer ---
const drawerFile = 'src/client/StackDrawer.tsx'
let drawer = fs.readFileSync(drawerFile, 'utf8')
const D = drawer.includes('\r\n') ? '\r\n' : '\n'
const lines = drawer.split(/\r?\n/)

// 1) 删掉 DrawerWire 类型
let start = lines.findIndex(line => line.includes('/** One line to draw behind the drawer cards. */'))
if (start >= 0) {
  let end = start
  while (end < lines.length && lines[end].trim() !== '}') end += 1
  lines.splice(start, end - start + 2) // 连同后面的空行
}

// 2) 删掉 links 属性
let propAt = lines.findIndex(line => line.includes('links?: readonly DrawerWire[]'))
if (propAt >= 0) {
  let from = propAt - 4 // 连同注释
  while (from >= 0 && !lines[from].trim().startsWith('/**')) from -= 1
  lines.splice(from, propAt - from + 1)
}

// 3) 删掉 wires 状态
let stateAt = lines.findIndex(line => line.includes('const [wires, setWires]'))
if (stateAt >= 0) {
  const removeCount = lines[stateAt + 1]?.includes('const [wireSize, setWireSize]') ? 2 : 1
  let from = stateAt - 1
  if (lines[from]?.includes('/** Measured connector lines')) from -= 1
  lines.splice(from, stateAt - from + removeCount)
}

// 4) 删掉测量 effect（从注释开始到 deps 行结束）
let effectAt = lines.findIndex(line => line.includes('Rebuild the connector paths whenever the layout'))
if (effectAt >= 0) {
  let from = effectAt - 1 // /** 行
  let end = lines.findIndex((line, index) => index > effectAt && line.includes('}, [props.links, props.items'))
  if (end > 0) lines.splice(from, end - from + 1)
}

// 5) 删掉 svg 渲染块
let svgAt = lines.findIndex(line => line.includes("{wires.length > 0"))
if (svgAt >= 0) {
  let end = lines.findIndex((line, index) => index > svgAt && line.includes(': null}'))
  if (end > 0) lines.splice(svgAt, end - svgAt + 1)
}

// 6) 卡片上的 data-card-id 也可去掉（没人用了）
const cardIdAt = lines.findIndex(line => line.includes('data-card-id={item.cardId}'))
if (cardIdAt >= 0) lines.splice(cardIdAt, 1)

drawer = lines.join(D)
fs.writeFileSync(drawerFile, drawer, 'utf8')

// ------------------------------------------------------------------ canvas ---
const canvasFile = 'src/client/MapCanvas.tsx'
let canvas = fs.readFileSync(canvasFile, 'utf8')
const cLines = canvas.split(/\r?\n/)

// 删掉 links 传递
const passAt = cLines.findIndex(line => line.includes('links={drawerWireLinks}'))
if (passAt >= 0) cLines.splice(passAt, 1)

// 删掉 drawerLinks 函数
let fnAt = cLines.findIndex(line => line.includes('const drawerLinks = (cardIds'))
if (fnAt >= 0) {
  let from = fnAt
  while (from > 0 && !cLines[from - 1].trim().startsWith('/**')) from -= 1
  from -= 1
  let end = fnAt
  while (end < cLines.length && cLines[end] !== '  }') end += 1
  cLines.splice(from, end - from + 1)
}

// 删掉 drawerWireLinks memo
let memoAt = cLines.findIndex(line => line.includes('const drawerWireLinks = useMemo'))
if (memoAt >= 0) {
  let from = memoAt
  while (from > 0 && !cLines[from - 1].trim().startsWith('/**')) from -= 1
  from -= 1
  let end = memoAt
  while (end < cLines.length && !cLines[end].includes('}, [drawer, folderLayouts')) end += 1
  cLines.splice(from, end - from + 1)
}

canvas = cLines.join(D)
fs.writeFileSync(canvasFile, canvas, 'utf8')

// --------------------------------------------------------------------- css ---
const cssFile = 'src/client/mind-map.module.css'
let css = fs.readFileSync(cssFile, 'utf8')
const marker = '/* ---------------------------------------------------------------- drawer wires'
const at = css.indexOf(marker)
if (at >= 0) css = css.slice(0, at).replace(/\s+$/, '') + '\n'
fs.writeFileSync(cssFile, css, 'utf8')

console.log('drawer wires removed')
