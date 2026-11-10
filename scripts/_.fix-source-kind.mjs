/**
 * DSH v4 refuses the retired `kind: "plugin"` source wrapper: a message must carry
 * a producer-owned kind, i.e. `plugin:<package>` (see the shell's producerKind()).
 * This rewrites our three injection sites, dropping the now-redundant `plugin` key.
 */
import fs from 'node:fs'

const files = ['lib/index.js', 'src/host/spawn.ts']
let total = 0

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8')
  const before = source

  // 1) { kind: "plugin", plugin: "mind_map" }  →  { kind: "plugin:mind_map" }
  source = source.replace(
    /source:\s*\{\s*\n(\s*)kind:\s*"plugin",\s*\n\s*plugin:\s*"mind_map"\s*\n\s*\}/g,
    (match, indent) => `source: {\n${indent}kind: "plugin:mind_map"\n${indent.slice(0, -1)}}`,
  )
  // 2) with extra fields (form / summary)
  source = source.replace(
    /source:\s*\{\s*\n(\s*)kind:\s*"plugin",\s*\n\s*plugin:\s*"mind_map",\s*\n/g,
    (match, indent) => `source: {\n${indent}kind: "plugin:mind_map",\n`,
  )
  // 3) single-quoted source (src/*.ts style)
  source = source.replace(/kind: 'plugin',\s*\n(\s*)plugin: 'mind_map',/g, "kind: 'plugin:mind_map',")
  source = source.replace(/kind: 'plugin',\s*\n(\s*)plugin: 'mind_map'\s*\n/g, "kind: 'plugin:mind_map'\n")

  if (source !== before) {
    fs.writeFileSync(file, source, 'utf8')
    total += 1
    console.log('rewritten', file)
  }
  const remaining = (source.match(/kind:\s*["']plugin["']/g) ?? []).length
  console.log('  remaining retired kinds:', remaining)
}
console.log('files touched:', total)
