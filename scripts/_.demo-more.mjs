/**
 * demo 模式三件套：布局自动保存（localStorage 镜像 payload）、待发送草稿示例、
 * 更多卡片与工作区。
 */
import fs from 'node:fs'

const file = 'test/harness.js'
let source = fs.readFileSync(file, 'utf8')
const D = source.includes('\r\n') ? '\r\n' : '\n'
const J = (lines) => lines.join(D)
const before = source

// ---- 1. demo 块尾部：新工作区 / 新会话 / 新卡 / 新边 / 草稿 / 存档读取 ----
const tailAnchor = J([
  `    // One more lamp so the drawer shows a green card as well.`,
  `    statusById.set('s15', { completionUnread: true })`,
  `  }`,
])
if (!source.includes(tailAnchor)) {
  console.error('demo tail anchor missing')
  process.exit(1)
}

const tail = J([
  `    // One more lamp so the drawer shows a green card as well.`,
  `    statusById.set('s15', { completionUnread: true })`,
  `    // More folders and conversations: the showcase should feel lived-in.`,
  `    FRAME_SHAPE['ws-physics'] = { cols: 2, rows: 2 }`,
  `    FRAME_SHAPE['ws-travel'] = { cols: 2, rows: 1 }`,
  `    frames['ws-physics'] = { x: 960, y: 640,`,
  `      width: 2 * (CARD_W + GAP_X) - GAP_X + PAD * 2,`,
  `      height: 2 * (CARD_H + GAP_Y) - GAP_Y + PAD * 2 + LABEL }`,
  `    frames['ws-travel'] = { x: 960, y: 1180,`,
  `      width: 2 * (CARD_W + GAP_X) - GAP_X + PAD * 2,`,
  `      height: 1 * (CARD_H + GAP_Y) - GAP_Y + PAD * 2 + LABEL }`,
  `    workspaceList.push(`,
  `      { workspaceId: 'ws-physics', title: '物理备课', path: 'D:/Demo/physics',`,
  `        sessionIds: ['s17', 's18', 's19', 's20'] },`,
  `      { workspaceId: 'ws-travel', title: '旅行计划', path: 'D:/Demo/travel',`,
  `        sessionIds: ['s21', 's22'] },`,
  `    )`,
  `    sessionRows.s17 = session('s17', '力的合成与分解课件', { updatedAt: T0 - 30 * MIN })`,
  `    sessionRows.s18 = session('s18', '力学错题集重排', { updatedAt: T0 - 2 * 60 * MIN, parentId: 's17' })`,
  `    sessionRows.s19 = session('s19', '弹力教学动画脚本', { updatedAt: T0 - 5 * 60 * MIN })`,
  `    sessionRows.s20 = session('s20', '课堂互动问答设计', { updatedAt: T0 - 26 * 60 * MIN })`,
  `    sessionRows.s21 = session('s21', '长沙行程规划', { updatedAt: T0 - 40 * MIN })`,
  `    sessionRows.s22 = session('s22', '车票与预算比价', { updatedAt: T0 - 8 * 60 * MIN })`,
  `    sessionRows.s23 = session('s23', '短视频选题库扩充', { updatedAt: T0 - 55 * MIN })`,
  `    sessionRows.s24 = session('s24', '公众号排版模板', { updatedAt: T0 - 70 * MIN })`,
  `    sessionRows.s25 = session('s25', '组件库升级评估', { updatedAt: T0 - 120 * MIN })`,
  `    demoAdd('s17', 'ws-physics', 0, 0)`,
  `    demoAdd('s18', 'ws-physics', 1, 0)`,
  `    demoAdd('s19', 'ws-physics', 0, 1)`,
  `    demoAdd('s20', 'ws-physics', 1, 1)`,
  `    demoAdd('s21', 'ws-travel', 0, 0)`,
  `    demoAdd('s22', 'ws-travel', 1, 0)`,
  `    // Three free cards off to the side: they belong to no folder, which is`,
  `    // exactly what the loose-card layout looks like on a real board.`,
  `    const demoFree = (sessionId, x, y) => {`,
  '      cards["card-" + (++counter)] = {',
  `        boardId: 'inbox',`,
  `        sessionId,`,
  `        x,`,
  `        y,`,
  `        createdAt: T0,`,
  `      }`,
  `    }`,
  `    demoFree('s23', 140, 1180)`,
  `    demoFree('s24', 140, 1340)`,
  `    demoFree('s25', 412, 1180)`,
  `    Object.assign(userMessages, {`,
  `      s17: '第三章的课件把矢量图换成动画演示',`,
  `      s18: '错题按受力分析、运动合成两类重排',`,
  `      s19: '弹簧那段动画分四步：原长、受压、回弹、振荡衰减',`,
  `      s20: '每讲完一个知识点插两个随堂选择题',`,
  `      s21: '第一天午后到，先排岳麓书院，晚上去坡子街',`,
  `      s22: '高铁和动车差价六十，时间差不多，选哪个',`,
  `      s23: '选题池补十条，按播放潜力排个序',`,
  `      s24: '正文两端对齐，小标题统一加图标前缀',`,
  `      s25: '先升主版本，回归跑一遍再谈细节适配',`,
  `    })`,
  `    // A second stored line plus the derived fork (s17 → s18) so the board`,
  `    // shows both kinds of connection at once.`,
  `    const demoA = Object.entries(cards).find(([, card]) => card?.sessionId === 's20')`,
  `    const demoB = Object.entries(cards).find(([, card]) => card?.sessionId === 's19')`,
  `    if (demoA !== undefined && demoB !== undefined) {`,
  `      edges['edge-demo-teach'] = {`,
  `        boardId: 'inbox',`,
  `        fromCardId: demoA[0],`,
  `        toCardId: demoB[0],`,
  `        injection: { kind: 'digest', autoPush: false },`,
  `      }`,
  `    }`,
  `    // 待发送示例: the composer stores its draft in dsh.conversation.<id>;`,
  `    // seed two so the cards carry the "待发送" chip out of the box.`,
  `    try {`,
  `      const drafts = {`,
  `        s21: '想加一天岳阳楼，预算会不会超',`,
  `        s13: '海报文案先出三版：直给型、悬念型、数据型',`,
  `      }`,
  `      for (const [id, text] of Object.entries(drafts)) {`,
  `        const key = 'dsh.conversation.' + id`,
  `        if (window.localStorage.getItem(key) === null) {`,
  `          window.localStorage.setItem(key, JSON.stringify({ draft: { text } }))`,
  `        }`,
  `      }`,
  `    } catch { /* private mode: no drafts, no crash */ }`,
  `    // 自动保存: mirror the served payload into localStorage on every write,`,
  `    // and re-read it on the next open — the visitor's layout survives reload.`,
  `    sessionsState = { ids: Object.keys(sessionRows), byId: sessionRows }`,
  `    globalThis.__demoStateKey = 'mind_map.demo-state.v1'`,
  `    try {`,
  `      const raw = window.localStorage.getItem(globalThis.__demoStateKey)`,
  `      if (raw !== null) globalThis.__demoSaved = JSON.parse(raw)`,
  `    } catch { globalThis.__demoSaved = null }`,
  `  }`,
])
source = source.replace(tailAnchor, tail)

