import fs from 'node:fs'
const i18n = 'src/client/i18n.ts'
let text = fs.readFileSync(i18n, 'utf8')
text = text.replace("  'map.toggle': '思维图',", "  'map.toggle': '思维图',\n  'map.backToCurrent': '回到当前对话',")
text = text.replace("  'map.toggle': 'Talk Map',", "  'map.toggle': 'Talk Map',\n  'map.backToCurrent': 'Back to this conversation',")
fs.writeFileSync(i18n, text, 'utf8')
console.log('i18n added')
