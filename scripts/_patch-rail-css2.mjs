/** Replace the status-rail CSS with the left-edge card column. */
import fs from 'node:fs'

const file = 'src/client/mind-map.module.css'
const raw = fs.readFileSync(file, 'utf8')
const marker = '/* ── status rail (left edge) '
const at = raw.indexOf(marker)
if (at < 0) { console.log('marker missing'); process.exit(1) }
const head = raw.slice(0, at)

const css = String.raw`/* ── status rail: a column of real cards at the left edge ───────────────── */
.statusRail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 6;
  pointer-events: none;
  --rail-card-w: 224px;
  --rail-pad: 10px;
  --rail-w: calc(var(--rail-card-w) + var(--rail-pad) * 2);
}

.statusRailPanel {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--rail-w);
  box-sizing: border-box;
  padding: var(--rail-pad);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--dsw-alias-bg-elevated, rgba(18, 20, 26, 0.94));
  border-right: 1px solid var(--dsw-alias-border-secondary);
  box-shadow: 6px 0 26px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(10px);
  transform: translateX(-101%);
  transition: transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1), box-shadow 320ms ease;
  pointer-events: none;
}

.statusRailOpen .statusRailPanel {
  transform: translateX(0);
  pointer-events: auto;
}

.statusRailHead {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 4px 0;
}

.statusRailTitle {
  flex: 1;
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-secondary);
}

.statusRailCount {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #6b7280);
  font-variant-numeric: tabular-nums;
}

.statusRailList {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 2px 14px;
}

.statusRailEmpty {
  padding: 8px 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}

.statusRailSlot {
  position: relative;
}

.statusRailSlot[draggable="true"] {
  cursor: grab;
}

.statusRailSlot[draggable="true"]:active {
  cursor: grabbing;
}

/* A rail card is a board card: same width, same faces, same lamp. */
.statusRailCard {
  width: var(--rail-card-w);
  min-height: 84px;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.statusRailCard:hover {
  transform: translateY(-1px);
}

.statusRailTab {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 9px 5px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-left: none;
  border-radius: 0 9px 9px 0;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  pointer-events: auto;
  transition: left 320ms cubic-bezier(0.22, 0.61, 0.36, 1), color 140ms ease, background 140ms ease;
}

/* Open: the tab rides the panel's right edge, half over it. */
.statusRailOpen .statusRailTab {
  left: calc(var(--rail-w) - 12px);
}

.statusRailTab:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active);
}

.statusRailTabCount {
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
  color: #0b0d12;
  font-variant-numeric: tabular-nums;
}
`

fs.writeFileSync(file, head + css, 'utf8')
console.log('css replaced, length', (head + css).length)
