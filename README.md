# The AI Homebrew Club

A modern revival of the **Homebrew Computer Club** (1975–1986) — the Menlo Park garage meetup where Steve Wozniak demoed the Apple I and handed out its schematics for free — rebuilt for the age of AI. The club runs free meetups (the **AI Brown Bag**) in Maine, one chapter per town, where neighbors teach neighbors to put AI to work.

> Give to help others.

## The site

Zero-build GitHub Pages site at **aihomebrewclub.com** (see `CNAME`). Plain HTML files plus shared assets — no bundler, no framework, no package manager, ever.

### Page map

**The public funnel**

| Page | Job |
|---|---|
| `index.html` | The invitation. Fills its meetup card live from the calendar — no dates in static HTML |
| `rsvp.html` | Seat reservation; where every QR and shared link lands. `?event=<id>` per meetup, bare URL resolves to the next upcoming one; `?cancel=<id>` from emails; `?ref=` tracks what fills seats |
| `flyer.html` | A print-ready Letter flyer for any meetup, filled from the calendar: `?event=<id>`, `?city=<town>` for that town's next one, bare for the next anywhere. Print it (or Save as PDF) to hand out; on a phone it is a tappable invitation. The printed QR carries `ref=flyer`, the on-screen tap `ref=flyer-link`. Opened from the console's Flyer button; not in the public nav, not indexed |
| `card.html` | The same meetup as a phone-sized picture (1080 x 1350) to text or post: the ticket, the short URL and a QR a friend can scan off the screen (`ref=card`). Same `?event=` / `?city=` rules. Opened from the console's Card button |
| `cards/<event>.png` | That card, rendered: `.github/workflows/render-cards.yml` runs `.github/scripts/render-cards.js` (headless Chrome against `card.html`) every morning, on demand, and when the card's design changes, and commits a PNG per upcoming meetup (past ones are removed; `cards/index.json` remembers what was rendered so unchanged cards are not re-rendered). Text `aihomebrewclub.com/cards/<id>.png` to anyone; the server attaches it to roster notes |
| `events.html` | The circuit: a hand-drawn Maine map with a pin per chapter town, plus a month calendar of every meetup (town positions live in `CITY_POINTS` in config.js) |
| `waterville.html` | Chapter 01, Waterville: the next meetup with its live agenda, seat count and per-event QR, plus the record of past meetups |
| `portland.html` | Chapter 02, Portland: the same live card and record, plus how that table runs (once a month, two hours, twelve seats, project-based) |

Link previews on every page use `share-card.png`, an evergreen card with no date or town on it; `portland.html` uses `share-card-portland.png` (chapter, cadence, venue, still no date) (the dated `invite-card.png` from the first meetup stays in the repo only for old cached links).

Both chapter pages render a series the same way: the next meetup is the raised card with the QR; every later upcoming meetup in that town is a row under "Coming up" with its own RSVP button. The circuit's pin and chapter row report the next meetup's seats, not the series total.
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

- `assets/config.js` — the single source of truth: API base URL, `SITE_HOSTS`, the one nav (`DECKS`, grouped The club / The back office / The pitches & plans, admin-only entries flagged), `buildDeckPane` (the hamburger) and `buildSideNav` (the shell sidebar), the mark (a pinned notice; `paintLogos`), level icons
- `assets/site.css` + `assets/site.js` — the public chassis. The look is **the Bulletin** (Sept 2026; the Bean Supper brand is retired): every page is a dated, numbered notice with a name on it. Tokens: paper/ink, one blue (`--accent`) for every action, link, stamp and filled seat, red pencil (`--alert`) only for full/errors, dark mode as warm-dark paper; the old warm names (`--tangerine`, `--teal`, `--lemon`, `--berry`, `--sky`) are aliases that resolve to the blue or to ink so older page styles keep working. Fonts: IBM Plex Serif for headlines, Plex Sans for body and UI, Plex Mono for times, labels and prompts, all self-hosted in `assets/fonts/` (Besley, Public Sans and Caveat files remain only for the decks until they move). Components: the masthead (the one heavy rule), slim/big footers, rectangular buttons, mono stamps (`.tag`), the seat meter (`.seats`, one square per chair), the run sheet (`.callsheet`, agendas everywhere), the index card (`.index-card`/`.steal`, a typed prompt on ruled lines), forms, layout utilities; `.runner` (the old gingham strip) is kept as a no-op class. `site.js` paints the mark, wires the mobile menu, exposes `AIHC_UI.{$,esc,fmtTime,toast}`, and injects the member hamburger for devices that have passed the gate
- `assets/club.css` + `assets/club.js` — the gated chassis (imports site.css): the split-screen gate (the card stays inline in every page; club.js dresses the frame around it), the **club shell** (`.shell` = 248px `.sidebar` + `.main` with a `.topbar`; used by members.html, chat.html, deck/admin.html — club.js paints `#sideNav` from `DECKS`, pages add groups via `window.AIHC_PAGE.sideExtras` and hook repaints with `AIHC_PAGE.onSideNav`), deck slides, shared pinned notes, slide rail, the `window.AIHC` bridge for page scripts
- `assets/model.js` — the P&L calculator, loaded only by `deck/model.html`
- `assets/qrlib.js`, `assets/fonts/`, `assets/favicon.svg`

