// lib.mjs: the shared helpers for this skill's scripts. Node built-ins only, plus ffmpeg/ffprobe.
//
// The project root is the folder you run the scripts from (it holds _videos/ and _output/);
// pass --root to point elsewhere. Keys come from the shell first, then <root>/.env.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const VIDEO_TYPES = new Set(['.mov', '.mp4', '.m4v', '.mkv', '.webm', '.avi'])

// Read KEY=value lines from <root>/.env into process.env, without overriding the shell.
export function loadEnv(root) {
  const file = join(root, '.env')
  if (!existsSync(file)) return null
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || m[1] in process.env) continue
    let value = m[2]
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    process.env[m[1]] = value
  }
  return file
}

// What a dry run shows instead of a key: never any of its characters.
export function mask(key) {
  return key ? `[hidden, ${key.length} characters]` : '[NOT SET]'
}

export function fail(script, message) {
  console.error(`${script}: ${message}`)
  process.exit(1)
}

// Run a command without blocking, so several videos' ffmpeg jobs can run at once.
export function runAsync(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', e => reject(e.code === 'ENOENT' ? new Error(`${cmd} is not installed (brew install ffmpeg)`) : e))
    child.on('close', code => (code === 0 ? resolvePromise(out) : reject(new Error((err || `${cmd} exited ${code}`).trim().split('\n').slice(-3).join('\n')))))
  })
}

// Run worker(item) over items, at most `limit` at a time; results in the items' order.
export async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(lanes)
  return results
}

// Duration, picture size, and whether there is sound.
export async function probe(file) {
  const data = JSON.parse(await runAsync('ffprobe',['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]))
  const streams = data.streams || []
  const video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find(s => s.codec_type === 'audio')
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration)
  return {
    duration: Number.isFinite(duration) ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
  }
}

// 75.4 -> "01:15"; 3725 -> "1:02:05"
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}

// "student-a/Final cut.mov" -> "student-a--final-cut"
export function slugFor(relPath) {
  return relPath
    .replace(/\.[^./]+$/, '')
    .split(/[\\/]+/)
    .map(part => part.toLowerCase().normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean)
    .join('--')
}
