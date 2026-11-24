#!/usr/bin/env node
// render.mjs: turn _output/<slug>/ (manifest, transcript, frames, questions.json) into plain HTML:
// _output/<slug>/index.html for each video and _output/index.html listing them all.
// No dependencies, no network. Open _output/index.html in a browser.

import { parseArgs } from 'node:util'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { clock, fail as quit } from './lib.mjs'

const HELP = `Usage: node .claude/skills/video-assignment-parsing/scripts/render.mjs [slug ...] [--root <dir>]

Writes _output/<slug>/index.html for each prepared video (or only the slugs named) and
_output/index.html, the list of all of them. Run from the project root.`

const fail = message => quit('render', message)
let parsed
try {
  parsed = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, help: { type: 'boolean', short: 'h' } } })
} catch (error) {
  fail(`${error.message}\n\n${HELP}`)
}
if (parsed.values.help) { console.log(HELP); process.exit(0) }
const root = resolve(parsed.values.root || process.cwd())
const outputDir = join(root, '_output')

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const readJson = path => readFile(path, 'utf8').then(JSON.parse, () => null)
const seconds = at => (typeof at === 'number' && Number.isFinite(at) ? at : null)

const STYLE = `
:root { --bg:#fbfaf7; --fg:#1d1d1b; --muted:#6b6a65; --line:#e3e0d8; --card:#ffffff; --accent:#b3261e; --chip:#f1eee6; }
@media (prefers-color-scheme: dark) { :root { --bg:#151514; --fg:#ecebe6; --muted:#9c9a92; --line:#2e2d2a; --card:#1d1c1a; --accent:#ff8a80; --chip:#2a2926; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.55 -apple-system, system-ui, "Inter", sans-serif; }
main { max-width:1180px; margin:0 auto; padding:24px 16px 80px; }
h1 { font-size:26px; font-weight:900; margin:0 0 4px; letter-spacing:-0.01em; }
h2 { font-size:15px; font-weight:900; text-transform:uppercase; letter-spacing:0.06em; margin:32px 0 10px; color:var(--muted); }
a { color:inherit; }
.meta { color:var(--muted); font-size:13px; }
.layout { display:grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap:28px; margin-top:20px; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
.sticky { position:sticky; top:16px; align-self:start; }
video { width:100%; background:#000; border-radius:6px; display:block; }
.frames { display:grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap:6px; margin-top:10px; }
.frames button { padding:0; border:0; background:none; cursor:pointer; text-align:left; color:var(--muted); font-size:11px; }
.frames img { width:100%; display:block; border-radius:3px; }
.t { border:0; background:var(--chip); color:var(--fg); font:600 12px/1 ui-monospace, Menlo, monospace; padding:4px 6px; border-radius:4px; cursor:pointer; white-space:nowrap; }
.t:hover { background:var(--accent); color:#fff; }
.summary { font-size:16px; }
ol.questions { padding-left:22px; margin:0; }
ol.questions li { margin:0 0 16px; }
.q { font-size:17px; font-weight:600; }
.why { color:var(--muted); font-size:13px; margin-top:3px; }
.kind { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--accent); margin-left:6px; }
ul.notes { padding-left:18px; }
.transcript p { margin:0 0 6px; }
.transcript p.now { background:var(--chip); border-radius:4px; }
.empty { color:var(--muted); font-style:italic; }
table { border-collapse:collapse; width:100%; }
td, th { text-align:left; padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); }
td img { width:120px; border-radius:3px; display:block; }
`

const SCRIPT = `
const v = document.querySelector('video');
document.addEventListener('click', e => {
  const b = e.target.closest('[data-at]');
  if (!b || !v) return;
  v.currentTime = Number(b.dataset.at); v.play(); window.scrollTo({ top: 0, behavior: 'smooth' });
});
const lines = [...document.querySelectorAll('.transcript p[data-start]')];
v && v.addEventListener('timeupdate', () => {
  for (const p of lines) p.classList.toggle('now', v.currentTime >= +p.dataset.start && v.currentTime < +p.dataset.end);
});
`

const stamp = at => (seconds(at) === null ? '' : `<button class="t" data-at="${seconds(at)}">${clock(at)}</button> `)