Load order contract for gated pages: `club.css` in `<head>` → inline gate markup → page content/styles → page script → `window.AIHC_PAGE = {deck:'<id>'}` → `config.js` → `club.js` last (page scripts poll for `window.AIHC`).

### Adding a chapter

A chapter is one public page plus a few registrations. `portland.html` is the template (Chapter 02); `waterville.html` is the original.

1. Copy `portland.html` to `<town>.html`: set `CITY` in its script, the folio (Chapter NN), the copy, and the masthead's `here` link.
2. `assets/config.js`: add the town to `CITY_POINTS` (x/y on the map's 400×520 viewBox, label, page), to `DECKS` (the members' nav), and to `ROOT_PAGES`.
3. `assets/site.js`: add `<town>.html` to `PAGE_IDS`.
4. Add the town's link to every public masthead (index, events, waterville, portland, recipes, lend; rsvp's carries `data-city` so the page can mark the meetup's own chapter).
5. `server/server.js`: add the town to `CHAPTERS` so confirmations, reminders and calendar invites name the right page and place.
6. Bump `?v=` on config.js and site.js everywhere they load. Then create the first meetup in the console with that city (`city` is what ties an event to its page) and open a `#<town>` room in the clubhouse so run sheets share there automatically.

### Backend

One Heroku app (URL in `assets/config.js`), source in `server/`. Endpoints used: `GET /events`, `GET /recipes`, `GET/POST /rsvp`, `POST /venues`, `GET/POST /notes`, `GET/POST /posts`, `GET/POST /chat` + `WS /chat/ws`, `GET /attendees`, `GET /rsvps`, `POST /agenda` (incl. `action:'replace'` — the whole run sheet in one transaction), `GET/POST /channels`, `GET/POST /blocks` (the run-sheet block library), `POST /agenda-draft` (AI lineup proposal), `POST /recipes-draft` (AI recipe proposals from the room's RSVP asks), `POST /admin-secret` (self-serve admin-word rotation), `GET/POST /roster` (admin: the roster, pause/resume/remove), `GET /roster/optout?t=` and `/roster/optin?t=` (public, token-signed links in roster mail), `GET/POST /rooms` (admin: who holds each town's room, add/remove, plus each upcoming table's answers), `GET /room/confirm?t=&e=` and `/room/problem?t=&e=` (public, token-signed links in the room-check mail). Traffic: `POST /hits` (public, cookieless page-view beacon fired from `assets/config.js`; stores page, referrer host, `?ref=` tag, device class, language — never IPs, UAs, or cookies; honors DNT/GPC; bots and >60/min per IP dropped) and `GET /hits/summary?days=N` (admin; feeds the console's `#traffic` panel).

**Events carry their length.** `aihc_events.minutes` (default 60) sets the calendar invite's end time, the reminders' end time and range, and the "one hour"/"two hours" copy on the RSVP page and the invite ticket; the console's Length field writes it. `CHAPTERS` in server.js maps a city to its public page and its name in mail ("Portland, Maine"); a city not in the map falls back to the circuit and "Maine".

