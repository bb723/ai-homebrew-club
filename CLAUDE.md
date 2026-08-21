# Claude instructions — AI Homebrew Club

One repo, everything in it. Brett's deploy mental model: **push to master and the right thing ships itself — never run a deploy command.**

| Part | Where | Deploys how |
|---|---|---|
| The site (zero-build HTML + `assets/`) | repo root | Push to `master` → GitHub Pages redeploys **aihomebrewclub.com** (~10 min CDN cache) |
| The server (Express + Postgres, Heroku app `aihc-notes`) | `server/` | Push touching `server/**` → `.github/workflows/deploy-server.yml` subtree-pushes to Heroku |

This is production for a real club — RSVPs and invites email real people. Test against a test address and clean up test rows (`aihc_invites`, RSVPs) when done.

## Hard rules — site

- **Zero-build, forever.** Plain HTML + shared assets. No bundler, framework, or package manager for the site.
- **Never change:** `text/plain` POST bodies (CORS-preflight dodge), localStorage key names (`aihc_viewer_v1` etc.), `DECK_ID` strings, slide ids in invest/charter (they're server-side note keys). Full invariants list in **README.md** — read it before structural changes.
- **Cache-bust shared assets:** after editing `assets/*.js|css`, bump the `?v=N` on every tag that loads it.
- **No third-party analytics.** Traffic is the first-party beacon in `assets/config.js` (POST /hits) — deliberate. Keep tagging handed-out links with `?ref=`.

## Hard rules — server (`server/`)

- **Secrets only in Heroku config vars** (`ADMIN_SECRET`, `SECRET`, `ANTHROPIC_API_KEY`, `BREVO_SMTP_USER/KEY`, `DATABASE_URL`, `NOTIFY_EMAIL`, `PORT`). Never hardcode a key or commit a `.env`. This repo is public — push protection is on, but don't test it.
- **The frontend POSTs `text/plain` bodies** — don't add strict content-type checks or break the permissive parsing.
- **Keep the H12 dodge:** AI-drafter endpoints drip whitespace while the model thinks so Heroku's 30s router timeout doesn't kill them.
- **Seeding must stay idempotent:** agendas seed only when an event has no run sheet (reboots must not resurrect placeholders).

## Repo rules

- **This repo must stay public** — GitHub Pages on the free plan requires it.
- History note: `server/` merged in from the archived `bb723/aihc-notes-server` repo (Aug 2026); its pre-merge history lives there.

## Checking on the server

- `heroku logs -a aihc-notes --tail` — live logs
- `heroku releases -a aihc-notes` — deploy history (release description shows the git SHA)

## Cloud sessions (Claude Code on the web / phone)

Start sessions in the **`aihc` cloud environment** — it provides:

- `HEROKU_API_KEY` — the setup script installs the Heroku CLI, which picks this up automatically, so the log/release commands above just work. Without the CLI:
  `curl -s https://api.heroku.com/apps/aihc-notes/releases -H "Authorization: Bearer $HEROKU_API_KEY" -H "Accept: application/vnd.heroku+json; version=3"`
  (logs: POST to `/apps/aihc-notes/log-sessions`, then GET the returned `logplex_url`)
- `AIHC_ADMIN` + `AIHC_API` — bearer token and base URL for the server's admin endpoints (e.g. `curl "$AIHC_API/hits/summary?days=7" -H "Authorization: Bearer $AIHC_ADMIN"` — check server/server.js for each route's exact auth shape before calling).

If those env vars are absent, the session was started in the wrong environment — say so rather than concluding the backend is unreachable.

## Local dev

- Site: `python -m http.server 8000` from the repo root.
- Server: `cd server && npm install && node server.js` (needs the env vars above; usually easier to read logs on Heroku than run it locally).
