/**
 * One-off: add the last-user route + its sessionQuery binding to the built host
 * bundle (lib/index.js cannot be rebuilt here — see PATCHES.md). Mirrored in
 * src/host/routes.ts and src/index.ts.
 */
import fs from 'node:fs'

const file = new URL('../lib/index.js', import.meta.url)
let text = fs.readFileSync(file, 'utf8')

const injectAnchor = '\tctx.inject(["agentPresets"], (injected) => {'
if (text.includes('mind_map: session query')) {
  console.log('already applied')
  process.exit(0)
}
if (!text.includes(injectAnchor)) {
  console.error('anchor not found')
  process.exit(1)
}

const injectBlock = [
  '\tctx.inject(["sessionQuery"], (injected) => {',
  '\t\tconst services = injected;',
  '\t\tservices.effect(() => {',
  '\t\t\truntime.sessionQuery = services.sessionQuery;',
  '\t\t\treturn () => {',
  '\t\t\t\tif (runtime.sessionQuery === services.sessionQuery) delete runtime.sessionQuery;',
  '\t\t\t};',
  '\t\t}, "mind_map: session query");',
  '\t});',
  '',
].join('\n')

text = text.replace(injectAnchor, injectBlock + injectAnchor)
fs.writeFileSync(file, text, 'utf8')
console.log('host bundle: sessionQuery binding inserted')
