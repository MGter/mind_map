/** Rewrite the tail of the drawer (lines 254-283) with correct JSX. */
import fs from 'node:fs'

const file = 'src/client/StackDrawer.tsx'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const head = lines.slice(0, 253)
const tail = [
  '          })}',
  "          {needle !== '' && visibleItems.length === 0",
  "            ? <div className={styles['drawerEmpty']}>{t('stack.noTitleMatch')}</div>",
  '            : null}',
  '          {hits.length > 0',
  '            ? (',
  "                <div className={styles['drawerHits']}>",
  "                  <div className={styles['drawerHitsHead']}>",
  "                    {t('stack.contentHits', { n: String(hits.length) })}",
  '                  </div>',
  '                  {hits.map(hit => (',
  '                    <button',
  '                      key={hit.sessionId}',
  '                      type="button"',
  "                      className={styles['drawerHit']}",
  '                      data-mindmap-search-hit={hit.sessionId}',
  '                      onClick={() => { props.onOpenSession?.(hit.sessionId) }}',
  '                    >',
  "                      <span className={styles['drawerHitTitle']}>{hit.title}</span>",
  "                      <span className={styles['drawerHitSnippet']}>{hit.snippet}</span>",
  '                    </button>',
  '                  ))}',
  '                </div>',
  '              )',
  '            : null}',
  '        </div>',
  '      </div>',
  '    </div>',
  '  )',
  '}',
  '',
]
fs.writeFileSync(file, [...head, ...tail].join('\n'), 'utf8')
console.log('tail rewritten')
