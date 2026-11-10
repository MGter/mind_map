/**
 * 1) 连线的右键菜单统一成两项动作：推送开关 / 删除连线（血缘线也能删，删了永久记住）。
 * 2) 去掉"隐藏所有血缘线"（面板菜单与连线菜单里那两处）。
 */
import fs from 'node:fs'

const file = 'src/client/MapCanvas.tsx'
let source = fs.readFileSync(file, 'utf8')
const D = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(D)
const before = source

// ---- 1. 存储：被删掉的血缘线 ------------------------------------------------
source = source.replace(
  J(["  const LINEAGE_KEY = 'dsh.mind-map.lineage-hidden.v1'"]),
  J([
    "  const LINEAGE_KEY = 'dsh.mind-map.lineage-hidden.v1'",
    "  /** Fork lines the user deleted one by one; keyed `parent->child`. */",
    "  const LINEAGE_CUT_KEY = 'dsh.mind-map.lineage-cut.v1'",
  ]),
)

// 状态 + 写入
source = source.replace(
  J(['  const [lineageHidden, setLineageHiddenState] = useState(() => {']),
  J([
    '  const [lineageCut, setLineageCut] = useState<readonly string[]>(() => {',
    '    try {',
    '      const raw = window.localStorage.getItem(LINEAGE_CUT_KEY)',
    '      const parsed = raw === null ? [] : JSON.parse(raw)',
    '      return Array.isArray(parsed) ? parsed.filter(item => typeof item === \'string\') : []',
    '    } catch {',
    '      return []',
    '    }',
    '  })',
    '  /** Deleting a derived fork line: it is not stored anywhere, so remember the pair. */',
    '  const cutLineage = (from: string, to: string): void => {',
    '    const key = from + \'->\' + to',
    '    setLineageCut(current => {',
    '      if (current.includes(key)) return current',
    '      const next = [...current, key]',
    '      try { window.localStorage.setItem(LINEAGE_CUT_KEY, JSON.stringify(next)) } catch { /* private mode */ }',
    '      return next',
    '    })',
    '  }',
    '',
    '  const [lineageHidden, setLineageHiddenState] = useState(() => {',
  ]),
)

// 派生线生成时跳过被删的那几条
source = source.replace(
  J(['      if (!lineageHidden) {']),
  J([
    '      const cut = new Set(lineageCut)',
    '      if (!lineageHidden) {',
  ]),
)

// ---- 2. 连线菜单：删掉 hide-lineage，把删除连线统一 ------------------------
const hideBlock = J([
  '      if (lineage) {',
  '        items.push({',
  "          key: 'hide-lineage',",
  "          label: t('edge.hideLineage'),",
  '          onPick: () => {',
  '            close()',
  '            setLineageHidden(true)',
  '          },',
  '        })',
  '      }',
])
if (!source.includes(hideBlock)) {
  console.error('hide-lineage block missing')
  process.exit(1)
}
source = source.replace(hideBlock, '')

const deleteBlock = J([
  '      // Stored edges only — lineage lines are derived, nothing to persist on.',
  '      // (Auto-sync is shelved: schema + host fan-out exist but stay',
  '      // unwired until the feature is wanted — see the handover doc.)',
  '      if (stored !== undefined) {',
  '        items.push({',
  "          key: 'delete-edge',",
  "          label: t('edge.delete'),",
  '          onPick: () => {',
  '            canvas.removeEdges([edgeId])',
  '            close()',
  '          },',
  '        })',
  '      }',
])
if (!source.includes(deleteBlock)) {
  console.error('delete-edge block missing')
  process.exit(1)
}
source = source.replace(
  deleteBlock,
  J([
    '      // One control for both kinds. A stored edge is removed; a derived fork',
    '      // line has nothing to delete, so the pair is remembered instead.',
    '      items.push({',
    "        key: 'delete-edge',",
    "        label: t('edge.delete'),",
    '        onPick: () => {',
    '          close()',
    '          if (stored !== undefined) {',
    '            canvas.removeEdges([edgeId])',
    '            return',
    '          }',
    '          cutLineage(edgeFrom, edgeTo)',
    '        },',
    '      })',
  ]),
)

// ---- 3. 面板菜单里的"隐藏所有血缘线" ---------------------------------------
const paneBlock = J([
  '      items.push({',
  "        key: 'toggle-lineage',",
  "        label: lineageHidden ? t('edge.showLineage') : t('edge.hideLineage'),",
  '        onPick: () => {',
  '          close()',
  '          setLineageHidden(!lineageHidden)',
  '        },',
  '      })',
])
if (!source.includes(paneBlock)) {
  console.error('pane toggle missing')
  process.exit(1)
}
source = source.replace(paneBlock, '')

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('menus unified')
