#!/usr/bin/env node
// prepare.mjs: for each student video, make _output/<slug>/ with a HUIT transcript, still frames,
// and a manifest. Claude reads those to write questions.json; render.mjs turns them into HTML.
//
// Transcription goes only to HUIT's OpenAI Direct gateway (whisper-1). Frames are made locally
// with ffmpeg and never sent anywhere by this script.

import { parseArgs } from 'node:util'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, relative, resolve } from 'node:path'
import { VIDEO_TYPES, clock, fail as quit, loadEnv, mask, pool, probe, runAsync, slugFor } from './lib.mjs'

const HELP = `Usage: node .claude/skills/video-assignment-parsing/scripts/prepare.mjs [video ...] [options]

Run from the project root (the folder with _videos/ and _output/). With no video named, every
video under _videos/ is prepared. For each one, writes _output/<slug>/:

  manifest.json      source, duration, picture size, frames, what was made and when
  transcript.json    HUIT's verbose_json response (segments with start and end times)
  transcript.md      the transcript with a [mm:ss] before each segment
  frames/            still frames, evenly spaced (frame-01-00m05s.jpg ...)

Videos are worked on in parallel, up to --jobs at a time (default 8); within each video the
transcription and the stills run at the same time. Steps already done are skipped, so a rerun
only fills gaps.

Options:
  --jobs <n>          how many videos at once (default 8)
  --frames <n>        how many stills per video (default 12)
  --language <code>   language of the speech, e.g. en (helps accuracy)
  --prompt <text>     spelling hints for the transcriber: names, course terms
  --no-transcribe     frames and manifest only
  --force             redo transcripts and frames that already exist
  --dry-run           show what would happen (key masked); send and write nothing
  --root <dir>        the project root (default: the current folder)
  -h, --help          this help

Keys (shell first, then <root>/.env):
  HUIT_OPENAI_API_KEY    your OpenAI Direct key from the Harvard API Portal
  HUIT_OPENAI_BASE_URL   default https://apis.huit.harvard.edu/ais-openai-direct/v2

HUIT's limit is 25 MB of audio per request; the sound is sent as mono 16 kHz MP3 at 48 kbps,
which is about 70 minutes.`

const DEFAULT_BASE = 'https://apis.huit.harvard.edu/ais-openai-direct/v2'
const MAX_BYTES = 25 * 1024 * 1024
const fail = message => quit('prepare', message)
const exists = path => access(path).then(() => true, () => false)
const say = (message, tag) => console.error(`prepare: ${tag ? `[${tag}] ` : ''}${message}`)

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      jobs: { type: 'string', default: '8' },
      frames: { type: 'string', default: '12' },
      language: { type: 'string' },
      prompt: { type: 'string' },
      'no-transcribe': { type: 'boolean' },
      force: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
} catch (error) {
  fail(`${error.message}\n\n${HELP}`)
}
const { values: opt, positionals } = parsed
if (opt.help) { console.log(HELP); process.exit(0) }

const root = resolve(opt.root || process.cwd())
const videosDir = join(root, '_videos')
const outputDir = join(root, '_output')
const frameCount = Number.parseInt(opt.frames, 10)
if (!Number.isInteger(frameCount) || frameCount < 0 || frameCount > 200) fail('--frames takes a number from 0 to 200')
const jobs = Number.parseInt(opt.jobs, 10)
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) fail('--jobs takes a number from 1 to 32')
const envFile = loadEnv(root)

async function findVideos(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await findVideos(path))
    else if (VIDEO_TYPES.has(extname(entry.name).toLowerCase())) found.push(path)
  }
  return found.sort()
}

const videos = positionals.length ? positionals.map(p => resolve(p)) : await findVideos(videosDir)
if (!videos.length) fail(`no videos found in ${relative(process.cwd(), videosDir) || videosDir}/ (looking for ${[...VIDEO_TYPES].join(' ')})`)

