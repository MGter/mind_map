import fs from 'node:fs'
// CSS for the confirm dialog
const css = 'src/client/mind-map.module.css'
let sheet = fs.readFileSync(css, 'utf8')
sheet += String.raw`

/* ── destructive confirmation ────────────────────────────────────────────── */
.dangerBackdrop {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 10, 14, 0.55);
  backdrop-filter: blur(2px);
}

.dangerDialog {
  width: min(420px, calc(100% - 48px));
  padding: 18px 18px 14px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 14px;
  background: var(--dsw-alias-bg-elevated, #16181f);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}

.dangerTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dangerBody {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

.dangerActions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dangerCancel,
.dangerOk {
  padding: 6px 14px;
  border-radius: 8px;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.dangerCancel {
  border: 1px solid var(--dsw-alias-border-secondary);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}

.dangerCancel:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dangerOk {
  border: 1px solid rgba(242, 78, 78, 0.55);
  background: rgba(242, 78, 78, 0.16);
  color: #ff6b6b;
}

.dangerOk:hover {
  background: rgba(242, 78, 78, 0.28);
  color: #ff8a8a;
}
`
fs.writeFileSync(css, sheet, 'utf8')

// i18n strings
const i18n = 'src/client/i18n.ts'
let text = fs.readFileSync(i18n, 'utf8')
text = text.replace(
  "  'statusRail.title': '队列中的任务',",
  [
    "  'statusRail.title': '队列中的任务',",
    "  'confirm.removeGroup.title': '移除这个分组？',",
    "  'confirm.removeGroup.body': '只会从地图上移走 {n} 张卡片和这个分组框——会话本身还在侧栏，不会被删除，也不会进回收站。再导入这个工作区就能恢复。',",
    "  'confirm.removeGroup.ok': '移除',",
    "  'confirm.cancel': '取消',",
  ].join('\n'),
)
text = text.replace(
  "  'statusRail.title': 'Tasks in the queue',",
  [
    "  'statusRail.title': 'Tasks in the queue',",
    "  'confirm.removeGroup.title': 'Remove this group?',",
    "  'confirm.removeGroup.body': 'This only takes {n} cards and the group frame off the map — the conversations stay in the sidebar, nothing is deleted and nothing goes to the recycle bin. Re-importing the workspace brings it back.',",
    "  'confirm.removeGroup.ok': 'Remove',",
    "  'confirm.cancel': 'Cancel',",
  ].join('\n'),
)
fs.writeFileSync(i18n, text, 'utf8')
console.log('css + strings added')
