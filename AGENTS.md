# video-assignment-tools: instructions for agents

This repo holds tools for reading students' video assignments. Read `README.md` first.

- **The skill** is `.agents/skills/video-assignment-parsing/` (linked from `.claude/skills/`). When asked to go through, transcribe, or write questions about the videos, follow its `SKILL.md`. Keep the skill self-contained: every script it needs lives in its own `scripts/` folder, uses Node built-ins and ffmpeg only, and reads keys from the project root's `.env`. Don't make it depend on anything outside its folder.
- **Student work is private.** `_videos/` and `_output/` are gitignored and stay that way. Never commit, post, upload, or paste student videos, transcripts, frames, or questions anywhere outside this machine, and never send them to a service other than HUIT. Don't use students' names in what you write unless asked.
- **Keys** live only in the gitignored `.env` (names in `.env.example`). Never print or commit them.
- Commit to `main` and push; this repo is a submodule of `ll-26-27/ll-week-12`, so after pushing here, commit the pointer there, then in The Notebook.
- Shorten Learning Lab as "the LL", never "the Lab".
- Write Markdown prose without hard wraps.