const key = process.env.HUIT_OPENAI_API_KEY
const base = (process.env.HUIT_OPENAI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
const url = `${base}/audio/transcriptions`
if (!opt['no-transcribe'] && !opt['dry-run'] && !key) {
  fail(`HUIT_OPENAI_API_KEY is not set. Put it in ${join(root, '.env')} (see .env.example), or pass --no-transcribe.`)
}

function transcriptMarkdown(source, data) {
  const lines = [
    `# Transcript: ${source}`,
    '',
    `- model: whisper-1 (HUIT OpenAI Direct)`,
    `- language: ${data.language ?? 'unknown'}`,
    `- duration: ${typeof data.duration === 'number' ? clock(data.duration) : 'unknown'}`,
    `- transcribed: ${new Date().toISOString()}`,
    '',
    '---',
    '',
  ]
  if (Array.isArray(data.segments) && data.segments.length) {
    for (const seg of data.segments) lines.push(`[${clock(seg.start)}] ${seg.text.trim()}`, '')
  } else {
    lines.push((data.text ?? '').trim() || '(no speech found)', '')
  }
  return lines.join('\n')
}

async function transcribe(file, outDir, info, tag) {
  const jsonPath = join(outDir, 'transcript.json')
  const mdPath = join(outDir, 'transcript.md')
  if (!opt.force && await exists(jsonPath)) { say(`transcript: already there`, tag); return 'kept' }
  if (!info.hasAudio) { say(`transcript: no sound track, skipped`, tag); return 'no-audio' }

  const fields = { model: 'whisper-1', response_format: 'verbose_json', 'timestamp_granularities[]': 'segment' }
  if (opt.language) fields.language = opt.language
  if (opt.prompt) fields.prompt = opt.prompt
  if (opt['dry-run']) {
    say(`transcript: would POST the sound (mono 16 kHz MP3) to ${url} with api-key ${mask(key)} and ${JSON.stringify(fields)}`, tag)
    return 'dry-run'
  }

  const scratch = await mkdtemp(join(tmpdir(), 'video-assignment-'))
  try {
    const audioPath = join(scratch, 'sound.mp3')
    await runAsync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audioPath])
    const bytes = await readFile(audioPath)
    if (bytes.length > MAX_BYTES) throw new Error(`the sound is ${(bytes.length / 1048576).toFixed(1)} MB; HUIT's limit is 25 MB (about 70 minutes). Split the video first.`)
    const form = new FormData()
    form.set('file', new Blob([bytes], { type: 'audio/mpeg' }), `${basename(file, extname(file))}.mp3`)
    for (const [name, value] of Object.entries(fields)) form.set(name, value)
    say(`transcript: sending ${(bytes.length / 1024).toFixed(0)} KB of sound to HUIT`, tag)
    const started = Date.now()
    const response = await fetch(url, { method: 'POST', headers: { 'api-key': key }, body: form })
    const body = await response.text()
    if (!response.ok) throw new Error(`HUIT answered HTTP ${response.status}: ${body.split(key).join('[key]').slice(0, 800)}`)
    const data = JSON.parse(body)
    await writeFile(jsonPath, JSON.stringify(data, null, 2) + '\n')
    await writeFile(mdPath, transcriptMarkdown(basename(file), data))
    say(`transcript: done in ${((Date.now() - started) / 1000).toFixed(1)}s, ${data.segments?.length ?? 0} segments`, tag)
    return 'made'
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function frames(file, outDir, info, tag) {
  const dir = join(outDir, 'frames')
  if (!info.hasVideo || !info.duration || frameCount === 0) return []
  const list = []
  for (let i = 0; i < frameCount; i++) {
    const at = Math.min(info.duration - 0.05, ((i + 0.5) * info.duration) / frameCount)
    const t = Math.floor(at)
    const name = `frame-${String(i + 1).padStart(2, '0')}-${String(Math.floor(t / 60)).padStart(2, '0')}m${String(t % 60).padStart(2, '0')}s.jpg`
    list.push({ file: `frames/${name}`, at: Number(at.toFixed(2)) })
  }
  if (opt['dry-run']) { say(`frames: would write ${list.length} stills to frames/`, tag); return list }
  await mkdir(dir, { recursive: true })
  let made = 0
  for (const f of list) {
    const path = join(outDir, f.file)
    if (!opt.force && await exists(path)) continue
    await runAsync('ffmpeg', ['-v', 'error', '-y', '-ss', String(f.at), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', path])
    made++
  }
  say(`frames: ${made} made, ${list.length - made} already there`, tag)
  return list
}

async function prepareOne(file) {
  const info0 = await stat(file).catch(() => null)
  if (!info0?.isFile()) { say(`skipping ${file}: not found`); return { file, error: 'not found' } }
  const rel = file.startsWith(videosDir + '/') ? relative(videosDir, file) : basename(file)
  const slug = slugFor(rel)
  const outDir = join(outputDir, slug)
  say(`${rel} -> _output/${slug}/`, slug)
  let info
  try { info = await probe(file) } catch (error) { say(`couldn't read it: ${error.message}`, slug); return { rel, slug, error: error.message } }
  if (!opt['dry-run']) await mkdir(outDir, { recursive: true })

  // Stills and transcript at the same time.
  const [frameList, transcript] = await Promise.all([
    frames(file, outDir, info, slug).catch(error => { say(`frames failed: ${error.message}`, slug); return [] }),
    opt['no-transcribe'] ? 'skipped' : transcribe(file, outDir, info, slug).catch(error => { say(`transcript failed: ${error.message}`, slug); return 'failed' }),
  ])

  const manifestPath = join(outDir, 'manifest.json')
  const previous = await readFile(manifestPath, 'utf8').then(JSON.parse, () => ({}))
  const manifest = {
    schema: 1,
    slug,
    source: rel,
    // Where the video sits relative to this folder, for the HTML player.
    video_src: relative(outDir, file).split('\\').join('/'),
    duration: info.duration,
    width: info.width,
    height: info.height,
    has_audio: info.hasAudio,
    frames: frameList,
    transcript: (await exists(join(outDir, 'transcript.md'))) ? 'transcript.md' : null,
    questions: (await exists(join(outDir, 'questions.json'))) ? 'questions.json' : null,
    created: previous.created ?? new Date().toISOString(),
    updated: new Date().toISOString(),
  }
  if (!opt['dry-run']) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  say('done', slug)
  return { rel, slug, duration: info.duration, frames: frameList.length, transcript }
}

if (envFile) say(`keys from ${relative(process.cwd(), envFile) || envFile}`)
say(`${videos.length} video${videos.length === 1 ? '' : 's'}, up to ${Math.min(jobs, videos.length)} at a time`)
const started = Date.now()
const results = await pool(videos, jobs, prepareOne)
say(`all done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(JSON.stringify(results, null, 2))
if (!opt['dry-run']) say(`next: read each _output/<slug>/transcript.md and frames, write questions.json, then run render.mjs`)
