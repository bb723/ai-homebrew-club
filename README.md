# The AI Homebrew Club

A modern revival of the **Homebrew Computer Club** (1975–1986) — the Menlo Park garage meetup where Steve Wozniak demoed the Apple I and handed out its schematics for free — rebuilt for the age of AI.

## The site

`index.html` is a GitHub Pages site with no build step and no dependencies (plus an `assets/` folder holding the walkthrough videos) covering:

- **Origins** — the March 1975 garage meeting, the Altair 8800 spark, and the move to the SLAC auditorium
- **The seven tenets** — "give to help others," radical openness, show-and-tell over lecture, no gatekeeping, hands-on empowerment, community before commerce, and the newsletter
- **How a meeting runs** — Lee Felsenstein's "mapping" and "random access" segments
- **The program** — two deliberately mixed tracks: *Working with Agents* (managing AI like managing people: briefing, delegating, reviewing) and *Staying Human* (judgment, responsibility, what AI is doing to our work and lives), bridged by a house rule — every demo answers "what did this change for you?" and every discussion ends with "what would you actually try?"
- **Then & now** — how each 1975 tenet ports to 2026
- **Getting started** — four steps from zero to your first demo, with video walkthroughs for installing Visual Studio Code (`assets/vs-code-installation.mp4`), installing Claude Code (`assets/installing-claude-code.mp4`), and working with Claude (`assets/working-with-claude.mp4`)

## Publishing to GitHub Pages

This directory is already a git repository with everything committed — `index.html`, `README.md`, and the `assets/` videos all travel together in one push.

1. Create an empty repo on GitHub (e.g. `ai-homebrew-club`)
2. From this directory: `git remote add origin https://github.com/<username>/ai-homebrew-club.git` then `git push -u origin master`
3. In the repo: **Settings → Pages → Deploy from a branch → `master` / root**
4. The site goes live at `https://<username>.github.io/ai-homebrew-club/`

Note: `installing-claude-code.mp4` is 55 MB, so GitHub prints a "large file" warning on push — that's fine, the hard limit is 100 MB. Just don't upload files through the GitHub web UI (it caps at 25 MB); always push with git.

## The motto

> Give to help others.