function page(title, body, script = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>
`
}

function videoPage(m, transcript, q) {
  const frames = (m.frames || []).map(f => `<button data-at="${f.at}"><img src="${esc(f.file)}" alt="" loading="lazy">${clock(f.at)}</button>`).join('')
  const segs = transcript?.segments?.length
    ? transcript.segments.map(s => `<p data-start="${s.start}" data-end="${s.end}">${stamp(s.start)}${esc(s.text.trim())}</p>`).join('')
    : transcript?.text ? `<p>${esc(transcript.text)}</p>` : '<p class="empty">No transcript yet.</p>'

  let right = '<p class="empty">No questions yet. Claude writes questions.json in this folder, then render.mjs runs again.</p>'
  if (q) {
    const questions = (q.questions || []).map(x => `<li><div class="q">${stamp(x.at)}${esc(x.question)}${x.kind ? `<span class="kind">${esc(x.kind)}</span>` : ''}</div>${x.why ? `<div class="why">${esc(x.why)}</div>` : ''}</li>`).join('')
    const notes = (q.observations || []).map(o => `<li>${stamp(o.at)}${esc(o.note)}</li>`).join('')
    const unsure = (q.uncertain || []).map(u => `<li>${esc(u)}</li>`).join('')
    right = `
      ${q.summary ? `<h2>What the video does</h2><p class="summary">${esc(q.summary)}</p>` : ''}
      <h2>Follow-up questions</h2>${questions ? `<ol class="questions">${questions}</ol>` : '<p class="empty">None.</p>'}
      ${notes ? `<h2>Moments worth noticing</h2><ul class="notes">${notes}</ul>` : ''}
      ${unsure ? `<h2>Unsure</h2><ul class="notes">${unsure}</ul>` : ''}
      <p class="meta">${esc(q.written_by || '')}${q.written_at ? ` · ${esc(q.written_at)}` : ''}</p>`
  }

  const body = `
    <p class="meta"><a href="../index.html">← all videos</a></p>
    <h1>${esc(m.source)}</h1>
    <p class="meta">${m.duration ? clock(m.duration) : ''}${m.width ? ` · ${m.width}×${m.height}` : ''}</p>
    <div class="layout">
      <div class="sticky">
        <video controls preload="metadata" src="${esc(m.video_src)}"></video>
        <div class="frames">${frames}</div>
      </div>
      <div>${right}</div>
    </div>
    <h2>Transcript</h2>
    <div class="transcript">${segs}</div>`
  return page(m.source, body, SCRIPT)
}

const all = (await readdir(outputDir, { withFileTypes: true }).catch(() => fail(`no _output/ folder in ${root}; run prepare.mjs first`)))
  .filter(e => e.isDirectory()).map(e => e.name).sort()
const only = new Set(parsed.positionals)
const rows = []
for (const slug of all) {
  const dir = join(outputDir, slug)
  const m = await readJson(join(dir, 'manifest.json'))
  if (!m) continue
  const transcript = await readJson(join(dir, 'transcript.json'))
  const q = await readJson(join(dir, 'questions.json'))
  if (!only.size || only.has(slug)) {
    await writeFile(join(dir, 'index.html'), videoPage(m, transcript, q))
    console.log(`_output/${slug}/index.html`)
  }
  const thumb = m.frames?.[Math.floor((m.frames.length - 1) / 2)]
  rows.push(`<tr><td>${thumb ? `<a href="${esc(slug)}/index.html"><img src="${esc(slug)}/${esc(thumb.file)}" alt=""></a>` : ''}</td>
    <td><a href="${esc(slug)}/index.html"><strong>${esc(m.source)}</strong></a><div class="meta">${m.duration ? clock(m.duration) : ''}</div></td>
    <td>${transcript ? 'yes' : '<span class="empty">no</span>'}</td>
    <td>${q?.questions?.length ?? '<span class="empty">not yet</span>'}</td>
    <td>${esc(q?.summary || '')}</td></tr>`)
}
await writeFile(join(outputDir, 'index.html'), page('Video assignments', `
  <h1>Video assignments</h1>
  <p class="meta">${rows.length} video${rows.length === 1 ? '' : 's'} · rendered ${new Date().toLocaleString()}</p>
  <table><thead><tr><th></th><th>Video</th><th>Transcript</th><th>Questions</th><th>Summary</th></tr></thead>
  <tbody>${rows.join('') || '<tr><td colspan="5" class="empty">Nothing prepared yet.</td></tr>'}</tbody></table>`))
console.log('_output/index.html')
