/** Make the two injection sites fail loudly instead of poisoning the session. */
import fs from 'node:fs'

const file = 'lib/index.js'
let source = fs.readFileSync(file, 'utf8')
const before = source

source = source.replace(
  'agent.inject(message);',
  `try {
							agent.inject(message);
						} catch (error) {
							throw new Error("mind-map: 注入被拒（" + String(error?.message ?? error) + "）");
						}`,
)
source = source.replace(
  'handle.agent.inject(message);',
  `try {
							handle.agent.inject(message);
						} catch (error) {
							throw new Error("mind-map: 注入被拒（" + String(error?.message ?? error) + "）");
						}`,
)

if (source === before) {
  console.error('no injection site matched')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('injection wrapped')
