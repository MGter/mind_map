/** Frosted-glass handle, longer bars (in the TSX), floating drag styling, grab cursor. */
import fs from 'node:fs'

const file = 'src/client/mind-map.module.css'
let text = fs.readFileSync(file, 'utf8')

// 1) handle → frosted glass, brighter icon
text = text.replace(
  `  border: 1px solid var(--dsw-alias-border-secondary);
  border-left: none;
  border-radius: 0 11px 11px 0;
  box-shadow: 3px 0 12px rgba(0, 0, 0, 0.28);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);`,
  `  border: 1px solid rgba(255, 255, 255, 0.16);
  border-left: none;
  border-radius: 0 11px 11px 0;
  /* Frosted glass: the canvas behind is dark, so a solid chip disappeared into it. */
  background: rgba(38, 42, 52, 0.42);
  backdrop-filter: blur(16px) saturate(1.5);
  -webkit-backdrop-filter: blur(16px) saturate(1.5);
  box-shadow: 3px 0 14px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  color: var(--dsw-alias-label-primary);`,
)

text = text.replace(
  `.statusRailTab:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active);
}`,
  `.statusRailTab:hover {
  color: #ffffff;
  background: rgba(58, 64, 78, 0.55);
}`,
)

// 2) grab cursor on rail cards
text = text.replace(
  `.statusRailCard {
  width: var(--rail-card-w);
  min-height: 84px;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}`,
  `.statusRailCard {
  width: var(--rail-card-w);
  min-height: 84px;
  cursor: grab;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.statusRailCard:active {
  cursor: grabbing;
}

/* The card being dragged floats under the pointer; the rest glide out of its way. */
.statusRailSlotFloating {
  pointer-events: none;
}

.statusRailCardDragging {
  cursor: grabbing;
  transform: scale(1.02) rotate(-0.3deg);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
  opacity: 0.97;
}`,
)

fs.writeFileSync(file, text, 'utf8')
console.log('handle is frosted; floating styles added')
