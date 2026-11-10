/**
 * Kill the React #185 loop for real.
 *
 * Two causes: the effect depended on array identity (fresh every render), and the
 * SVG carried explicit pixel width/height, which can resize the scroll area and
 * feed straight back into the measurement. Now the layer is 100% sized by CSS,
 * the effect keys on stable primitives, and state only moves on a real change.
 */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
let source = fs.readFileSync(file, 'utf8')
const D = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(D)
const before = source

// 1) the svg: 100% via CSS, no pixel attributes
source = source.replace(
  J([
    '                <svg',
    "                  className={styles['drawerWires']}",
    '                  width={wireSize.width}',
    '                  height={wireSize.height}',
    '                  viewBox={`0 0 ${wireSize.width} ${wireSize.height}`}',
    '                  aria-hidden="true"',
    '                >',
  ]),
  J([
    '                <svg',
    "                  className={styles['drawerWires']}",
    '                  viewBox={`0 0 ${Math.max(1, wireSize.width)} ${Math.max(1, wireSize.height)}`}',
    '                  preserveAspectRatio="none"',
    '                  aria-hidden="true"',
    '                >',
  ]),
)

// 2) stable deps
source = source.replace(
  '  }, [props.links, visibleItems, query])',
  '  }, [props.links, props.items, query, visibleItems.length])',
)

// 3) round the measured size and ignore sub-pixel churn
source = source.replace(
  J([
    '      setWireSize((current) => (',
    '        current.width === scroller.scrollWidth && current.height === scroller.scrollHeight',
    '          ? current',
    '          : { width: scroller.scrollWidth, height: scroller.scrollHeight }',
    '      ))',
  ]),
  J([
    '      const width = Math.round(scroller.scrollWidth)',
    '      const height = Math.round(scroller.scrollHeight)',
    '      setWireSize((current) => (',
    '        current.width === width && current.height === height ? current : { width, height }',
    '      ))',
  ]),
)

// 4) and the initial state call must match
source = source.replace(
  '      setWireSize({ width: scroller.scrollWidth, height: scroller.scrollHeight })',
  '      setWireSize({ width: Math.round(scroller.scrollWidth), height: Math.round(scroller.scrollHeight) })',
)

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')

// CSS: the layer must not affect layout at all
const cssFile = 'src/client/mind-map.module.css'
let css = fs.readFileSync(cssFile, 'utf8')
css = css.replace(
  `.drawerWires {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}`,
  `.drawerWires {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}`,
)
fs.writeFileSync(cssFile, css, 'utf8')
console.log('drawer wires: stable')
