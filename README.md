# video-assignment-tools

Tools for reading students' video assignments and drafting follow-up questions to ask each student. Private, created November 24, 2026 as mkuzmick (`ll-26-27/video-assignment-tools`) during the Learning Lab's week 12, and nested in `ll-week-12` at `apps/video-assignment-tools/`.

The first tool is a skill, **`video-assignment-parsing`**:

1. it transcribes each video through HUIT (Harvard's OpenAI Direct gateway, `whisper-1`) and pulls still frames with ffmpeg, up to 8 videos at a time (`--jobs`);
2. Claude reads the transcript and frames and writes timestamped follow-up questions, observations, and a short description as JSON, following a question guide, with one subagent per video in batches of up to 8;
3. a script renders plain HTML pages: the player, the frames, the questions, and the transcript, where any timestamp jumps the video.

## Layout

```
.agents/skills/video-assignment-parsing/   the skill, self-contained
  SKILL.md                                 what Claude follows
  references/follow-up-questions.md        how to write the questions (first draft, to revise)
  scripts/prepare.mjs                      transcripts, frames, manifest  (Node 20+, ffmpeg; no packages)
  scripts/render.mjs                       questions.json etc. -> HTML
  scripts/lib.mjs                          shared helpers, .env loading
.claude/skills/video-assignment-parsing    a link to the folder above, so Claude Code finds it
_videos/                                   student videos go here (gitignored)
_output/                                   everything made from them (gitignored)
.env                                       HUIT_OPENAI_API_KEY (gitignored; see .env.example)
```

**Why both `.agents/` and `.claude/`:** Claude Code looks for project skills only in `.claude/skills/`; Codex and other agents look in `.agents/skills/`. The skill lives in `.agents/skills/` and `.claude/skills/` holds a symlink to it, The Notebook's convention since October 16. To use the skill in another project, copy the whole `video-assignment-parsing` folder into that project's `.agents/skills/` (and link it from `.claude/skills/`), or into `~/.claude/skills/` for every project; it needs nothing else from this repo except a `.env` at that project's root.

## Use

Put videos in `_videos/`, open Claude Code here, and ask it to go through the videos (the skill triggers on that), or run the steps yourself from this folder:

```bash
node .agents/skills/video-assignment-parsing/scripts/prepare.mjs --dry-run
node .agents/skills/video-assignment-parsing/scripts/prepare.mjs --language en
# Claude writes _output/<slug>/questions.json for each video
node .agents/skills/video-assignment-parsing/scripts/render.mjs
open _output/index.html
```

## Privacy

Student videos and everything made from them stay on this machine: `_videos/` and `_output/` are gitignored. Transcription goes only through HUIT. Reading the transcripts and frames to write questions is done by whatever model runs the agent; on a HUIT-only route that step would go through HUIT's Bedrock gateway instead (not built yet).

## Next

- Simple HTML first (Marlon, Nov 24); questions and notes are already JSON, so a React or Next view can render the same files later.
- Possible: more frames at scene changes rather than evenly spaced; chunking for videos over about 70 minutes; a teacher's notes field per question; a HUIT Bedrock route for the question step.