// ---- 2. payload 建好后应用存档 ----
const payloadAnchor = J([
  '  const payload = {',
  '    boards: { inbox: { name: \'收件箱\', color: \'#888\', order: 0, createdAt: T0 } },',
  '    cards,',
  '    edges,',
  '    digests,',
  '    global: globalState,',
  '  }',
])
if (!source.includes(payloadAnchor)) {
  console.error('payload anchor missing')
  process.exit(1)
}
source = source.replace(payloadAnchor, payloadAnchor + D + J([
  '  // A saved demo layout wins over the freshly built one (cards, edges and',
  '  // the frame/camera globals the visitor moved).',
  '  if (demoMode === true && globalThis.__demoSaved !== undefined && globalThis.__demoSaved !== null) {',
  '    const saved = globalThis.__demoSaved',
  '    if (saved.cards !== undefined) payload.cards = saved.cards',
  '    if (saved.edges !== undefined) payload.edges = saved.edges',
  '    if (saved.digests !== undefined) payload.digests = saved.digests',
  '    if (saved.global !== undefined) payload.global = saved.global',
  '  }',
]))

// ---- 3. POST 变更后写回 ----
const postAnchor = J([
  '      if (path.includes(\'/mind-map/global\') && body !== null && body.global !== undefined) {',
  '        payload.global = body.global',
  '      }',
])
if (!source.includes(postAnchor)) {
  console.error('post anchor missing')
  process.exit(1)
}
source = source.replace(postAnchor, postAnchor + D + J([
  '      if (demoMode === true) {',
  '        try {',
  '          window.localStorage.setItem(globalThis.__demoStateKey ?? \'mind_map.demo-state.v1\',',
  '            JSON.stringify(payload))',
  '        } catch { /* quota: the board still works this session */ }',
  '      }',
]))

if (source === before) {
  console.error('nothing changed')
  process.exit(1)
}
fs.writeFileSync(file, source, 'utf8')
console.log('demo: persistence + drafts + more content')
