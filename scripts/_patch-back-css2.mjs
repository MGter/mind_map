import fs from 'node:fs'
const css = 'src/client/mind-map.module.css'
let sheet = fs.readFileSync(css, 'utf8')
if (!sheet.includes('.toggleWrap')) {
  sheet += String.raw`
/* ── sidebar entry: map toggle + "back to this conversation" ─────────────── */
.toggleWrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.toggleWrapWide {
  width: 100%;
}

.toggleWrapWide .toggleRow {
  flex: 1;
  min-width: 0;
}

/* 32 + 4 + 20 = 56: exactly the rail's width, so nothing spills. */
.backToCurrent {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
}

.toggleWrapWide .backToCurrent {
  width: 24px;
  height: 24px;
}

.backToCurrent:hover {
  opacity: 1;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.backToCurrent:active {
  background: var(--dsw-alias-interactive-bg-active);
}

.backToCurrentIcon {
  width: 14px;
  height: 14px;
  flex: none;
}

.toggleWrapWide .backToCurrentIcon {
  width: 15px;
  height: 15px;
}
`
}
fs.writeFileSync(css, sheet, 'utf8')

const tsx = 'src/client/MapToggleButton.tsx'
let text = fs.readFileSync(tsx, 'utf8')
text = text.replace("styles['backButton']", "styles['backToCurrent']").replace("styles['backIcon']", "styles['backToCurrentIcon']")
fs.writeFileSync(tsx, text, 'utf8')
console.log('css appended (new names) + component renamed')
