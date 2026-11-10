// 存储单元改名：复制 + **改写 unit 头**（这就是 2026-11-09 那次崩溃的根因——
// 只复制文件、头里还是旧单元名，宿主启动即 `StorageError: unit 'x': missing or
// foreign unit header` → host exit 1 → 桌面端崩）。
//
// 用法：
//   node migrate-storage.mjs talk_map mind_map
//   node migrate-storage.mjs talk_map mind_map --dry-run
//   node migrate-storage.mjs talk_map mind_map --force   # 允许覆盖已存在的目标文件
//
// 旧文件永远保留（回滚用）。改完重启桌面端生效。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const [from, to] = process.argv.slice(2).filter((a) => a.startsWith("--") === false);
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
if (from === undefined || to === undefined) {
  console.error("usage: node migrate-storage.mjs <oldUnit> <newUnit> [--dry-run] [--force]");
  process.exit(1);
}
if (!/^[a-z][a-z0-9_]*$/.test(to)) {
  console.error("单元名必须匹配 /^[a-z][a-z0-9_]*$/（不能有连字符）：" + to);
  process.exit(1);
}

const home = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE, ".dsh");
const dir = path.join(home, "storages");
const source = path.join(dir, from + ".json");
const target = path.join(dir, to + ".json");

if (!existsSync(source)) {
  console.error("源单元不存在: " + source);
  process.exit(1);
}
if (existsSync(target) && force === false) {
  console.error("目标已存在: " + target + "（要覆盖加 --force）");
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(source, "utf8"));
if (parsed.unit === undefined || parsed.unit.name !== from) {
  console.error("源文件的 unit 头不是 '" + from + "'，拒绝迁移：" + JSON.stringify(parsed.unit));
  process.exit(1);
}
parsed.unit = { ...parsed.unit, name: to };
const body = JSON.stringify(parsed);

const tables = parsed.tables ?? {};
const summary = Object.keys(tables).map((name) => name + "=" + Object.keys(tables[name] ?? {}).length).join(" ");
console.log((dryRun ? "[dry-run] " : "") + from + " -> " + to + "  unit.version=" + parsed.unit.version + "  " + summary);
if (dryRun) process.exit(0);
writeFileSync(target, body);
console.log("wrote " + target + " (" + body.length + " chars); 旧文件保留: " + source);
