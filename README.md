# The AI Homebrew Club

A modern revival of the **Homebrew Computer Club** (1975–1986) — the Menlo Park garage meetup where Steve Wozniak demoed the Apple I and handed out its schematics for free — rebuilt for the age of AI. The club runs free one-hour meetups (the **AI Brown Bag**) in central Maine where neighbors teach neighbors to put AI to work.

> Give to help others.

## The site

Zero-build GitHub Pages site at **aihomebrewclub.com** (see `CNAME`). Plain HTML files plus shared assets — no bundler, no framework, no package manager, ever.

### Page map

**The public funnel**

| Page | Job |
|---|---|
| `index.html` | The invitation. Fills its meetup card live from the calendar — no dates in static HTML |
| `rsvp.html` | Seat reservation; where every QR and shared link lands. `?event=<id>` per meetup, bare URL resolves to the next upcoming one; `?cancel=<id>` from emails; `?ref=` tracks what fills seats |
| `events.html` | The circuit: a hand-drawn Maine map with a pin per chapter town, plus a month calendar of every meetup (town positions live in `CITY_POINTS` in config.js) |
| `waterville.html` | The chapter page: live agendas, seat counts, per-event QR, the record of past meetups |
| `recipes.html` | Public prompt library, managed from the admin console |
| `lend.html` | Venue offers — how new chapters start |

**The members' side** (gate: name + the secret word, handed out at meetups)

| Page | Job |
|---|---|
| `members.html` | The members' hub and the invite-link landing page: greets you by name, links the clubhouse, recipes, and the next meetup; admins also get the board door and the back office here. The MEMBERS masthead pill lands here |
| `chat.html` | The clubhouse: live chat (WebSocket w/ REST fallback), plus the bulletin-board feed |
| `feed.html` | Redirect stub → `chat.html?room=~feed` (kept so old links work) |
| `deck/admin.html` | The back office: a hash-routed console (`#meetups` master→detail with Details / Run sheet / Attendees tabs, `#members`, `#venues`, `#channels`, `#recipes`, `#blocks`, `#word`); the run-sheet builder is shelf · lineup · drafter |
| `deck/*.html` | Internal decks: why, join, invest, charter, kit101, funding, model |

### Architecture

Every page is self-contained HTML with a small page-specific `<style>`/`<script>`, standing on shared assets:

- `assets/config.js` — the single source of truth: API base URL, `SITE_HOSTS`, the one nav (`DECKS`, grouped The club / The back office / The pitches & plans, admin-only entries flagged), `buildDeckPane` (the hamburger) and `buildSideNav` (the shell sidebar), the urn logo, level icons
- `assets/site.css` + `assets/site.js` — the public chassis. The look is "the newsletter and the supper": tokens (paper/ink/tangerine/teal + washes, dark mode), fonts (Besley display, Public Sans body, IBM Plex Mono for data, Caveat for prompts), the masthead + slim/big footers, buttons, tags, the seat meter (`.seats`, one square per chair), the call sheet (`.callsheet`, agendas everywhere), the index card (`.index-card`/`.steal`, ruled hand-written prompts), forms, the 6px gingham runner, layout utilities. `site.js` paints the urn, wires the mobile menu, exposes `AIHC_UI.{$,esc,fmtTime,toast}`, and injects the member hamburger for devices that have passed the gate
- `assets/club.css` + `assets/club.js` — the gated chassis (imports site.css): the split-screen gate (the card stays inline in every page; club.js dresses the frame around it), the **club shell** (`.shell` = 248px `.sidebar` + `.main` with a `.topbar`; used by members.html, chat.html, deck/admin.html — club.js paints `#sideNav` from `DECKS`, pages add groups via `window.AIHC_PAGE.sideExtras` and hook repaints with `AIHC_PAGE.onSideNav`), deck slides, shared pinned notes, slide rail, the `window.AIHC` bridge for page scripts
- `assets/model.js` — the P&L calculator, loaded only by `deck/model.html`
- `assets/qrlib.js`, `assets/fonts/`, `assets/favicon.svg`

Load order contract for gated pages: `club.css` in `<head>` → inline gate markup → page content/styles → page script → `window.AIHC_PAGE = {deck:'<id>'}` → `config.js` → `club.js` last (page scripts poll for `window.AIHC`).

### Backend

One Heroku app (URL in `assets/config.js`), not in this repo. Endpoints used: `GET /events`, `GET /recipes`, `GET/POST /rsvp`, `POST /venues`, `GET/POST /notes`, `GET/POST /posts`, `GET/POST /chat` + `WS /chat/ws`, `GET /attendees`, `GET /rsvps`, `POST /agenda` (incl. `action:'replace'` — the whole run sheet in one transaction), `GET/POST /channels`, `GET/POST /blocks` (the run-sheet block library), `POST /agenda-draft` (AI lineup proposal), `POST /recipes-draft` (AI recipe proposals from the room's RSVP asks), `POST /admin-secret` (self-serve admin-word rotation). Traffic: `POST /hits` (public, cookieless page-view beacon fired from `assets/config.js`; stores page, referrer host, `?ref=` tag, device class, language — never IPs, UAs, or cookies; honors DNT/GPC; bots and >60/min per IP dropped) and `GET /hits/summary?days=N` (admin; feeds the console's `#traffic` panel).

