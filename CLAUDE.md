# Claude instructions — AI Homebrew Club site

## The two-repo system (don't think about deploys — they're automatic)

| Repo | What | Deploys how |
|---|---|---|
| **this repo** (`bb723/ai-homebrew-club`, public) | The site: zero-build HTML on GitHub Pages → **aihomebrewclub.com** | Push to `master` → Pages redeploys itself (~10 min CDN cache) |
| [`bb723/aihc-notes-server`](https://github.com/bb723/aihc-notes-server) (private) | The backend: Express API on Heroku (`aihc-notes`) — RSVPs, invites, notes, chat, hits beacon, AI drafters | Push to its `main` → GitHub Action pushes to Heroku |

If a change needs a new/changed API endpoint, it belongs in `aihc-notes-server`, not here. Never run a manual deploy command for either repo.

Cloud/phone sessions: use the **`aihc` cloud environment** — it carries `HEROKU_API_KEY` (backend logs/releases via the Heroku CLI) and `AIHC_ADMIN`/`AIHC_API` (admin endpoints). Details in `aihc-notes-server/CLAUDE.md`.

## Hard rules

- **Zero-build, forever.** Plain HTML + shared assets. No bundler, framework, or package manager.
- **Never change:** `text/plain` POST bodies (CORS-preflight dodge), localStorage key names (`aihc_viewer_v1` etc.), `DECK_ID` strings, slide ids in invest/charter (they're server-side note keys). The full invariants list lives in **README.md** — read it before structural changes.
- **Cache-bust shared assets:** after editing `assets/*.js|css`, bump the `?v=N` on every tag that loads it.
- **This repo must stay public** — GitHub Pages on the free plan requires it. Never commit secrets (push protection is on, but don't test it). Secrets live in Heroku config vars, never in this repo.
- **No third-party analytics.** Traffic is the first-party beacon in `assets/config.js` (POST /hits) — a deliberate choice. Keep tagging handed-out links with `?ref=`.
- **RSVPs send real email.** Cancel any test RSVPs you create.

## Local dev

`python -m http.server 8000` from the repo root. The backend source is at `~/Desktop/hobbies/aihc-notes-server` on Brett's machine.