**The run-sheet builder:** meetup content lives as reusable blocks (`aihc_blocks`: title, kind demo/talk/task/admin, minutes, the prompt/script, presenter notes, links) managed in the console's "block shelf" panel. Each event's Agenda panel builds a lineup from those blocks with auto-computed `t` labels (clock times when the event has a `start_time`, else `0:00`-style offsets) and saves through `POST /agenda {action:'replace'}`. The "Draft it for me" button calls `POST /agenda-draft`, which asks `claude-opus-5` (via `@anthropic-ai/sdk`) for a lineup constrained to a JSON schema; it appears only when the server has `ANTHROPIC_API_KEY` set (`heroku config:set ANTHROPIC_API_KEY=<key> -a aihc-notes`) and never writes anything itself — the admin edits, then writes. Writing an agenda can also post the run sheet to the clubhouse (the channel matching the event's city — `#waterville` — else `#general`) so members see it. The recipe box has its own drafter: `POST /recipes-draft` reads the box (no duplicates) and the last 30 RSVPs' "what do you do / what do you want help with" lines (anonymized — names and contacts never leave the server) and proposes 3 recipes the admin can add or edit. Both AI endpoints stream whitespace while the model thinks to dodge Heroku's 30-second H12 router timeout — keep that drip in any new long-running endpoint.

**The roster (opt-in):** every five minutes, after the reminders, `runRoster()` in `server/server.js` does four things. (1) A meetup becomes `past` by itself two hours after it ends (start + `minutes`, or the end of its day when it has no clock time), so the chapter pages, the bare rsvp link and the next step move on without anyone flipping a switch. (2) A town's roster (`aihc_roster`: one row per town and email, with a token that signs the opt-out link) is everyone who ever saved a seat, joined a waitlist or gave a chair back at one of its tables (any `aihc_rsvps` row with an email, past or upcoming) plus anyone invited by hand (`aihc_invites` rows whose `by` is not `note:`, `resched:` or `roster`), plus people added in the console. `last_event` is the latest past table they held a seat at. (3) Nobody is ever seated by the loop. Once per table, as soon as it is the next one on the calendar in its town (marker `roster`), everyone on the roster hears, with a prefilled seat link, the open seat count, a link that works for any neighbor (`ref=friend`) and the card (`cardFor()`: `cards/<id>.png` from the site, then the raw file on GitHub, then the town's evergreen share card; shown inline by `cid` and attached, so it can be texted on). Whoever held a seat at the last table gets it as the thank-you (`Email.thanksEmail`, `ref=thanks`) when that table was within the last three days; everyone else gets the next-table note (`Email.nextTableEmail`, `ref=roster`). If the host marked anyone *attended* for the last table, only those marked get the thank-you. People already on the next table's book, already invited to it by hand, or who gave a chair back for it are skipped and named in the admin note; paused people are left alone. Each note is logged in `aihc_invites` as `by='roster'`. (4) One week out (window `[T-7d, T-6d]`, marker `7d`), everyone in the town hears again, once per table, with the card: the seated that their chair is saved, the waitlist that they are still in line, the rest of the roster how many chairs are open (`ref=week` seat link); people who gave up a chair for that table are skipped. Steps 3 and 4 only send between 9 am and 8 pm Maine time (`Email.maineHour`), so an evening table's notes land the next morning; `runRoster(at)` takes a clock for the tests. A table that starts within 24 hours is left alone. One-time markers share `aihc_reminders` (`roster`, `7d`, `closed`; the old `carry:<lastEvent>` rows from the held-chair era are inert). Opting out stops the notes but leaves any seat already saved. Reminders and roster mail cc `NOTIFY_EMAIL` and carry it as reply-to. The cadence per table, then: the thank-you (or the next-table note) the morning after the previous table, the week-before note, the 12-hour and 1-hour reminders. Keep the next table on the calendar before the current one happens, or the thank-you has nothing to point at and the host gets a nudge instead. **The room check:** whoever holds a town's venue booking (`aihc_room_contacts`: the host's assistant, Brett; added under the roster in the console) gets a separate note when a table's invites go out (`Email.roomEmail`, marker `room`, spent only once someone holds the room) with token-signed one-tap links to confirm the room or flag a problem (`/room/confirm`, `/room/problem`; answers in `aihc_room_checks`, one row per table and holder, and the host hears each answer). A week out (marker `room7d`) anyone who has not confirmed is asked again, and the week-before admin note carries the room status. The console's "Ask them to confirm the next 5 tables" button (`POST /rooms {action:'ask', city, count}`, `askRoomSeries()`) sends each holder one note covering the next tables they have not confirmed (`Email.roomSeriesEmail`): one tap confirms them all (`/room/confirm?e=id1,id2,...`), one line each confirms one, and the per-table `room` markers are spent so the loop does not ask again as each comes up. Console: `#roster` lists the roster by town with pause/resume/remove and add-by-hand, and under it who holds each room with each table's answer. Tests: `server/test/roster.test.js`.

**The text/plain trick:** every POST sends `Content-Type: text/plain` with a JSON string body so browsers skip the CORS preflight. Keep it verbatim in any new fetch code.

**Auth model (two tiers, enforced server-side):**
- **Admins** authenticate with the admin word, resolved in this order: the **DB-stored word** (scrypt hash in `aihc_config.admin_hash`, set from the console's "admin word" panel or the gate's rotate prompt) → the **`ADMIN_SECRET` env var** (kept as a recovery override) → only while *neither* exists, the old burned shared word (and the server emails a daily rotation nag + the gate prompts a change on login). Admin-only surfaces: the feed (`/posts`), attendees/rsvps, venues, notes, events/agenda/recipes/channel writes, the members keyring, the block shelf, the AI drafter.
- **Members** hold personal revocable tokens (`aihc_members` table), minted when an admin marks an RSVP *attended* (marking attendance also decides who carries to the next table; see the roster above) (the invite emails itself: `members.html?invite=<token>`) or adds someone by hand in the console. Members get chat and member-visible channels; the gate stores the key in `localStorage.aihc_member_v1`.
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

- GitHub Pages caches assets ~10 minutes. After editing an already-deployed shared asset (`site.css`, `club.js`, …), bump the `?v=N` query on its `<link>`/`<script>` tags (and the `@import` in club.css) if the change must land atomically with the HTML. Currently `site.css`/`club.css` `?v=4`, `site.js` `?v=5` and `config.js` `?v=6` (deck pages still reference the older tags until the decks move to the Bulletin).
- Always push with git, never the GitHub web UI (25 MB upload cap; the walkthrough videos in `assets/` are larger).

The three `assets/*.mp4` walkthrough videos (VS Code install, Claude Code install, working with Claude) are workshop material — nothing on the site links them.