**The run-sheet builder:** meetup content lives as reusable blocks (`aihc_blocks`: title, kind demo/talk/task/admin, minutes, the prompt/script, presenter notes, links) managed in the console's "block shelf" panel. Each event's Agenda panel builds a lineup from those blocks with auto-computed `t` labels (clock times when the event has a `start_time`, else `0:00`-style offsets) and saves through `POST /agenda {action:'replace'}`. The "Draft it for me" button calls `POST /agenda-draft`, which asks `claude-opus-5` (via `@anthropic-ai/sdk`) for a lineup constrained to a JSON schema; it appears only when the server has `ANTHROPIC_API_KEY` set (`heroku config:set ANTHROPIC_API_KEY=<key> -a aihc-notes`) and never writes anything itself — the admin edits, then writes. Writing an agenda can also post the run sheet to the clubhouse (the channel matching the event's city — `#waterville` — else `#general`) so members see it. The recipe box has its own drafter: `POST /recipes-draft` reads the box (no duplicates) and the last 30 RSVPs' "what do you do / what do you want help with" lines (anonymized — names and contacts never leave the server) and proposes 3 recipes the admin can add or edit. Both AI endpoints stream whitespace while the model thinks to dodge Heroku's 30-second H12 router timeout — keep that drip in any new long-running endpoint.

**The text/plain trick:** every POST sends `Content-Type: text/plain` with a JSON string body so browsers skip the CORS preflight. Keep it verbatim in any new fetch code.

**Auth model (two tiers, enforced server-side):**
- **Admins** authenticate with the admin word, resolved in this order: the **DB-stored word** (scrypt hash in `aihc_config.admin_hash`, set from the console's "admin word" panel or the gate's rotate prompt) → the **`ADMIN_SECRET` env var** (kept as a recovery override) → only while *neither* exists, the old burned shared word (and the server emails a daily rotation nag + the gate prompts a change on login). Admin-only surfaces: the feed (`/posts`), attendees/rsvps, venues, notes, events/agenda/recipes/channel writes, the members keyring, the block shelf, the AI drafter.
- **Members** hold personal revocable tokens (`aihc_members` table), minted when an admin marks an RSVP *attended* (the invite emails itself: `members.html?invite=<token>`) or adds someone by hand in the console. Members get chat and member-visible channels; the gate stores the key in `localStorage.aihc_member_v1`.
- Chat rooms have a `visibility` (`members`/`admins`) enforced in listings, history, message writes, WebSocket fan-out, unread timestamps, and presence.
- The credential travels in the same `secret`/`token` body/query slots (or the `X-AIHC-Token` header); `POST /member` validates a token for the gate.

**Rotation runbook** (do this once — easiest path first):
1. Log in to `deck/admin.html` with the old word — the gate itself asks for a new one ("Pick a new admin word"). Or use the console's "The admin word" panel any time. Either way the old word dies everywhere the moment it saves.
2. Give the new word to the founders (or mint them admin-role member keys in the console and skip the word entirely).
3. Recovery fallback: `heroku config:set ADMIN_SECRET=<a strong secret> -a aihc-notes` always works as a second valid admin credential. Later: `heroku config:unset SECRET -a aihc-notes` to delete the dead legacy config.

**Accepted residual risks** (documented on purpose): member tokens are stored plaintext in the DB and shown to admins in the console (proportionate for a two-founder club); anyone holding admin can post under any display name; invites go wherever the RSVP email points, so glance at the address before marking someone attended; presence/revocation socket handling assumes the single Heroku dyno the chat already requires.

### Invariants — do not change these

1. `Content-Type: text/plain` on POSTs (CORS preflight dodge).
2. localStorage keys: `aihc_member_v1` (the personal key/session — changing it logs everyone out), `aihc_viewer_v1` (display-name cache for page scripts), `aihc_notes_<deck>`, `aihc_model_v1`, `aihc_chat_read_v1`, `aihc_rsvp_<eventId>`, `aihc_prefill_v1`.
3. `DECK_ID` strings (`window.AIHC_PAGE.deck`) key server-side note storage.
4. Slide `id`s in `deck/invest.html` and `deck/charter.html` are note-storage keys, not sequence numbers — never renumber them.
5. `deck/admin.html`'s page `<style>` must stay after the `club.css` link (its overrides win by document order).
6. The gate `<div>` stays inline in every gated page so it covers content before JS runs.

### Local development

```
python -m http.server 8000
```

then open `http://localhost:8000` (`localhost` is in `SITE_HOSTS`, so nav behaves like production; `file://` breaks fetch). Pages talk to the live backend — RSVPing sends real email, so test with an obvious name and cancel right after.

### Deploy

Push to `master`; GitHub Pages serves the root. Two cautions:

- GitHub Pages caches assets ~10 minutes. After editing an already-deployed shared asset (`site.css`, `club.js`, …), bump the `?v=N` query on its `<link>`/`<script>` tags (and the `@import` in club.css) if the change must land atomically with the HTML. Currently `?v=3`.
- Always push with git, never the GitHub web UI (25 MB upload cap; the walkthrough videos in `assets/` are larger).

The three `assets/*.mp4` walkthrough videos (VS Code install, Claude Code install, working with Claude) are workshop material — nothing on the site links them.
