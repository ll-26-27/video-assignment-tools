---
name: video-assignment-parsing
description: Parse students' video assignments and draft follow-up questions to ask each student. Transcribes each video through HUIT (Harvard's OpenAI Direct gateway, whisper-1), pulls still frames with ffmpeg, has Claude read the transcript and frames and write grounded, timestamped follow-up questions as JSON, and renders everything as plain HTML pages with a clickable player. Use when someone has put student videos in _videos/ and asks to transcribe them, go through them, draft questions or feedback prompts, or build the review pages.
---

# Video assignment parsing

Student videos go in `_videos/` at the project root; everything this skill makes goes in `_output/<slug>/`. Both folders are gitignored. The skill is self-contained: its scripts are in `scripts/` beside this file, need only Node 20+ and ffmpeg, and read keys from a `.env` at the project root.

Run every command from the project root. `SKILL` below means this skill's folder (in this repo, `.agents/skills/video-assignment-parsing`).

## Student work stays private

- These are students' videos, faces, and voices. Nothing from `_videos/` or `_output/` gets committed, posted to Slack, uploaded, or sent to any outside service.
- Transcription goes only to HUIT's gateway, which the university approves for this kind of data. Don't switch to OpenRouter, fal, ElevenLabs, or any other transcriber for student work.
- When you write questions, refer to the student as "you" or "the student", not by name, unless the person you are working with asks otherwise.

## Steps

**1. Check the setup.** `ffmpeg -version` works, and `.env` at the root has `HUIT_OPENAI_API_KEY` (see `.env.example`). If the key is missing, say so and run with `--no-transcribe` only if asked.

**2. Prepare: transcripts, frames, manifest.**

```bash
node SKILL/scripts/prepare.mjs --dry-run          # what it would do, for every video in _videos/
node SKILL/scripts/prepare.mjs --language en      # do it
node SKILL/scripts/prepare.mjs _videos/one.mov    # just one
```

Each video gets `_output/<slug>/` with `manifest.json`, `transcript.json` (HUIT's segments, with start and end in seconds), `transcript.md` (`[mm:ss]` per segment), and `frames/` (12 evenly spaced stills by default; `--frames 20` for more). Reruns skip what is done; `--force` redoes it. Pass `--prompt "names, course terms"` if the transcriber is mangling names.

**3. Read each video, then write `questions.json`.** For each `_output/<slug>/`:

1. Read `manifest.json` and `transcript.md` in full.
2. Look at the frames (read the JPGs). The transcript misses everything visual: titles, B-roll, what's on screen, framing, edits. Say what you saw only if you saw it in a frame.
3. If the person you are working with has given you the assignment prompt or what the class was about, use it; otherwise ask once for it before writing, or proceed and say the questions don't know the assignment.
4. Write `_output/<slug>/questions.json` in the shape below, following [the follow-up question guide](references/follow-up-questions.md). Read that guide before writing the first one.

**4. Render the pages.**

```bash
node SKILL/scripts/render.mjs          # every video, plus _output/index.html
node SKILL/scripts/render.mjs <slug>   # one video's page, plus the index
```

Open `_output/index.html` (`open _output/index.html` on a Mac). Each video's page has the player, the frames, the questions with their timestamps, and the transcript; clicking any timestamp or frame jumps the video there.

**5. Report back.** Say how many videos were prepared, any that failed and why (no sound, over 25 MB of audio, a HUIT error), and where the index is. Don't paste the questions into chat unless asked; they're in the pages.

## `questions.json`

```json
{
  "schema": 1,
  "video": "<slug>",
  "written_by": "Claude (<model>), <session id if known>",
  "written_at": "<ISO time>",
  "summary": "Two to four plain sentences on what the video does: its subject, its form, how it's built. Descriptive, not a grade.",
  "observations": [
    { "at": 42.5, "note": "A specific moment worth noticing, and what's there." }
  ],
  "questions": [
    {
      "at": 42.5,
      "question": "The question, as it would be asked to the student.",
      "why": "What it is for: what it might draw out, for the teacher reading it.",
      "kind": "intention"
    }
  ],
  "uncertain": ["Anything the transcript or frames leave unclear, e.g. a word that may be misheard at 01:12."]
}
```

- `at` is seconds into the video, taken from a transcript segment's `start` or a frame's `at` in `manifest.json`; use `null` for a question about the whole piece.
- `kind` is one of `intention`, `process`, `craft`, `ai`, `audience`, `next` (see the guide).
- Aim for five to eight questions per video and up to six observations. Fewer, better questions beat a long list.

Then render (step 4).
