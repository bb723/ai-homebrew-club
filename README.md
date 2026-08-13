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
| `members.html` | The members' hub: greets you by name, links the clubhouse, board, recipes, and the next meetup. The MEMBERS masthead pill lands here |
| `chat.html` | The clubhouse: live chat (WebSocket w/ REST fallback), plus the bulletin-board feed |
| `feed.html` | Redirect stub → `chat.html?room=~feed` (kept so old links work) |
| `deck/admin.html` | Ops console: meetups, attendees, agendas, venues, chat rooms, recipes, printable QR |
| `deck/*.html` | Internal decks: why, join, invest, charter, kit101, funding, model |

### Architecture

Every page is self-contained HTML with a small page-specific `<style>`/`<script>`, standing on shared assets:

- `assets/config.js` — the single source of truth: API base URL, `SITE_HOSTS`, the member nav (`DECKS`), the urn logo, level icons
- `assets/site.css` + `assets/site.js` — the public chassis: Bean Supper tokens (palette/fonts/gingham), header/footer, forms, buttons, and the member hamburger (injected only for devices that have passed the gate)
- `assets/club.css` + `assets/club.js` — the gated chassis: gate overlay, shared pinned notes, slide rail, member nav pane, the `window.AIHC` bridge for page scripts
- `assets/model.js` — the P&L calculator, loaded only by `deck/model.html`
- `assets/qrlib.js`, `assets/fonts/`, `assets/favicon.svg`

Load order contract for gated pages: `club.css` in `<head>` → inline gate markup → page content/styles → page script → `window.AIHC_PAGE = {deck:'<id>'}` → `config.js` → `club.js` last (page scripts poll for `window.AIHC`).

### Backend

One Heroku app (URL in `assets/config.js`), not in this repo. Endpoints used: `GET /events`, `GET /recipes`, `GET/POST /rsvp`, `POST /venues`, `GET/POST /notes`, `GET/POST /posts`, `GET/POST /chat` + `WS /chat/ws`, `GET /attendees`, `GET /rsvps`, `POST /agenda`, `GET/POST /channels`.

**The text/plain trick:** every POST sends `Content-Type: text/plain` with a JSON string body so browsers skip the CORS preflight. Keep it verbatim in any new fetch code.

**Auth model:** a single shared secret typed into the gate doubles as the API token (`?secret=` / `body.secret`). It ships in `club.js`, so treat the gate as a social convention, not security — `robots.txt` + `noindex` keep the gated pages out of crawlers, but real secrecy would need backend work.

### Invariants — do not change these

1. `Content-Type: text/plain` on POSTs (CORS preflight dodge).
2. localStorage keys: `aihc_viewer_v1` (gate session — changing it logs every member out), `aihc_notes_<deck>`, `aihc_model_v1`, `aihc_chat_read_v1`, `aihc_rsvp_<eventId>`, `aihc_prefill_v1`.
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

- GitHub Pages caches assets ~10 minutes. After editing an already-deployed shared asset (`site.css`, `club.js`, …), bump a `?v=N` query on its `<link>`/`<script>` tags if the change must land atomically with the HTML.
- Always push with git, never the GitHub web UI (25 MB upload cap; the walkthrough videos in `assets/` are larger).

The three `assets/*.mp4` walkthrough videos (VS Code install, Claude Code install, working with Claude) are workshop material — nothing on the site links them.
