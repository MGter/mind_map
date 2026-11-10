/**
 * 生成中文解说语音（edge-tts，晓晓/YunxiNeural，逐段 mp3）。
 *   node scripts/video-narration.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve('video/promo/public/audio')
fs.mkdirSync(OUT, { recursive: true })

const LINES = [
  ['n1', '把每一次对话，铺在一张看得见的地图上。这是 DeepSeek Harness 的思维图插件。'],
  ['n2', '工作区是框架，对话是卡片。拖动即布局，位置永远记得。'],
  ['n3', '一个工作区折进一格。点开抽屉，所有对话一目了然。'],
  ['n4', '搜索直达卡片正文，关键词高亮，回车即达。'],
  ['n5', '谁在运行，谁已完成，谁被搁置。卡片灯牌，一眼可辨。'],
  ['n6', '开源可用。思维图，为注意力而生。'],
]

const voice = process.env.TTS_VOICE ?? 'zh-CN-YunxiNeural'
const rate = process.env.TTS_RATE ?? '+8%'

for (const [name, text] of LINES) {
  const file = path.join(OUT, name + '.mp3')
  if (fs.existsSync(file)) {
    console.log('exists:', name)
    continue
  }
  execFileSync('edge-tts', ['--voice', voice, `--rate=${rate}`, '--text', text, '--write-media', file], { stdio: 'inherit' })
  console.log('tts:', name, fs.statSync(file).size, 'bytes')
}
console.log('narration done')
