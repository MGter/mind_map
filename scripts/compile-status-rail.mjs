import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
export function compileStatusRail() {
  let esbuild
  try { esbuild = require('esbuild') }
  catch { esbuild = require('../.cache/rail-tools/node_modules/esbuild') }
  const source = readFileSync(new URL('../src/client/StatusRail.tsx', import.meta.url), 'utf8')
  const { code } = esbuild.transformSync(source, {
    loader: 'tsx', format: 'esm', target: 'es2022',
    jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
  })
  // Reuse only the host bindings of the existing bundle. Module state and helper
  // names stay private; the TSX remains the single source for pointer handling.
  const body = code.replace(/^import[^;]+;\s*/gm, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(?=function StatusRail\b)/m, '')
  const compiled = `// src/client/StatusRail.tsx\n// Compiled from the current TSX source.\nvar StatusRail = (() => {\n` +
    `const React = require("react");\n` +
    `const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React;\n` +
    `const styles = mind_map_default;\n` + body + `\nreturn StatusRail;\n})();\n\n`
  new vm.Script(compiled, { filename: 'status-rail.compiled.js' })
  return compiled
}

export function readLegacyStatusRail(bundle) {
  const start = '// src/client/StatusRail.tsx\n'
  const end = '// src/client/use-dark.ts\n'
  if (bundle.split(start).length !== 2) throw new Error('StatusRail start marker must match once')
  const from = bundle.indexOf(start)
  const to = bundle.indexOf(end, from + start.length)
  if (to < 0) throw new Error('StatusRail end marker missing')
  return bundle.slice(from, to)
}
