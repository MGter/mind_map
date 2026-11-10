/**
 * 离线冒烟：把发布出来的 tarball 当成"别人的机器"上的安装件，按 DSH 的加载契约验证。
 *
 *   node scripts/_publish-smoke.mjs <unpacked-package-dir>
 *
 * 检查三件事（和 dsh-hide-update-badge 那次的验收方式一致）：
 *   1. package.json 的 dsh 契约：exports["./client"] 指向真文件、dsh.client.platform、
 *      dsh.bundle.patch 存在、没有 prepack（CI/安装时不该触发构建）
 *   2. client.js 是 window.__ModuleLoader__.load({id, factory}) 形式，且 id 正确
 *   3. lib/index.js 语法可解析、导入了就需要的东西（不做完整挂载）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/_publish-smoke.mjs <unpacked-package-dir>')
  process.exit(2)
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  — ' + detail}`)
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

check('包名与版本', pkg.name === 'mind_map', `${pkg.name}@${pkg.version}`)
check('exports["./client"] 存在', typeof pkg.exports?.['./client'] === 'string', pkg.exports?.['./client'])
const clientEntry = pkg.exports?.['./client']
check('client 入口文件真的在包里',
  clientEntry !== undefined && fs.existsSync(path.join(root, clientEntry)),
  clientEntry)
check('dsh.client.platform = web', pkg.dsh?.client?.platform === 'web', pkg.dsh?.client?.platform)
check('dsh.bundle.patch 指向真文件',
  typeof pkg.dsh?.bundle?.patch === 'string' && fs.existsSync(path.join(root, pkg.dsh.bundle.patch)),
  pkg.dsh?.bundle?.patch)
check('没有 prepack/prepare（安装与 CI 都不该触发构建）',
  pkg.scripts?.prepack === undefined && pkg.scripts?.prepare === undefined,
  JSON.stringify({ prepack: pkg.scripts?.prepack, prepare: pkg.scripts?.prepare }))
check('main 指向真文件',
  typeof pkg.main === 'string' && fs.existsSync(path.join(root, pkg.main)), pkg.main)

// client bundle：必须是 __ModuleLoader__.load 形式（不能是 ESM）
const clientSource = fs.readFileSync(path.join(root, clientEntry), 'utf8')
let captured = null
const context = vm.createContext({
  window: {
    __ModuleLoader__: {
      load: entry => { captured = entry },
    },
  },
  document: { createElement: () => ({ style: {} }), head: { appendChild: () => {} }, querySelectorAll: () => [] },
  console,
  setTimeout,
  clearTimeout,
})
try {
  vm.runInContext(clientSource, context, { timeout: 20000 })
  check('client.js 可执行', true, `${Math.round(clientSource.length / 1024)} kB`)
} catch (error) {
  check('client.js 可执行', false, String(error).slice(0, 160))
}
check('client 注册了 id', captured?.id === 'mind_map', JSON.stringify(captured?.id))
check('client 提供 factory', typeof captured?.factory === 'function', typeof captured?.factory)

// host bundle：只做语法与形态检查（真正挂载需要 cordis 宿主）
const hostPath = path.join(root, pkg.main)
const hostSource = fs.readFileSync(hostPath, 'utf8')
// 宿主包是 ESM（package.json type=module），vm.Script 只认 CJS —— 用 node --check 校验
const isEsm = /^\s*(import|export)\s/m.test(hostSource)
const probeFile = path.join(os.tmpdir(), `tm-host-probe-${Date.now()}.${isEsm ? 'mjs' : 'cjs'}`)
fs.writeFileSync(probeFile, hostSource, 'utf8')
const probe = spawnSync(process.execPath, ['--check', probeFile], { encoding: 'utf8' })
check(`${isEsm ? 'ESM' : 'CJS'} 语法可解析`, probe.status === 0,
  probe.status === 0 ? `${Math.round(hostSource.length / 1024)} kB` : String(probe.stderr).slice(0, 200))
check('宿主包形态与 package.json type 一致', isEsm === (pkg.type === 'module'), `type=${pkg.type ?? '(none)'}`)
check('host 侧不 require 非内置包',
  !/require\(['"](?!\.|\/|node:)[^'"]+['"]\)/.test(hostSource.replace(/require\(['"](?:react|react-dom|zod)[^'"]*['"]\)/g, '')),
  '除 peer 依赖外无外部 require')

const failed = results.filter(item => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
