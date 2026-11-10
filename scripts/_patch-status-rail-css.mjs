/** Append the status-rail styles to the plugin stylesheet. */
import fs from 'node:fs'

const file = 'src/client/mind-map.module.css'
const css = String.raw`

/* ── status rail (left edge) ─────────────────────────────────────────────── */
.statusRail {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 6;
  display: flex;
  align-items: flex-start;
  pointer-events: none;
}

.statusRailTab {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-left: none;
  border-radius: 0 10px 10px 0;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  transition: color 120ms ease, background 120ms ease;
}

.statusRailTab:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active);
}

.statusRailOpen .statusRailTab {
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-active);
}

.statusRailTabIcon {
  font-size: 13px;
  line-height: 1;
}

.statusRailTabCount {
  font-size: 10px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-onbrand, #0b0d12);
  font-variant-numeric: tabular-nums;
}

.statusRailPanel {
  pointer-events: auto;
  width: 232px;
  max-height: 60vh;
  overflow-y: auto;
  margin-left: 6px;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 12px;
  background: var(--dsw-alias-bg-elevated, rgba(20, 22, 28, 0.96));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
}

.statusRailHead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 2px 8px;
}

.statusRailTitle {
  flex: 1;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.statusRailClose {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 6px;
}

.statusRailClose:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.statusRailEmpty {
  padding: 10px 6px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}

.statusRailRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: grab;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

.statusRailRow:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.statusRailRow:active {
  cursor: grabbing;
}

.statusRailLamp {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--dsw-alias-label-tertiary, #6b7280);
}

.statusRailLamp_running { background: #e9ecf3; box-shadow: 0 0 6px rgba(233, 236, 243, 0.7); }
.statusRailLamp_waiting { background: #f5b22e; box-shadow: 0 0 6px rgba(245, 178, 46, 0.7); }
.statusRailLamp_done { background: #34c759; box-shadow: 0 0 6px rgba(52, 199, 89, 0.6); }
.statusRailLamp_error { background: #f24e4e; box-shadow: 0 0 6px rgba(242, 78, 78, 0.7); }

.statusRailRowTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statusRailRowLamp {
  flex: none;
  font-size: 10px;
  color: var(--dsw-alias-label-secondary);
}
`

fs.appendFileSync(file, css, 'utf8')
console.log('status-rail css appended')
