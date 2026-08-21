const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
/* legacy shared word: publicly burned; acts as the admin credential ONLY until
   ADMIN_SECRET is set (that config:set IS the rotation switch) */
const SECRET = (process.env.SECRET || 'sprinkles').toLowerCase();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
/* (the "still on the legacy word" warning fires in init(), once the db-stored
   admin hash has been checked too) */

/* ai run-sheet drafting: no-op until ANTHROPIC_API_KEY is configured */
const AI_KEY = process.env.ANTHROPIC_API_KEY || '';
let aiClient = null;
function ai() {
  if (!AI_KEY) return null;
  if (!aiClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    aiClient = new Anthropic();
  }
  return aiClient;
}

/* email notifications: no-op until BREVO_SMTP_KEY is configured */
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';
const mailer = process.env.BREVO_SMTP_KEY && process.env.BREVO_SMTP_USER
  ? nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_KEY,
      },
    })
  : null;
function notify(subject, text) {
  if (!mailer) return;
  mailer
    .sendMail({ from: `"The AI Homebrew Club" <${NOTIFY_EMAIL}>`, to: NOTIFY_EMAIL, subject, text })
    .catch(err => console.error('mail failed:', err.message));
}
function mailTo(to, subject, text, attachments) {
  if (!mailer || !to) return;
  mailer
    .sendMail({ from: `"The AI Homebrew Club" <${NOTIFY_EMAIL}>`, to, subject, text, attachments })
    .catch(err => console.error('mail failed:', err.message));
}

/* calendar helpers: Maine time; DST approximated by month (Apr-Oct = EDT) */
function eventStartUtc(ev) {
  if (!ev.sort_date || !ev.start_time || !/^\d{1,2}:\d{2}$/.test(ev.start_time)) return null;
  const m = parseInt(ev.sort_date.slice(5, 7), 10);
  const offset = (m >= 4 && m <= 10) ? 4 : 5;
  const [h, min] = ev.start_time.split(':').map(Number);
  return new Date(Date.UTC(
    parseInt(ev.sort_date.slice(0, 4), 10), m - 1, parseInt(ev.sort_date.slice(8, 10), 10),
    h + offset, min
  ));
}
function calStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function gcalUrl(ev, eventId) {
  const start = eventStartUtc(ev);
  let dates;
  if (start) {
    dates = calStamp(start) + '/' + calStamp(new Date(start.getTime() + 3600000));
  } else if (ev.sort_date) {
    const d0 = ev.sort_date.replace(/-/g, '');
    const next = new Date(Date.UTC(
      parseInt(ev.sort_date.slice(0, 4), 10), parseInt(ev.sort_date.slice(5, 7), 10) - 1,
      parseInt(ev.sort_date.slice(8, 10), 10) + 1
    ));
    dates = d0 + '/' + next.toISOString().slice(0, 10).replace(/-/g, '');
  } else return null;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(ev.title) +
    '&dates=' + dates +
    '&location=' + encodeURIComponent(ev.location) +
    '&details=' + encodeURIComponent('One hour, coffee on. Bring a laptop or your phone and one real task. Agenda: https://aihomebrewclub.com/waterville.html');
}
function icsText(ev, eventId) {
  const start = eventStartUtc(ev);
  let dt;
  if (start) {
    dt = 'DTSTART:' + calStamp(start) + '\r\nDTEND:' + calStamp(new Date(start.getTime() + 3600000));
  } else if (ev.sort_date) {
    dt = 'DTSTART;VALUE=DATE:' + ev.sort_date.replace(/-/g, '');
  } else return null;
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AIHC//meetup//EN\r\nBEGIN:VEVENT\r\n' +
    'UID:' + eventId + '@aihomebrewclub.com\r\n' + dt + '\r\n' +
    'SUMMARY:' + ev.title + '\r\nLOCATION:' + ev.location.replace(/,/g, '\\,') + '\r\n' +
    'DESCRIPTION:One hour\\, coffee on. Agenda: https://aihomebrewclub.com/waterville.html\r\n' +
    'END:VEVENT\r\nEND:VCALENDAR\r\n';
}
function cancelUrl(eventId, rsvpId) {
  return 'https://aihomebrewclub.com/rsvp.html?event=' + eventId + '&cancel=' + rsvpId;
}
function fmtTime(t) {
  if (!/^\d{1,2}:\d{2}$/.test(t || '')) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-AIHC-Token');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_notes (
      id    text PRIMARY KEY,
      deck  text NOT NULL,
      slide text NOT NULL,
      x     real NOT NULL,
      y     real NOT NULL,
      name  text NOT NULL,
      body  text NOT NULL,
      ts    text NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_events (
      id        text PRIMARY KEY,
      city      text NOT NULL DEFAULT 'waterville',
      title     text NOT NULL,
      when_text text NOT NULL,
      sort_date text NOT NULL DEFAULT '',
      location  text NOT NULL,
      capacity  integer NOT NULL DEFAULT 8,
      status    text NOT NULL DEFAULT 'upcoming',
      ts        text NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_agenda_items (
      id     text PRIMARY KEY,
      event  text NOT NULL,
      pos    integer NOT NULL DEFAULT 0,
      t      text NOT NULL DEFAULT '',
      title  text NOT NULL,
      detail text NOT NULL DEFAULT ''
    )
  `);
  /* migrate the original hardcoded event into the database */
  await pool.query(`
    INSERT INTO aihc_events (id, city, title, when_text, sort_date, location, capacity, status, ts)
    VALUES ('aug18-bricks', 'waterville', 'The first AI Brown Bag', 'Tuesday, August 18',
            '2026-08-18', 'the conference room at Bricks Coworking, 10 Water St, Waterville', 8,
            'upcoming', '2026-08-05T17:00:00Z')
    ON CONFLICT (id) DO NOTHING
  `);
  /* seed the very first run sheet only while the event has none at all: once a real
     one is written (or the seeds are cleared) a reboot must not bring these back */
  await pool.query(`
    INSERT INTO aihc_agenda_items (id, event, pos, t, title, detail)
    SELECT v.id, v.event, v.pos, v.t, v.title, v.detail FROM (VALUES
      ('seed-ag1', 'aug18-bricks', 1, '0:00', 'Find your seat', 'Coffee on. Say hi, grab a chair, get on the wifi.'),
      ('seed-ag2', 'aug18-bricks', 2, '0:05', 'Meet and greet', 'Who you are, what you do, and the one task eating your week.'),
      ('seed-ag3', 'aug18-bricks', 3, '0:15', 'Tasks, worked live', 'Real tasks from the room, done together on a phone or laptop. Receipts, reviews, estimates, listings.'),
      ('seed-ag4', 'aug18-bricks', 4, '0:50', 'Steal-this-prompts', 'Every recipe we used, written down and yours to keep. Questions welcome.'),
      ('seed-ag5', 'aug18-bricks', 5, '1:00', 'Out the door', 'One hour means one hour.')
    ) AS v(id, event, pos, t, title, detail)
    WHERE NOT EXISTS (SELECT 1 FROM aihc_agenda_items WHERE event = 'aug18-bricks')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_recipes (
      id       text PRIMARY KEY,
      title    text NOT NULL,
      category text NOT NULL DEFAULT 'General',
      problem  text NOT NULL DEFAULT '',
      prompt   text NOT NULL,
      notes    text NOT NULL DEFAULT '',
      name     text NOT NULL DEFAULT '',
      ts       text NOT NULL
    )
  `);
  await pool.query(`
    INSERT INTO aihc_recipes (id, title, category, problem, prompt, notes, name, ts) VALUES
    ('seed-r1', 'The late-payment reminder', 'Money in the door',
     'An invoice is 30 days past due and you keep putting off the awkward email.',
     'Write a friendly but firm payment reminder for the invoice below. Keep it under 120 words, assume good faith, give them one easy next step, and do not apologize for asking. [paste who, amount, due date, and what the work was]',
     'Works for estimates that went quiet too. Swap the last line for: want me to just resend the invoice?',
     'The 101 kit', '2026-08-05T18:00:00Z'),
    ('seed-r2', 'The one-star review reply', 'Reviews and replies',
     'A rough review is sitting on your page and everything you draft sounds defensive.',
     'Here is a negative review of my business. Draft two things: a short public reply that is calm, owns what we could have done better without admitting fault, and invites them to talk offline; and a private message to send them directly. My tone: neighborly, no corporate speak. [paste the review]',
     'Post the public one, send the private one the same day.',
     'The 101 kit', '2026-08-05T18:00:00Z'),
    ('seed-r3', 'The receipt pile', 'Paperwork',
     'A shoebox of receipts needs to become something your bookkeeper can use.',
     'Here are photos of my receipts. Turn them into a table with date, vendor, amount, payment method, and a suggested expense category. Flag anything you cannot read instead of guessing.',
     'Photograph five to ten at a time in good light. The flagship 101 demo.',
     'The 101 kit', '2026-08-05T18:00:00Z')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_rsvps (
      id      text PRIMARY KEY,
      event   text NOT NULL,
      name    text NOT NULL,
      contact text NOT NULL,
      biz     text NOT NULL DEFAULT '',
      note    text NOT NULL DEFAULT '',
      status  text NOT NULL,
      ts      text NOT NULL
    )
  `);
  await pool.query("ALTER TABLE aihc_rsvps ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE aihc_rsvps ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE aihc_rsvps ADD COLUMN IF NOT EXISTS ref text NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE aihc_rsvps ADD COLUMN IF NOT EXISTS guest_name text NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE aihc_events ADD COLUMN IF NOT EXISTS start_time text NOT NULL DEFAULT ''");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_venues (
      id     text PRIMARY KEY,
      name   text NOT NULL,
      email  text NOT NULL DEFAULT '',
      phone  text NOT NULL DEFAULT '',
      venue  text NOT NULL,
      town   text NOT NULL,
      seats  integer NOT NULL DEFAULT 0,
      notes  text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'offered',
      ref    text NOT NULL DEFAULT '',
      ts     text NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_reminders (
      event text NOT NULL,
      kind  text NOT NULL,
      ts    text NOT NULL,
      PRIMARY KEY (event, kind)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_posts (
      id      text PRIMARY KEY,
      name    text NOT NULL,
      title   text NOT NULL DEFAULT '',
      body    text NOT NULL,
      more    text NOT NULL DEFAULT '',
      kind    text NOT NULL DEFAULT 'update',
      tags    text NOT NULL DEFAULT '',
      notable boolean NOT NULL DEFAULT false,
      ts      text NOT NULL
    )
  `);
  /* the clubhouse: channels, messages, reactions. presence lives in memory only. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_channels (
      id     text PRIMARY KEY,
      name   text NOT NULL,
      topic  text NOT NULL DEFAULT '',
      pos    integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open',
      ts     text NOT NULL
    )
  `);
  await pool.query(`
    INSERT INTO aihc_channels (id, name, topic, pos, status, ts) VALUES
    ('general', 'general', 'The coffee urn. Anything goes.', 1, 'open', '2026-08-11T00:00:00Z'),
    ('recipes', 'recipes', 'Prompts that worked, prompts that flopped.', 2, 'open', '2026-08-11T00:00:00Z')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_messages (
      id      text PRIMARY KEY,
      channel text NOT NULL,
      parent  text NOT NULL DEFAULT '',
      name    text NOT NULL,
      body    text NOT NULL,
      ts      text NOT NULL
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS aihc_messages_chan_ts ON aihc_messages (channel, ts)');
  await pool.query('CREATE INDEX IF NOT EXISTS aihc_messages_parent ON aihc_messages (parent)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_reactions (
      message text NOT NULL,
      name    text NOT NULL,
      emoji   text NOT NULL,
      ts      text NOT NULL,
      PRIMARY KEY (message, name, emoji)
    )
  `);
  /* members: personal, revocable clubhouse keys. minted when an rsvp is marked
     attended, or added by hand from the console. token is the credential. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_members (
      id     text PRIMARY KEY,
      name   text NOT NULL,
      email  text NOT NULL DEFAULT '',
      token  text NOT NULL,
      role   text NOT NULL DEFAULT 'member',
      status text NOT NULL DEFAULT 'active',
      source text NOT NULL DEFAULT '',
      ts     text NOT NULL
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS aihc_members_token ON aihc_members (token)');
  /* one active membership per email: makes double-mint a db-level no-op, not a race */
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS aihc_members_active_email
    ON aihc_members (lower(email)) WHERE status = 'active' AND email <> ''
  `);
  await pool.query('ALTER TABLE aihc_rsvps ADD COLUMN IF NOT EXISTS attended boolean NOT NULL DEFAULT false');
  /* invites: the console's "fill the table" mailer. one row per (event, email) so
     the book remembers who was asked and when, and never double-mails by accident */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_invites (
      id    text PRIMARY KEY,
      event text NOT NULL,
      email text NOT NULL,
      name  text NOT NULL DEFAULT '',
      by    text NOT NULL DEFAULT '',
      ts    text NOT NULL
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS aihc_invites_event ON aihc_invites (event, lower(email))');
  await pool.query("ALTER TABLE aihc_channels ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'members'");
  /* author = member id (or 'admin'); real ownership for deletes, name stays display-only */
  await pool.query("ALTER TABLE aihc_messages ADD COLUMN IF NOT EXISTS author text NOT NULL DEFAULT ''");
  /* run-sheet blocks: the reusable content shelf meetup agendas are built from */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_blocks (
      id      text PRIMARY KEY,
      title   text NOT NULL,
      kind    text NOT NULL DEFAULT 'demo',
      minutes integer NOT NULL DEFAULT 10,
      prompt  text NOT NULL DEFAULT '',
      notes   text NOT NULL DEFAULT '',
      links   text NOT NULL DEFAULT '',
      status  text NOT NULL DEFAULT 'active',
      pos     integer NOT NULL DEFAULT 0,
      ts      text NOT NULL
    )
  `);
  await pool.query(
    `INSERT INTO aihc_blocks (id, title, kind, minutes, prompt, notes, links, pos, ts) VALUES
      ('seed-bk1','Find your seat','admin',5,'','Doors open, name tags, coffee on. Start on time.','',1,$1),
      ('seed-bk2','Meet and greet','admin',10,'','Around the table: name, what you do, one thing you want AI to take off your plate.','',2,$1),
      ('seed-bk3','The demo','demo',10,'','One real task done live with AI, start to finish. No slides.','',3,$1),
      ('seed-bk4','Tasks, worked live','task',30,'','Real tasks from the room, done together. Two or three volunteers.','',4,$1),
      ('seed-bk5','Steal these prompts','admin',5,'','Hand out the recipe cards, point at the recipe box, out the door on time.','',5,$1)
     ON CONFLICT (id) DO NOTHING`,
    [new Date().toISOString()]
  );
  /* config: tiny key/value drawer. first key: admin_hash (scrypt salt:hash of the
     admin word, set from the console - self-serve rotation without a heroku cli) */
  await pool.query('CREATE TABLE IF NOT EXISTS aihc_config (k text PRIMARY KEY, v text NOT NULL)');
  const cfgQ = await pool.query("SELECT v FROM aihc_config WHERE k = 'admin_hash'");
  adminHash = cfgQ.rows.length ? cfgQ.rows[0].v : '';
  if (!ADMIN_SECRET && !adminHash) {
    console.warn('*** ADMIN AUTH IS THE BURNED LEGACY WORD - set a new one from the admin console (or heroku config:set ADMIN_SECRET=...) ***');
  }
  await reloadChannelVis();
  /* hits: first-party, cookieless page views. what we keep: page, referrer host,
     the ?ref= tag, a device class, and the hour. what we never keep: IPs, user
     agents, cookies, or anything that follows one person around. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aihc_hits (
      id     bigserial PRIMARY KEY,
      ts     timestamptz NOT NULL DEFAULT now(),
      page   text NOT NULL,
      ref    text NOT NULL DEFAULT '',
      src    text NOT NULL DEFAULT '',
      dev    text NOT NULL DEFAULT '',
      lang   text NOT NULL DEFAULT ''
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS aihc_hits_ts ON aihc_hits (ts)');
}

/* ---- auth: one opaque credential slot resolves to a role ----
   admin = the db-stored word (scrypt hash, set from the console), or the
   ADMIN_SECRET env var (kept forever as a recovery override), or - only while
   NEITHER exists - the burned legacy word.
   member = a personal token from aihc_members (minted on attendance). */
let adminHash = '';                 // 'salt:hash' hex from aihc_config, loaded at init
const adminCredCache = new Set();   // words already scrypt-verified this process
function hashWord(word, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(String(word), salt, 32).toString('hex');
}
function matchesHash(c, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 2) return false;
  const test = crypto.scryptSync(String(c), Buffer.from(parts[0], 'hex'), 32);
  const want = Buffer.from(parts[1], 'hex');
  return test.length === want.length && crypto.timingSafeEqual(test, want);
}
function isAdminCred(c) {
  const s = String(c);
  if (adminHash) {
    if (adminCredCache.has(s)) return true;
    if (matchesHash(s, adminHash)) { adminCredCache.add(s); return true; }
  }
  if (ADMIN_SECRET) {
    const a = Buffer.from(s), b = Buffer.from(ADMIN_SECRET);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (adminHash) return false; /* a real word exists: the legacy word is dead */
  return s.toLowerCase() === SECRET;
}
async function roleFor(cred) {
  const c = String(cred || '').trim();
  if (!c) return null;
  if (isAdminCred(c)) return { role: 'admin', name: 'The club', memberId: 'admin' };
  const q = await pool.query(
    "SELECT id, name, email, role FROM aihc_members WHERE token = $1 AND status = 'active'", [c]
  );
  if (!q.rows.length) return null;
  const m = q.rows[0];
  return { role: m.role === 'admin' ? 'admin' : 'member', name: m.name, memberId: m.id, email: m.email };
}
function credOf(req, body) {
  const b = body || {};
  return b.token || b.secret || req.headers['x-aihc-token'] || req.query.token || req.query.secret;
}
/* gate(req, res, body, 'admin'|'member') -> who, or null with the 403 already sent */
async function gate(req, res, body, need) {
  const who = await roleFor(credOf(req, body));
  if (!who || (need === 'admin' && who.role !== 'admin')) {
    res.status(403).json({ error: 'nope' });
    return null;
  }
  return who;
}

app.get('/', (req, res) => res.json({ ok: true, service: 'aihc-notes' }));

app.get('/notes', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  const deck = String(req.query.deck || '');
  try {
    const q = deck
      ? await pool.query('SELECT id, deck, slide, x, y, name, body, ts FROM aihc_notes WHERE deck = $1 ORDER BY ts', [deck])
      : await pool.query('SELECT id, deck, slide, x, y, name, body, ts FROM aihc_notes ORDER BY ts');
    res.json({ notes: q.rows.map(r => ({ id: r.id, deck: r.deck, slide: r.slide, x: r.x, y: r.y, name: r.name, text: r.body, ts: r.ts })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/notes', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if (body.action === 'add' && body.note && body.note.id) {
      const n = body.note;
      await pool.query(
        `INSERT INTO aihc_notes (id, deck, slide, x, y, name, body, ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [String(n.id), String(body.deck || n.deck || ''), String(n.slide),
         Number(n.x) || 0, Number(n.y) || 0,
         String(n.name).slice(0, 80), String(n.text).slice(0, 4000), String(n.ts)]
      );
      return res.json({ ok: true });
    }
    if (body.action === 'delete' && body.id) {
      await pool.query('DELETE FROM aihc_notes WHERE id = $1', [String(body.id)]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.get('/posts', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  try {
    const q = await pool.query(
      'SELECT id, name, title, body, more, kind, tags, notable, ts FROM aihc_posts ORDER BY ts DESC'
    );
    res.json({ posts: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/posts', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if (body.action === 'add' && body.post && body.post.id) {
      const p = body.post;
      await pool.query(
        `INSERT INTO aihc_posts (id, name, title, body, more, kind, tags, notable, ts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [String(p.id), String(p.name).slice(0, 80), String(p.title || '').slice(0, 200),
         String(p.body).slice(0, 4000), String(p.more || '').slice(0, 20000),
         String(p.kind || 'update').slice(0, 20), String(p.tags || '').slice(0, 200),
         Boolean(p.notable), String(p.ts)]
      );
      return res.json({ ok: true });
    }
    if (body.action === 'delete' && body.id) {
      await pool.query('DELETE FROM aihc_posts WHERE id = $1', [String(body.id)]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* rsvp: slots are recorded per event; events live in aihc_events (admin-managed) */
async function getEvent(id) {
  const q = await pool.query(
    'SELECT id, city, title, when_text, sort_date, start_time, location, capacity, status FROM aihc_events WHERE id = $1', [id]
  );
  if (!q.rows.length) return null;
  const r = q.rows[0];
  return {
    title: r.title, when: r.when_text, location: r.location, capacity: r.capacity,
    city: r.city, status: r.status, sort_date: r.sort_date, start_time: r.start_time,
  };
}

/* a party is the rsvp holder plus an optional named guest, so it occupies 1 or 2 seats */
function partySize(r) {
  return 1 + (r.guest_name ? 1 : 0);
}
async function seatsTaken(event) {
  const q = await pool.query(
    "SELECT COALESCE(SUM(1 + CASE WHEN guest_name <> '' THEN 1 ELSE 0 END), 0)::int AS n FROM aihc_rsvps WHERE event = $1 AND status = 'seat'", [event]
  );
  return q.rows[0].n;
}
async function waitlistSize(event) {
  const q = await pool.query(
    "SELECT COALESCE(SUM(1 + CASE WHEN guest_name <> '' THEN 1 ELSE 0 END), 0)::int AS n FROM aihc_rsvps WHERE event = $1 AND status = 'waitlist'", [event]
  );
  return q.rows[0].n;
}
function cleanRef(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}
function shareUrl(eventId, rsvpId) {
  return 'https://aihomebrewclub.com/rsvp.html?event=' + eventId + '&ref=n-' + rsvpId;
}

/* ---- invites: membership is minted from attendance ---- */
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function inviteUrl(token) { return 'https://aihomebrewclub.com/members.html?invite=' + token; }

/* find an active member by email, else mint one. race-safe: the partial unique
   index on lower(email) turns a double-mint into a 23505 we recover from. */
async function mintMember(name, email, source) {
  const em = String(email || '').trim().toLowerCase().slice(0, 160);
  if (em) {
    const q = await pool.query("SELECT * FROM aihc_members WHERE lower(email) = $1 AND status = 'active'", [em]);
    if (q.rows.length) return { member: q.rows[0], existed: true };
  }
  const m = {
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: String(name || '').trim().slice(0, 80) || 'a neighbor',
    email: em, token: newToken(), role: 'member', status: 'active',
    source: String(source || '').slice(0, 60), ts: new Date().toISOString(),
  };
  try {
    await pool.query(
      'INSERT INTO aihc_members (id, name, email, token, role, status, source, ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [m.id, m.name, m.email, m.token, m.role, m.status, m.source, m.ts]
    );
    return { member: m, existed: false };
  } catch (err) {
    if (err.code === '23505' && em) {
      const q = await pool.query("SELECT * FROM aihc_members WHERE lower(email) = $1 AND status = 'active'", [em]);
      if (q.rows.length) return { member: q.rows[0], existed: true };
    }
    throw err;
  }
}

function sendInvite(member) {
  mailTo(
    member.email,
    'Your key to the clubhouse',
    'Hey ' + member.name + ',\n\n' +
    'You pulled up a chair at the table, so the clubhouse is yours now: the members\' chat, ' +
    'the recipe swaps, the whole back room.\n\n' +
    'Here is your personal key. No password, no account, just this link:\n\n' +
    inviteUrl(member.token) + '\n\n' +
    'Open it once on each device you use and you are in. It is yours alone, so please do not ' +
    'forward it; if a neighbor wants in, bring them to the next meetup instead.\n\n' +
    'Lost it? Reply to this email and we will cut you a fresh one.\n\n' +
    'See you inside,\nThe AI Homebrew Club\nhttps://aihomebrewclub.com'
  );
}

function addFeedPost(id, title, body, tags, notable, ts) {
  return pool.query(
    `INSERT INTO aihc_posts (id, name, title, body, more, kind, tags, notable, ts)
     VALUES ($1, 'The club', $2, $3, '', 'update', $4, $5, $6)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [id, title, body, tags, notable, ts]
  );
}

app.get('/rsvp', async (req, res) => {
  const key = String(req.query.event || '');
  try {
    const ev = await getEvent(key);
    if (!ev) return res.status(404).json({ error: 'no such event' });
    const taken = await seatsTaken(key);
    res.json({
      event: key, title: ev.title, when: ev.when, location: ev.location,
      capacity: ev.capacity, taken, left: Math.max(0, ev.capacity - taken),
      sort_date: ev.sort_date, start_time: ev.start_time, gcal: gcalUrl(ev, key),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/rsvp', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  /* cancel: the rsvp id is an unguessable token, so holding it is authorization enough */
  if (body.action === 'cancel' && body.id) {
    try {
      const q = await pool.query("SELECT * FROM aihc_rsvps WHERE id = $1 AND status IN ('seat','waitlist')", [String(body.id)]);
      if (!q.rows.length) return res.status(404).json({ error: 'no such rsvp' });
      const r = q.rows[0];
      const ev = await getEvent(r.event);
      await pool.query("UPDATE aihc_rsvps SET status = 'cancelled' WHERE id = $1", [r.id]);
      let promoted = null;
      if (r.status === 'seat' && ev) {
        /* promote the earliest waitlisted party that fits the seats now open */
        const open = ev.capacity - await seatsTaken(r.event);
        const w = await pool.query(
          "SELECT * FROM aihc_rsvps WHERE event = $1 AND status = 'waitlist' ORDER BY ts", [r.event]
        );
        promoted = w.rows.find(x => partySize(x) <= open) || null;
        if (promoted) {
          await pool.query("UPDATE aihc_rsvps SET status = 'seat' WHERE id = $1", [promoted.id]);
        }
      }
      if (ev) {
        const taken = await seatsTaken(r.event);
        const ts = new Date().toISOString();
        const feed = promoted
          ? 'A seat changed hands for ' + ev.when + ': ' + promoted.name +
            (promoted.guest_name ? ' and ' + promoted.guest_name : '') + ' moved up from the waitlist. ' + taken + ' of ' + ev.capacity + ' seats spoken for.'
          : 'A seat opened up for ' + ev.when + '. ' + taken + ' of ' + ev.capacity + ' seats spoken for.';
        await addFeedPost('rsvpx-' + r.id, '', feed, '#rsvp', false, ts);
        notify(
          'RSVP cancelled: ' + r.name + ' (' + taken + ' of ' + ev.capacity + ')',
          r.name + ' cancelled for ' + ev.when + '.\nEmail: ' + (r.email || '-') + '\nPhone: ' + (r.phone || '-') +
          (promoted ? '\n\nPromoted from waitlist: ' + promoted.name + ' (' + promoted.email + ', ' + promoted.phone + ')' : '')
        );
        if (promoted && promoted.email) {
          mailTo(
            promoted.email, 'A seat opened up: you are in for ' + ev.when,
            'Good news ' + promoted.name + ',\n\nA seat opened up and you are off the waitlist. ' +
            (promoted.guest_name ? 'You and ' + promoted.guest_name + ' have seats for ' : 'You have a seat for ') +
            ev.title + '.\n\nWhen: ' + ev.when + (ev.start_time ? ', ' + fmtTime(ev.start_time) : ' (time announced soon)') +
            '\nWhere: ' + ev.location +
            '\n\nAdd it to your calendar: ' + (gcalUrl(ev, r.event) || 'https://aihomebrewclub.com/waterville.html') +
            '\n\nPlans change? Give the seat back here: ' + cancelUrl(r.event, promoted.id) +
            '\n\nSee you at the table,\nThe AI Homebrew Club\nhttps://aihomebrewclub.com'
          );
        }
      }
      return res.json({ ok: true, cancelled: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'db' });
    }
  }
  if (body.website) return res.json({ ok: true, status: 'seat' }); /* honeypot */
  const key = String(body.event || '');
  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 160);
  const phone = String(body.phone || '').trim().slice(0, 40);
  /* legacy single-field clients still send contact */
  const legacy = String(body.contact || '').trim().slice(0, 160);
  if (!name || (!legacy && (!email || !phone))) {
    return res.status(400).json({ error: 'name, email, and phone required' });
  }
  if (email && email.indexOf('@') === -1) return res.status(400).json({ error: 'bad email' });
  if (phone && (phone.match(/\d/g) || []).length < 7) return res.status(400).json({ error: 'bad phone' });
  const contact = legacy || (email + ' · ' + phone);
  const biz = String(body.biz || '').trim().slice(0, 160);
  const note = String(body.note || '').trim().slice(0, 500);
  const guest = String(body.guest || '').trim().slice(0, 80);
  const ref = cleanRef(body.ref);
  try {
    const ev = await getEvent(key);
    if (!ev) return res.status(404).json({ error: 'no such event' });
    const taken = await seatsTaken(key);
    const party = guest ? 2 : 1;
    const left = ev.capacity - taken;
    let status;
    if (body.forceWait) {
      status = 'waitlist';
    } else if (left >= party) {
      status = 'seat';
    } else if (party === 2 && left === 1) {
      /* one seat left, party of two: the client offers "take it solo" or "waitlist us both" */
      return res.status(409).json({ error: 'one-seat-left', left: 1 });
    } else {
      status = 'waitlist';
    }
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const ts = new Date().toISOString();
    await pool.query(
      'INSERT INTO aihc_rsvps (id, event, name, contact, email, phone, biz, note, status, ts, ref, guest_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id, key, name, contact, email, phone, biz, note, status, ts, ref, guest]
    );
    const newTaken = status === 'seat' ? taken + party : taken;
    const who = name + (biz ? ' (' + biz + ')' : '');
    const feedBody = status === 'seat'
      ? (guest
          ? who + ' saved two seats for ' + ev.when + ' and is bringing ' + guest + '. ' + newTaken + ' of ' + ev.capacity + ' seats spoken for.'
          : who + ' saved a seat for ' + ev.when + '. ' + newTaken + ' of ' + ev.capacity + ' seats spoken for.')
      : (guest
          ? who + ' and ' + guest + ' joined the waitlist for ' + ev.when + '.'
          : who + ' joined the waitlist for ' + ev.when + '.');
    await addFeedPost('rsvp-' + id, '', feedBody, '#rsvp', false, ts);
    if (status === 'seat' && newTaken >= ev.capacity) {
      await addFeedPost(
        'full-' + key, 'Eight for eight.',
        'The first table is full: all ' + ev.capacity + ' seats for ' + ev.when + ' are spoken for. New RSVPs go to the waitlist.',
        '#rsvp', true, ts
      );
    }
    if (status === 'waitlist') {
      /* overflow: demand has doubled the room. fire the second-table prompt once per event. */
      const wl = await waitlistSize(key);
      if (wl >= ev.capacity) {
        const ins = await addFeedPost(
          'overfull-' + key, 'We need a second room.',
          'Twice as many neighbors as chairs for ' + ev.when + ': the table is full and the waitlist is as long as the room. ' +
          'If you have a room and a coffee pot, lend it to the club: https://aihomebrewclub.com/lend.html?ref=overflow',
          '#rooms', true, ts
        );
        if (ins.rows.length) {
          notify(
            'Waitlist overflow: ' + key + ' has ' + wl + ' waiting',
            'The waitlist for ' + ev.when + ' (' + key + ') now holds ' + wl + ' people against ' + ev.capacity +
            ' seats.\n\nDemand supports a second session. Options:\n- Schedule a second table in the admin console (same venue, new date)\n- Check the Rooms offered panel for a venue to use\n\nAdmin: https://aihomebrewclub.com/deck/admin.html'
          );
        }
      }
    }
    notify(
      status === 'seat'
        ? 'RSVP: ' + name + (guest ? ' +1' : '') + ' saved ' + (guest ? 'two seats' : 'a seat') + ' (' + newTaken + ' of ' + ev.capacity + ')'
        : 'RSVP waitlist: ' + name + (guest ? ' +1' : ''),
      'Name: ' + name + '\nEmail: ' + (email || '-') + '\nPhone: ' + (phone || '-') +
      (legacy ? '\nContact (legacy): ' + legacy : '') + '\nBusiness: ' + (biz || '-') +
      '\nGuest: ' + (guest || '-') + '\nHeard via: ' + (ref || '-') +
      '\nTask: ' + (note || '-') + '\n\nEvent: ' + ev.title + ', ' + ev.when + '\n' + ev.location +
      '\nStatus: ' + status + '\nSeats taken: ' + newTaken + ' of ' + ev.capacity +
      (status === 'seat' && newTaken >= ev.capacity ? '\n\nTHE TABLE IS NOW FULL.' : '')
    );
    if (email) {
      const gc = gcalUrl(ev, key);
      const ics = icsText(ev, key);
      mailTo(
        email,
        status === 'seat' ? 'Your seat is saved: ' + ev.when : 'You are on the waitlist for ' + ev.when,
        status === 'seat'
          ? 'Hey ' + name + ',\n\n' +
            (guest ? 'You and ' + guest + ' have seats for ' : 'You have a seat for ') + ev.title + '.\n\nWhen: ' + ev.when +
            (ev.start_time ? ', ' + fmtTime(ev.start_time) : ' (time announced soon)') +
            '\nWhere: ' + ev.location +
            '\nBring: a laptop or just your phone, and one real task that is eating your week.' +
            '\nCost: free. Coffee on.\n\nAdd it to your calendar: ' + (gc || 'https://aihomebrewclub.com/waterville.html') +
            '\nAgenda: https://aihomebrewclub.com/waterville.html' +
            '\n\nKnow a neighbor who should be at this table? Forward this, or send them your link: ' + shareUrl(key, id) +
            '\n\nPlans change? Cancel your seat here so a neighbor can have it: ' + cancelUrl(key, id) +
            '\n\nSee you at the table,\nThe AI Homebrew Club\nhttps://aihomebrewclub.com'
          : 'Hey ' + name + ',\n\nAll seats for ' + ev.when + ' are spoken for, so you ' +
            (guest ? 'and ' + guest + ' are' : 'are') + ' on the waitlist. Seats do open up; if enough free, your ' +
            (guest ? 'seats are' : 'seat is') + ' automatic and we will email you right away.' +
            '\n\nLeave the waitlist here: ' + cancelUrl(key, id) +
            '\n\nThe AI Homebrew Club\nhttps://aihomebrewclub.com',
        ics ? [{ filename: 'ai-brown-bag.ics', content: ics, contentType: 'text/calendar' }] : undefined
      );
    }
    res.json({ ok: true, status, left: Math.max(0, ev.capacity - newTaken), id, share: shareUrl(key, id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* events + agendas: public read, secret-gated writes */
app.get('/events', async (req, res) => {
  try {
    const city = String(req.query.city || '').toLowerCase();
    const evQ = city
      ? await pool.query('SELECT * FROM aihc_events WHERE city = $1 ORDER BY sort_date DESC', [city])
      : await pool.query('SELECT * FROM aihc_events ORDER BY sort_date DESC');
    const agQ = await pool.query('SELECT * FROM aihc_agenda_items ORDER BY pos');
    const events = [];
    for (const r of evQ.rows) {
      const taken = await seatsTaken(r.id);
      events.push({
        id: r.id, city: r.city, title: r.title, when: r.when_text, sort_date: r.sort_date,
        start_time: r.start_time, location: r.location, capacity: r.capacity, status: r.status,
        gcal: gcalUrl({ title: r.title, location: r.location, sort_date: r.sort_date, start_time: r.start_time }, r.id),
        taken, left: Math.max(0, r.capacity - taken),
        agenda: agQ.rows.filter(a => a.event === r.id)
          .map(a => ({ id: a.id, pos: a.pos, t: a.t, title: a.title, detail: a.detail })),
      });
    }
    res.json({ events });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/events', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if ((body.action === 'add' || body.action === 'update') && body.event && body.event.id) {
      const e = body.event;
      const id = String(e.id).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60);
      if (!id) return res.status(400).json({ error: 'bad id' });
      const startTime = /^\d{1,2}:\d{2}$/.test(String(e.start_time || '')) ? String(e.start_time) : '';
      await pool.query(
        `INSERT INTO aihc_events (id, city, title, when_text, sort_date, start_time, location, capacity, status, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           city = EXCLUDED.city, title = EXCLUDED.title, when_text = EXCLUDED.when_text,
           sort_date = EXCLUDED.sort_date, start_time = EXCLUDED.start_time, location = EXCLUDED.location,
           capacity = EXCLUDED.capacity, status = EXCLUDED.status`,
        [id, String(e.city || 'waterville').toLowerCase().slice(0, 40), String(e.title || '').slice(0, 200),
         String(e.when || '').slice(0, 200), String(e.sort_date || '').slice(0, 10), startTime,
         String(e.location || '').slice(0, 300), Math.max(1, parseInt(e.capacity, 10) || 8),
         e.status === 'past' ? 'past' : 'upcoming', new Date().toISOString()]
      );
      return res.json({ ok: true, id });
    }
    if (body.action === 'delete' && body.id) {
      await pool.query('DELETE FROM aihc_events WHERE id = $1', [String(body.id)]);
      await pool.query('DELETE FROM aihc_agenda_items WHERE event = $1', [String(body.id)]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/agenda', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if ((body.action === 'add' || body.action === 'update') && body.item && body.item.event) {
      const it = body.item;
      const id = it.id ? String(it.id) : 'ag' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await pool.query(
        `INSERT INTO aihc_agenda_items (id, event, pos, t, title, detail)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           pos = EXCLUDED.pos, t = EXCLUDED.t, title = EXCLUDED.title, detail = EXCLUDED.detail`,
        [id, String(it.event), parseInt(it.pos, 10) || 0, String(it.t || '').slice(0, 40),
         String(it.title || '').slice(0, 200), String(it.detail || '').slice(0, 1000)]
      );
      return res.json({ ok: true, id });
    }
    if (body.action === 'delete' && body.id) {
      await pool.query('DELETE FROM aihc_agenda_items WHERE id = $1', [String(body.id)]);
      return res.json({ ok: true });
    }
    /* replace: the whole run sheet in one move (the block builder saves this way) */
    if (body.action === 'replace' && body.event && Array.isArray(body.items)) {
      const event = String(body.event);
      const items = body.items
        .filter(x => x && String(x.title || '').trim())
        .slice(0, 40);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM aihc_agenda_items WHERE event = $1', [event]);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const id = 'ag' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i;
          await client.query(
            'INSERT INTO aihc_agenda_items (id, event, pos, t, title, detail) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, event, i + 1, String(it.t || '').slice(0, 40),
             String(it.title).trim().slice(0, 200), String(it.detail || '').slice(0, 1000)]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return res.json({ ok: true, count: items.length });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* the ai run-sheet drafter: proposes a block lineup for an event. writes nothing -
   the console shows the draft for editing, then saves through /agenda replace. */
app.post('/agenda-draft', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  if (!AI_KEY) return res.json({ ok: false, error: 'no-api-key' });
  try {
    const ev = await getEvent(String(body.event || ''));
    if (!ev) return res.status(404).json({ error: 'no such event' });
    const blocksQ = await pool.query("SELECT * FROM aihc_blocks WHERE status = 'active' ORDER BY pos, ts");
    const shelf = blocksQ.rows.map(b =>
      '- id:' + b.id + ' | ' + b.title + ' (' + b.kind + ', ' + b.minutes + ' min)' +
      (b.prompt ? ' | script: ' + b.prompt.slice(0, 200) : '') +
      (b.notes ? ' | notes: ' + b.notes.slice(0, 200) : '')
    ).join('\n');
    const pastQ = await pool.query(
      "SELECT id, title, when_text FROM aihc_events WHERE status <> 'upcoming' ORDER BY sort_date DESC LIMIT 2"
    );
    let past = '';
    if (pastQ.rows.length) {
      const agQ = await pool.query(
        'SELECT * FROM aihc_agenda_items WHERE event = ANY($1) ORDER BY pos', [pastQ.rows.map(r => r.id)]
      );
      past = pastQ.rows.map(r =>
        r.title + ' (' + r.when_text + '):\n' +
        agQ.rows.filter(a => a.event === r.id)
          .map(a => '  ' + a.t + ' ' + a.title + (a.detail ? ' - ' + a.detail : '')).join('\n')
      ).join('\n');
    }
    const brief = String(body.brief || '').slice(0, 500);
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              block_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              title: { type: 'string' },
              minutes: { type: 'integer' },
              detail: { type: 'string' },
            },
            required: ['block_id', 'title', 'minutes', 'detail'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    };
    /* heroku's router kills quiet requests at 30s (H12); once the model is
       thinking, drip whitespace to keep the line open - leading spaces are
       valid JSON, so clients parse the eventual body untouched */
    res.setHeader('Content-Type', 'application/json');
    res.write(' ');
    const drip = setInterval(() => { try { res.write(' '); } catch {} }, 10000);
    try {
      const msg = await ai().messages.create({
        model: 'claude-opus-5',
        max_tokens: 16000,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{
          role: 'user',
          content:
            'You plan the run sheet for the AI Homebrew Club: a free, one-hour, neighbors-teach-neighbors ' +
            'AI meetup in central Maine. Plain talk, no jargon, hands-on over lecture.\n\n' +
            'The meetup:\n- ' + ev.title + ' — ' + ev.when +
            (ev.start_time ? ', starts ' + ev.start_time : '') + ', at ' + ev.location + '\n\n' +
            'The block shelf (reusable segments; set block_id when you use one):\n' + (shelf || '(empty)') + '\n\n' +
            (past ? 'Past run sheets, for tone and pacing:\n' + past + '\n\n' : '') +
            (brief ? 'The host asks: ' + brief + '\n\n' : '') +
            'Draft the run sheet: pick and order segments totaling at most 60 minutes. For each item, ' +
            'set block_id to a shelf id when a shelf block fits (else null), a short title, minutes, and ' +
            'a one-line detail in the club\'s plain voice. Open with arrival and welcome, close with a send-off.',
        }],
      });
      clearInterval(drip);
      if (msg.stop_reason === 'refusal') return res.end(JSON.stringify({ ok: false, error: 'declined' }));
      const text = (msg.content.find(b => b.type === 'text') || {}).text || '';
      const draft = JSON.parse(text);
      if (!draft || !Array.isArray(draft.items)) return res.end(JSON.stringify({ ok: false, error: 'ai' }));
      res.end(JSON.stringify({ ok: true, draft: { items: draft.items.slice(0, 40) } }));
    } catch (e) {
      clearInterval(drip);
      console.error('agenda-draft failed:', e.message);
      res.end(JSON.stringify({ ok: false, error: 'ai' }));
    }
  } catch (err) {
    console.error('agenda-draft failed:', err.message);
    res.status(502).json({ error: 'ai' });
  }
});

/* recipes: public read, secret-gated writes */
app.get('/recipes', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM aihc_recipes ORDER BY category, ts DESC');
    res.json({ recipes: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/recipes', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if ((body.action === 'add' || body.action === 'update') && body.recipe && body.recipe.title && body.recipe.prompt) {
      const r = body.recipe;
      const id = r.id ? String(r.id) : 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await pool.query(
        `INSERT INTO aihc_recipes (id, title, category, problem, prompt, notes, name, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, category = EXCLUDED.category, problem = EXCLUDED.problem,
           prompt = EXCLUDED.prompt, notes = EXCLUDED.notes, name = EXCLUDED.name`,
        [id, String(r.title).slice(0, 200), String(r.category || 'General').slice(0, 80),
         String(r.problem || '').slice(0, 500), String(r.prompt).slice(0, 4000),
         String(r.notes || '').slice(0, 1000), String(r.name || '').slice(0, 80),
         String(r.ts || new Date().toISOString())]
      );
      return res.json({ ok: true, id });
    }
    if (body.action === 'delete' && body.id) {
      await pool.query('DELETE FROM aihc_recipes WHERE id = $1', [String(body.id)]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* the ai recipe drafter: proposes prompts the room would actually use, drawn
   from what rsvp-ers do and asked for. writes nothing - the console shows the
   drafts and the admin adds the keepers to the box. */
app.post('/recipes-draft', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  if (!AI_KEY) return res.json({ ok: false, error: 'no-api-key' });
  try {
    const boxQ = await pool.query('SELECT title, category FROM aihc_recipes ORDER BY category, ts DESC');
    const box = boxQ.rows.map(r => '- ' + r.title + ' (' + r.category + ')').join('\n');
    /* the room, anonymized: what folks do and what they asked for. no names, no contacts. */
    const roomQ = await pool.query(
      "SELECT biz, note FROM aihc_rsvps WHERE (biz <> '' OR note <> '') ORDER BY ts DESC LIMIT 30"
    );
    const room = roomQ.rows
      .map(r => '- ' + [r.biz, r.note].filter(Boolean).map(s => String(s).slice(0, 200)).join(' | asked for: '))
      .join('\n');
    const brief = String(body.brief || '').slice(0, 500);
    const schema = {
      type: 'object',
      properties: {
        recipes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              category: { type: 'string' },
              problem: { type: 'string' },
              prompt: { type: 'string' },
              notes: { type: 'string' },
            },
            required: ['title', 'category', 'problem', 'prompt', 'notes'],
            additionalProperties: false,
          },
        },
      },
      required: ['recipes'],
      additionalProperties: false,
    };
    /* same H12 dodge as /agenda-draft: drip whitespace while the model thinks */
    res.setHeader('Content-Type', 'application/json');
    res.write(' ');
    const drip = setInterval(() => { try { res.write(' '); } catch {} }, 10000);
    try {
      const msg = await ai().messages.create({
        model: 'claude-opus-5',
        max_tokens: 16000,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{
          role: 'user',
          content:
            'You write prompt recipes for the AI Homebrew Club: a free neighbors-teach-neighbors AI meetup ' +
            'in central Maine. A recipe is a prompt a small-town business owner pastes into Claude or ChatGPT ' +
            'to get a real chore done. Plain talk, no jargon, immediately usable.\n\n' +
            'Already in the recipe box (do not duplicate these):\n' + (box || '(empty)') + '\n\n' +
            (room ? 'The neighbors who signed up (what they do, and what they asked AI to take off their plate):\n' + room + '\n\n' : '') +
            (brief ? 'The host asks: ' + brief + '\n\n' : '') +
            'Draft 3 new recipes these specific neighbors would find most helpful. For each: a short title in ' +
            'the club\'s voice, a category (reuse an existing category when one fits), the problem it solves in ' +
            'one sentence, the full paste-ready prompt (with ALL-CAPS placeholders like PASTE THE EMAIL HERE ' +
            'where their own material goes), and a one-line tip in notes.',
        }],
      });
      clearInterval(drip);
      if (msg.stop_reason === 'refusal') return res.end(JSON.stringify({ ok: false, error: 'declined' }));
      const text = (msg.content.find(b => b.type === 'text') || {}).text || '';
      const draft = JSON.parse(text);
      if (!draft || !Array.isArray(draft.recipes)) return res.end(JSON.stringify({ ok: false, error: 'ai' }));
      res.end(JSON.stringify({ ok: true, draft: { recipes: draft.recipes.slice(0, 6) } }));
    } catch (e) {
      clearInterval(drip);
      console.error('recipes-draft failed:', e.message);
      res.end(JSON.stringify({ ok: false, error: 'ai' }));
    }
  } catch (err) {
    console.error('recipes-draft failed:', err.message);
    res.status(502).json({ error: 'ai' });
  }
});

/* run-sheet blocks: the content shelf agendas are built from. admin-only. */
app.get('/blocks', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  try {
    const q = await pool.query("SELECT * FROM aihc_blocks WHERE status = 'active' ORDER BY pos, ts");
    res.json({
      ok: true, ai: !!AI_KEY,
      blocks: q.rows.map(b => ({
        id: b.id, title: b.title, kind: b.kind, minutes: b.minutes,
        prompt: b.prompt, notes: b.notes, links: b.links, pos: b.pos,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/blocks', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if ((body.action === 'add' || body.action === 'update') && body.block && body.block.title) {
      const b = body.block;
      const id = b.id ? String(b.id) : 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const kind = ['demo', 'talk', 'task', 'admin'].includes(b.kind) ? b.kind : 'demo';
      await pool.query(
        `INSERT INTO aihc_blocks (id, title, kind, minutes, prompt, notes, links, pos, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, kind = EXCLUDED.kind, minutes = EXCLUDED.minutes,
           prompt = EXCLUDED.prompt, notes = EXCLUDED.notes, links = EXCLUDED.links, pos = EXCLUDED.pos`,
        [id, String(b.title).trim().slice(0, 200), kind,
         Math.min(120, Math.max(1, parseInt(b.minutes, 10) || 10)),
         String(b.prompt || '').slice(0, 4000), String(b.notes || '').slice(0, 2000),
         String(b.links || '').slice(0, 500), parseInt(b.pos, 10) || 0, new Date().toISOString()]
      );
      return res.json({ ok: true, id });
    }
    if (body.action === 'delete' && body.id) {
      await pool.query('DELETE FROM aihc_blocks WHERE id = $1', [String(body.id)]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* ---- site traffic: first-party, cookieless ----------------------------------
   POST /hits  {page, ref, src, dev, lang}   public, no auth, from config.js's beacon
   GET  /hits/summary?days=30                admin: totals by page/day/ref/src/dev */
const HIT_BUCKET = new Map(); /* ip -> [count, windowStart]; abuse brake only, never stored */
app.post('/hits', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  body = body || {};
  /* brake: 60 hits/min per source ip; the ip lives only in this in-memory window */
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const b = HIT_BUCKET.get(ip) || [0, now];
  if (now - b[1] > 60000) { b[0] = 0; b[1] = now; }
  b[0] += 1; HIT_BUCKET.set(ip, b);
  if (HIT_BUCKET.size > 5000) HIT_BUCKET.clear();
  if (b[0] > 60) return res.status(204).end();
  const ua = String(req.headers['user-agent'] || '');
  if (/bot|crawl|spider|slurp|preview|facebookexternalhit|headless/i.test(ua)) return res.status(204).end();
  const page = String(body.page || '').replace(/[?#].*$/, '').slice(0, 120);
  if (!page || !/^\//.test(page)) return res.status(204).end();
  const ref = String(body.ref || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].slice(0, 80);
  const src = String(body.src || '').replace(/[^\w.-]/g, '').slice(0, 40);
  const dev = ['phone', 'tablet', 'desktop'].includes(body.dev) ? body.dev : '';
  const lang = String(body.lang || '').slice(0, 8);
  try {
    await pool.query('INSERT INTO aihc_hits (page, ref, src, dev, lang) VALUES ($1,$2,$3,$4,$5)', [page, ref, src, dev, lang]);
  } catch (err) { console.error(err); }
  res.status(204).end();
});

app.get('/hits/summary', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const [tot, byPage, byDay, byRef, bySrc, byDev, byHour] = await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM aihc_hits WHERE ts >= $1', [since]),
      pool.query('SELECT page, count(*)::int AS n FROM aihc_hits WHERE ts >= $1 GROUP BY page ORDER BY n DESC LIMIT 40', [since]),
      pool.query("SELECT to_char(ts AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM aihc_hits WHERE ts >= $1 GROUP BY day ORDER BY day", [since]),
      pool.query("SELECT CASE WHEN ref = '' THEN '(direct)' ELSE ref END AS ref, count(*)::int AS n FROM aihc_hits WHERE ts >= $1 GROUP BY 1 ORDER BY n DESC LIMIT 20", [since]),
      pool.query("SELECT src, count(*)::int AS n FROM aihc_hits WHERE ts >= $1 AND src <> '' GROUP BY src ORDER BY n DESC LIMIT 20", [since]),
      pool.query("SELECT CASE WHEN dev = '' THEN '(unknown)' ELSE dev END AS dev, count(*)::int AS n FROM aihc_hits WHERE ts >= $1 GROUP BY 1 ORDER BY n DESC", [since]),
      pool.query("SELECT extract(hour FROM ts AT TIME ZONE 'America/New_York')::int AS hour, count(*)::int AS n FROM aihc_hits WHERE ts >= $1 GROUP BY hour ORDER BY hour", [since]),
    ]);
    res.json({ ok: true, days, total: tot.rows[0].n, pages: byPage.rows, daysSeries: byDay.rows,
               refs: byRef.rows, srcs: bySrc.rows, devs: byDev.rows, hours: byHour.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* attendee names for the member-facing feed: no contact details */
app.get('/attendees', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  try {
    const event = String(req.query.event || '');
    const q = event
      ? await pool.query("SELECT name, biz, status, guest_name FROM aihc_rsvps WHERE event = $1 AND status IN ('seat','waitlist') ORDER BY ts", [event])
      : await pool.query("SELECT event, name, biz, status, guest_name FROM aihc_rsvps WHERE status IN ('seat','waitlist') ORDER BY ts");
    res.json({ attendees: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.get('/rsvps', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  try {
    const q = await pool.query('SELECT * FROM aihc_rsvps ORDER BY ts');
    const inv = await pool.query('SELECT event, email, name, by, ts FROM aihc_invites ORDER BY ts');
    res.json({ rsvps: q.rows, invites: inv.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/rsvps', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if (body.action === 'delete' && body.id) {
      await pool.query('DELETE FROM aihc_rsvps WHERE id = $1', [String(body.id)]);
      return res.json({ ok: true });
    }
    /* note: a plain message from the club to a list of people about an event (reminders:
       "bring your laptop"). no dedup - it is a note, sent when you press send. logged
       in aihc_invites with a note: prefix so the book shows it. */
    if (body.action === 'note' && body.event && Array.isArray(body.people)) {
      const ev = await getEvent(String(body.event));
      if (!ev) return res.status(404).json({ error: 'no such event' });
      const eventId = String(body.event);
      const message = String(body.message || '').trim().slice(0, 3000);
      if (!message) return res.status(400).json({ error: 'message required' });
      const subject = String(body.subject || '').trim().slice(0, 160) || ('A note about ' + ev.title + ', ' + ev.when);
      const seen = new Set(); const sent = [];
      const gc = gcalUrl(ev, eventId);
      for (const p of body.people.slice(0, 200)) {
        const email = String((p && p.email) || '').trim().toLowerCase().slice(0, 160);
        const name = String((p && p.name) || '').trim().slice(0, 80);
        if (!email || email.indexOf('@') === -1 || seen.has(email)) continue;
        seen.add(email);
        mailTo(
          email, subject,
          'Hey ' + (name || 'neighbor') + ',\n\n' + message + '\n\n' +
          ev.title + '\nWhen: ' + ev.when + (ev.start_time ? ', ' + fmtTime(ev.start_time) : '') +
          '\nWhere: ' + ev.location +
          '\nSeat not saved yet? https://aihomebrewclub.com/rsvp.html?event=' + encodeURIComponent(eventId) + '&ref=note' +
            (name ? '&name=' + encodeURIComponent(name) : '') + '&email=' + encodeURIComponent(email) +
          (gc ? '\nCalendar: ' + gc : '') +
          '\n\nThe AI Homebrew Club\nhttps://aihomebrewclub.com'
        );
        await pool.query(
          'INSERT INTO aihc_invites (id, event, email, name, by, ts) VALUES ($1,$2,$3,$4,$5,$6)',
          ['nt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), eventId, email, name,
           'note:' + (who.name || who.role || ''), new Date().toISOString()]
        );
        sent.push(email);
      }
      return res.json({ ok: true, sent, mailed: !!mailer });
    }
    /* invite: email a "the next one is on the calendar" note with the rsvp link to a
       list of people (past attendees, members, anyone). skips those already on this
       event's book or already invited to it, unless force. */
    if (body.action === 'invite' && body.event && Array.isArray(body.people)) {
      const ev = await getEvent(String(body.event));
      if (!ev) return res.status(404).json({ error: 'no such event' });
      const eventId = String(body.event);
      const note = String(body.note || '').trim().slice(0, 600);
      const force = body.force === true;
      const onBook = new Set((await pool.query(
        "SELECT lower(email) AS e FROM aihc_rsvps WHERE event = $1 AND status <> 'cancelled' AND email <> ''", [eventId]
      )).rows.map(r => r.e));
      const asked = new Set((await pool.query(
        "SELECT lower(email) AS e FROM aihc_invites WHERE event = $1 AND by NOT LIKE 'note:%'", [eventId]
      )).rows.map(r => r.e));
      const seen = new Set();
      const sent = [], skipped = [];
      const gc = gcalUrl(ev, eventId);
      for (const p of body.people.slice(0, 200)) {
        const email = String((p && p.email) || '').trim().toLowerCase().slice(0, 160);
        const name = String((p && p.name) || '').trim().slice(0, 80);
        if (!email || email.indexOf('@') === -1 || seen.has(email)) continue;
        seen.add(email);
        if (onBook.has(email)) { skipped.push({ email, why: 'on the book' }); continue; }
        if (asked.has(email) && !force) { skipped.push({ email, why: 'already invited' }); continue; }
        const link = 'https://aihomebrewclub.com/rsvp.html?event=' + encodeURIComponent(eventId) + '&ref=invite' +
          (name ? '&name=' + encodeURIComponent(name) : '') + '&email=' + encodeURIComponent(email);
        mailTo(
          email,
          'You are invited: ' + ev.title + ', ' + ev.when,
          'Hey ' + (name || 'neighbor') + ',\n\n' +
          'The next AI Homebrew Club meetup is on the calendar and there is a chair with your name on it.\n\n' +
          ev.title + '\nWhen: ' + ev.when + (ev.start_time ? ', ' + fmtTime(ev.start_time) : '') +
          '\nWhere: ' + ev.location +
          '\nSeats: ' + ev.capacity + ' at the table, first come first served.' +
          (note ? '\n\n' + note : '') +
          '\n\nGrab your seat here (takes ten seconds):\n' + link +
          (gc ? '\n\nOr just add it to your calendar first: ' + gc : '') +
          '\n\nBring a laptop or your phone and one real task that is eating your week. Free, coffee on.' +
          '\n\nSee you at the table,\nThe AI Homebrew Club\nhttps://aihomebrewclub.com'
        );
        await pool.query(
          'INSERT INTO aihc_invites (id, event, email, name, by, ts) VALUES ($1,$2,$3,$4,$5,$6)',
          ['iv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), eventId, email, name,
           who.name || who.role || '', new Date().toISOString()]
        );
        sent.push(email);
      }
      return res.json({ ok: true, sent, skipped, mailed: !!mailer });
    }
    /* attended: the membership moment. sets the flag and, when there's an email,
       mints (or finds) a member and sends their personal key. */
    if (body.action === 'attended' && body.id) {
      const flag = body.attended !== false;
      const q = await pool.query(
        'UPDATE aihc_rsvps SET attended = $1 WHERE id = $2 RETURNING *', [flag, String(body.id)]
      );
      if (!q.rows.length) return res.status(404).json({ error: 'no such rsvp' });
      const r = q.rows[0];
      if (!flag) return res.json({ ok: true, attended: false });
      let member = null, invited = false;
      if (r.email) {
        const m = await mintMember(r.name, r.email, 'rsvp:' + r.id);
        member = m.member;
        if (!m.existed || body.resend) { sendInvite(member); invited = true; }
      }
      return res.json({
        ok: true, attended: true,
        member: member ? { id: member.id, name: member.name, email: member.email, role: member.role, status: member.status } : null,
        invited, mailed: invited && !!mailer,
        invite: member ? inviteUrl(member.token) : '',
      });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* members: the keyring. admin-managed; tokens are the credentials. */
app.get('/members', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  try {
    const q = await pool.query('SELECT id, name, email, token, role, status, source, ts FROM aihc_members ORDER BY ts');
    res.json({ members: q.rows.map(m => ({
      id: m.id, name: m.name, email: m.email, role: m.role, status: m.status,
      source: m.source, ts: m.ts, invite: inviteUrl(m.token),
    })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/members', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if (body.action === 'add') {
      const m = await mintMember(body.name, body.email, 'manual');
      let mailed = false;
      if (!m.existed && m.member.email && mailer) { sendInvite(m.member); mailed = true; }
      return res.json({ ok: true, existed: m.existed, mailed,
        member: { id: m.member.id, name: m.member.name, email: m.member.email, role: m.member.role, status: m.member.status },
        invite: inviteUrl(m.member.token) });
    }
    const id = String(body.id || '');
    if (!id) return res.status(400).json({ error: 'id required' });
    const q = await pool.query('SELECT * FROM aihc_members WHERE id = $1', [id]);
    if (!q.rows.length) return res.status(404).json({ error: 'no such member' });
    const m = q.rows[0];
    if (body.action === 'resend') {
      if (!m.email) return res.status(400).json({ error: 'no email on file' });
      sendInvite(m);
      return res.json({ ok: true, mailed: !!mailer, invite: inviteUrl(m.token) });
    }
    if (body.action === 'revoke') {
      await pool.query("UPDATE aihc_members SET status = 'revoked' WHERE id = $1", [id]);
      return res.json({ ok: true, closed: closeMemberSockets(id) });
    }
    if (body.action === 'promote') {
      await pool.query("UPDATE aihc_members SET role = 'admin' WHERE id = $1", [id]);
      return res.json({ ok: true });
    }
    if (body.action === 'demote') {
      await pool.query("UPDATE aihc_members SET role = 'member' WHERE id = $1", [id]);
      return res.json({ ok: true, closed: closeMemberSockets(id) });
    }
    if (body.action === 'rename' && body.name) {
      await pool.query('UPDATE aihc_members SET name = $1 WHERE id = $2', [String(body.name).trim().slice(0, 80), id]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* token validation for the gate. POST so tokens stay out of router logs.
   public by design: a valid 48-hex token yields only a name and role. */
app.post('/member', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  try {
    const who = await roleFor(body.token);
    if (!who) return res.json({ ok: false });
    /* admin word carries no personal identity; let the gate supply a display name */
    const name = who.memberId === 'admin'
      ? (String(body.name || '').trim().slice(0, 80) || who.name)
      : who.name;
    /* mustRotate: the cred that just passed was the burned legacy word - the gate
       shows a "pick a new admin word" step before letting them through */
    const mustRotate = who.memberId === 'admin' && !ADMIN_SECRET && !adminHash;
    res.json({ ok: true, name, role: who.role, mustRotate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* self-serve rotation: any admin can set a new admin word from the browser.
   stored as a scrypt hash in aihc_config; ADMIN_SECRET env stays as recovery. */
app.post('/admin-secret', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    const next = String(body.next || '');
    if (next.length < 8) return res.status(400).json({ error: 'eight characters at least' });
    if (next.toLowerCase() === SECRET) return res.status(400).json({ error: 'that is the old word' });
    const stored = hashWord(next);
    await pool.query(
      "INSERT INTO aihc_config (k, v) VALUES ('admin_hash', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
      [stored]
    );
    adminHash = stored;
    adminCredCache.clear();
    notify('The admin word changed',
      'A new admin word was just set from the console (by ' + (who.name || 'admin') + ').\n\n' +
      'The old word is dead everywhere' +
      (ADMIN_SECRET ? '; the ADMIN_SECRET env var still works as a recovery override.' : '.') + '\n\n' +
      'If this was not you or Fay, set a fresh one immediately:\n' +
      '  heroku config:set ADMIN_SECRET=<a strong new secret> -a aihc-notes');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* venues: neighbors lending rooms. public offers, secret-gated management. */
app.get('/venues', async (req, res) => {
  const who = await gate(req, res, null, 'admin'); if (!who) return;
  try {
    const q = await pool.query('SELECT * FROM aihc_venues ORDER BY ts DESC');
    res.json({ venues: q.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/venues', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  /* admin actions need the secret; a plain offer is public */
  if (body.action === 'update' || body.action === 'delete') {
    const who = await gate(req, res, body, 'admin'); if (!who) return;
    try {
      if (body.action === 'delete' && body.id) {
        await pool.query('DELETE FROM aihc_venues WHERE id = $1', [String(body.id)]);
        return res.json({ ok: true });
      }
      if (body.action === 'update' && body.id) {
        const st = ['offered', 'scheduled', 'passed'].indexOf(String(body.status)) !== -1 ? String(body.status) : 'offered';
        await pool.query('UPDATE aihc_venues SET status = $1 WHERE id = $2', [st, String(body.id)]);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: 'unknown action' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'db' });
    }
  }
  if (body.website) return res.json({ ok: true }); /* honeypot */
  const name = String(body.name || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 160);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const venue = String(body.venue || '').trim().slice(0, 200);
  const town = String(body.town || '').trim().slice(0, 80);
  const seats = Math.max(0, parseInt(body.seats, 10) || 0);
  const notes = String(body.notes || '').trim().slice(0, 1000);
  const ref = cleanRef(body.ref);
  if (!name || !email || !venue || !town) {
    return res.status(400).json({ error: 'name, email, venue, and town required' });
  }
  if (email.indexOf('@') === -1) return res.status(400).json({ error: 'bad email' });
  try {
    const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const ts = new Date().toISOString();
    await pool.query(
      'INSERT INTO aihc_venues (id, name, email, phone, venue, town, seats, notes, status, ref, ts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, name, email, phone, venue, town, seats, notes, 'offered', ref, ts]
    );
    /* social proof on the feed: venue and town only, never contact details */
    await addFeedPost(
      'venue-' + id, 'A room was offered.',
      'A neighbor offered a room in ' + town + ': ' + venue + (seats ? ' (seats about ' + seats + ')' : '') +
      '. That is how chapters start.',
      '#rooms', true, ts
    );
    notify(
      'Room offered: ' + venue + ', ' + town + (seats ? ' (~' + seats + ' seats)' : ''),
      'Name: ' + name + '\nEmail: ' + email + '\nPhone: ' + (phone || '-') +
      '\nVenue: ' + venue + '\nTown: ' + town + '\nSeats: ' + (seats || '?') +
      '\nNotes: ' + (notes || '-') + '\nHeard via: ' + (ref || '-') +
      '\n\nSchedule it from the Rooms offered panel: https://aihomebrewclub.com/deck/admin.html'
    );
    if (mailer) {
      mailTo(
        email, 'Got it. Thank you for the room.',
        'Hey ' + name + ',\n\nThank you for offering ' + venue + ' in ' + town + '. That is exactly how new tables start.' +
        '\n\nWe will be in touch to find a date that works. In the meantime, the recipes are free at https://aihomebrewclub.com/recipes.html and the next meetup is at https://aihomebrewclub.com/waterville.html.' +
        '\n\nCoffee is on us,\nThe AI Homebrew Club\nhttps://aihomebrewclub.com'
      );
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* ---- the clubhouse: members' chat over websockets ----
   presence and fan-out live in this process's memory. correct at exactly one dyno;
   a second dyno silently splits the room (fix then: redis pub/sub). */
const chatClients = new Map(); /* ws -> { name, role, memberId, channel, msgTimes: [] } */

function closeMemberSockets(memberId) {
  let n = 0;
  for (const [ws, c] of chatClients) {
    if (c.memberId === memberId) { try { ws.close(4401, 'revoked'); } catch {} n++; }
  }
  return n;
}

/* channel visibility: 'members' (everyone behind the gate) or 'admins' (the back room).
   channels change only via POST /channels, so a small in-memory map beats a query per frame. */
let channelVis = new Map();
async function reloadChannelVis() {
  const q = await pool.query('SELECT id, visibility FROM aihc_channels');
  channelVis = new Map(q.rows.map(r => [r.id, r.visibility === 'admins' ? 'admins' : 'members']));
}
function canSee(role, channelId) {
  return role === 'admin' || channelVis.get(channelId) !== 'admins';
}

function presenceFor(role) {
  const who = [];
  for (const c of chatClients.values()) {
    /* admins reading the back room look absent to members: don't leak the room */
    if (role !== 'admin' && !canSee('member', c.channel)) continue;
    who.push({ name: c.name, channel: c.channel });
  }
  return who;
}
function broadcastPresence() {
  const member = JSON.stringify({ type: 'presence', who: presenceFor('member') });
  const admin = JSON.stringify({ type: 'presence', who: presenceFor('admin') });
  for (const [ws, c] of chatClients) {
    if (ws.readyState === 1) { try { ws.send(c.role === 'admin' ? admin : member); } catch {} }
  }
}
function wsBroadcast(frame, vis) {
  /* vis 'admins' keeps a frame inside the back room; anything else fans out to all */
  const s = JSON.stringify(frame);
  for (const [ws, c] of chatClients) {
    if (vis === 'admins' && c.role !== 'admin') continue;
    if (ws.readyState === 1) { try { ws.send(s); } catch {} }
  }
}
function broadcastChannels() {
  /* each role gets the channel list it is allowed to know exists */
  (async () => {
    const member = JSON.stringify({ type: 'channels', channels: await chatChannels(false, 'member') });
    const admin = JSON.stringify({ type: 'channels', channels: await chatChannels(false, 'admin') });
    for (const [ws, c] of chatClients) {
      if (ws.readyState === 1) { try { ws.send(c.role === 'admin' ? admin : member); } catch {} }
    }
  })().catch(err => console.error('channel broadcast failed:', err.message));
}

async function chatChannels(includeArchived, role) {
  const memberOnly = role !== 'admin' ? " AND visibility = 'members'" : '';
  const q = includeArchived && role === 'admin'
    ? await pool.query('SELECT id, name, topic, pos, status, visibility, ts FROM aihc_channels ORDER BY pos, ts')
    : await pool.query("SELECT id, name, topic, pos, status, visibility, ts FROM aihc_channels WHERE status = 'open'" + memberOnly + ' ORDER BY pos, ts');
  return q.rows;
}
async function chatLatest(role) {
  /* unread badges must not leak back-room activity to members */
  const q = role === 'admin'
    ? await pool.query('SELECT channel, MAX(ts) AS ts FROM aihc_messages GROUP BY channel')
    : await pool.query(`SELECT m.channel, MAX(m.ts) AS ts FROM aihc_messages m
                        JOIN aihc_channels c ON c.id = m.channel AND c.visibility = 'members'
                        GROUP BY m.channel`);
  const latest = {};
  for (const r of q.rows) latest[r.channel] = r.ts;
  return latest;
}
async function msgChannel(id) {
  const q = await pool.query('SELECT channel, name, author FROM aihc_messages WHERE id = $1', [String(id).slice(0, 40)]);
  return q.rows.length ? q.rows[0] : null;
}
/* server stamps ts: chat ordering should not trust skewed phone clocks.
   who: the authenticated identity; members can't post as anyone else. */
async function saveMessage(m, who) {
  const chan = String(m.channel || '').slice(0, 60);
  const ok = await pool.query("SELECT 1 FROM aihc_channels WHERE id = $1 AND status = 'open'", [chan]);
  if (!ok.rows.length) return null;
  if (!canSee(who.role, chan)) return null;
  const msg = {
    id: String(m.id || '').slice(0, 40),
    channel: chan,
    parent: String(m.parent || '').slice(0, 40),
    name: who.role === 'admin' ? (String(m.name || '').slice(0, 80) || who.name) : who.name,
    body: String(m.body || '').slice(0, 4000),
    ts: new Date().toISOString(),
  };
  if (!msg.id || !msg.name || !msg.body.trim()) return null;
  const ins = await pool.query(
    `INSERT INTO aihc_messages (id, channel, parent, name, body, ts, author)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [msg.id, msg.channel, msg.parent, msg.name, msg.body, msg.ts, who.memberId]
  );
  return ins.rows.length ? msg : null;
}
async function toggleReaction(message, name, emoji) {
  const ins = await pool.query(
    `INSERT INTO aihc_reactions (message, name, emoji, ts) VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING message`,
    [String(message).slice(0, 40), String(name).slice(0, 80), String(emoji).slice(0, 8), new Date().toISOString()]
  );
  if (ins.rows.length) return true;
  await pool.query(
    'DELETE FROM aihc_reactions WHERE message = $1 AND name = $2 AND emoji = $3',
    [String(message).slice(0, 40), String(name).slice(0, 80), String(emoji).slice(0, 8)]
  );
  return false;
}
/* delete needs ownership: your own messages, or an admin's word.
   legacy rows (author='') fall back to a display-name match. */
async function deleteMessage(id, who) {
  const mid = String(id).slice(0, 40);
  const m = await msgChannel(mid);
  if (!m) return null;
  if (!canSee(who.role, m.channel)) return null;
  const owns = who.role === 'admin' || m.author === who.memberId || (!m.author && m.name === who.name);
  if (!owns) return null;
  await pool.query('DELETE FROM aihc_reactions WHERE message = $1 OR message IN (SELECT id FROM aihc_messages WHERE parent = $1)', [mid]);
  await pool.query('DELETE FROM aihc_messages WHERE id = $1 OR parent = $1', [mid]);
  return { channel: m.channel };
}

/* history + catch-up + polling fallback */
app.get('/chat', async (req, res) => {
  const who = await gate(req, res, null, 'member'); if (!who) return;
  const chan = String(req.query.channel || 'general').slice(0, 60);
  const since = String(req.query.since || '');
  if (!canSee(who.role, chan)) return res.status(403).json({ error: 'nope' });
  try {
    let rows;
    if (since) {
      const q = await pool.query(
        'SELECT id, channel, parent, name, body, ts FROM aihc_messages WHERE channel = $1 AND ts > $2 ORDER BY ts LIMIT 500',
        [chan, since]
      );
      rows = q.rows;
    } else {
      /* last 200 top-level messages plus every reply in their threads */
      const q = await pool.query(
        `WITH tops AS (
           SELECT id, channel, parent, name, body, ts FROM aihc_messages
           WHERE channel = $1 AND parent = '' ORDER BY ts DESC LIMIT 200
         )
         SELECT * FROM tops
         UNION ALL
         SELECT m.id, m.channel, m.parent, m.name, m.body, m.ts
         FROM aihc_messages m WHERE m.parent IN (SELECT id FROM tops)`,
        [chan]
      );
      rows = q.rows.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    }
    const ids = rows.map(r => r.id);
    const rq = ids.length
      ? await pool.query('SELECT message, name, emoji FROM aihc_reactions WHERE message = ANY($1)', [ids])
      : { rows: [] };
    res.json({
      channels: await chatChannels(false, who.role),
      messages: rows,
      reactions: rq.rows,
      latest: await chatLatest(who.role),
      role: who.role,
      name: who.name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* rest mirror of the ws frames: the no-websocket fallback and the admin console */
app.post('/chat', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'member'); if (!who) return;
  try {
    if (body.action === 'msg' && body.message) {
      const msg = await saveMessage(body.message, who);
      if (!msg) return res.status(400).json({ error: 'bad message' });
      wsBroadcast({ type: 'msg', message: msg }, channelVis.get(msg.channel));
      return res.json({ ok: true, message: msg });
    }
    if (body.action === 'react' && body.message && body.emoji) {
      /* the message's real channel decides visibility; never trust the client's */
      const m = await msgChannel(body.message);
      if (!m || !canSee(who.role, m.channel)) return res.status(403).json({ error: 'nope' });
      const name = who.role === 'admin' ? String(body.name || who.name).slice(0, 80) : who.name;
      const on = await toggleReaction(body.message, name, body.emoji);
      wsBroadcast({ type: 'react', message: String(body.message), channel: m.channel, name, emoji: String(body.emoji).slice(0, 8), on }, channelVis.get(m.channel));
      return res.json({ ok: true, on });
    }
    if (body.action === 'delete' && body.id) {
      const gone = await deleteMessage(body.id, who);
      if (!gone) return res.status(403).json({ error: 'nope' });
      wsBroadcast({ type: 'del', id: String(body.id), channel: gone.channel }, channelVis.get(gone.channel));
      return res.json({ ok: true });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* channels: admin-managed rooms */
app.get('/channels', async (req, res) => {
  const who = await gate(req, res, null, 'member'); if (!who) return;
  try {
    /* admins see everything incl. archived; members see open member rooms */
    res.json({ channels: await chatChannels(who.role === 'admin', who.role) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/channels', async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); }
  }
  const who = await gate(req, res, body, 'admin'); if (!who) return;
  try {
    if ((body.action === 'add' || body.action === 'update') && body.channel && body.channel.name) {
      const c = body.channel;
      const name = String(c.name).trim().slice(0, 60);
      const id = String(c.id || name).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      if (!id || !name) return res.status(400).json({ error: 'bad channel' });
      const ins = await pool.query(
        `INSERT INTO aihc_channels (id, name, topic, pos, status, visibility, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, topic = EXCLUDED.topic, pos = EXCLUDED.pos,
           status = EXCLUDED.status, visibility = EXCLUDED.visibility
         RETURNING (xmax = 0) AS created`,
        [id, name, String(c.topic || '').slice(0, 200), parseInt(c.pos, 10) || 0,
         c.status === 'archived' ? 'archived' : 'open',
         c.visibility === 'admins' ? 'admins' : 'members', new Date().toISOString()]
      );
      await reloadChannelVis();
      broadcastChannels();
      if (body.action === 'add' && ins.rows[0] && ins.rows[0].created && body.announce) {
        await addFeedPost(
          'chan-' + id, 'A new room opened.',
          'There is a new room in the clubhouse: #' + name +
          (c.topic ? ' — ' + String(c.topic).slice(0, 200) : '') +
          '. Pull up a chair: https://aihomebrewclub.com/chat.html',
          '#clubhouse', false, new Date().toISOString()
        );
      }
      return res.json({ ok: true, id });
    }
    if (body.action === 'delete' && body.id) {
      const id = String(body.id);
      const has = await pool.query('SELECT 1 FROM aihc_messages WHERE channel = $1 LIMIT 1', [id]);
      if (has.rows.length) {
        /* keep the history, close the door */
        await pool.query("UPDATE aihc_channels SET status = 'archived' WHERE id = $1", [id]);
      } else {
        await pool.query('DELETE FROM aihc_channels WHERE id = $1', [id]);
      }
      await reloadChannelVis();
      broadcastChannels();
      return res.json({ ok: true, archived: !!has.rows.length });
    }
    res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db' });
  }
});

/* the websocket side: first frame must be a hello with a credential */
async function handleChatFrame(ws, frame) {
  const me = chatClients.get(ws);
  if (!me) {
    if (frame.type !== 'hello') { ws.close(4403, 'nope'); return; }
    const who = await roleFor(frame.token || frame.secret);
    if (!who) { ws.close(4403, 'nope'); return; }
    /* members' names come from their token; only admins may self-declare */
    const name = who.role === 'admin'
      ? (String(frame.name || '').trim().slice(0, 80) || who.name)
      : who.name;
    try {
      let channel = String(frame.channel || 'general').slice(0, 60);
      if (!canSee(who.role, channel)) channel = 'general';
      const channels = await chatChannels(false, who.role);
      const latest = await chatLatest(who.role);
      chatClients.set(ws, { name, role: who.role, memberId: who.memberId, channel, msgTimes: [] });
      ws.send(JSON.stringify({ type: 'welcome', role: who.role, name, channels, who: presenceFor(who.role), latest }));
      broadcastPresence();
    } catch (err) {
      /* a half-welcomed socket is worse than none: close it so the client retries clean */
      console.error('welcome failed:', err.message);
      chatClients.delete(ws);
      ws.close(1011, 'try again');
    }
    return;
  }
  if (frame.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
  if (frame.type === 'here') {
    const channel = String(frame.channel || 'general').slice(0, 60);
    me.channel = canSee(me.role, channel) ? channel : 'general';
    broadcastPresence();
    return;
  }
  if (frame.type === 'msg') {
    /* flood guard: nobody types ten messages in ten seconds */
    const now = Date.now();
    me.msgTimes = me.msgTimes.filter(t => now - t < 10000);
    if (me.msgTimes.length >= 10) {
      ws.send(JSON.stringify({ type: 'err', msg: 'slow down' }));
      return;
    }
    me.msgTimes.push(now);
    /* lazy revocation check: a member revoked out-of-band loses the room mid-sentence */
    if (me.memberId !== 'admin') {
      const still = await pool.query("SELECT 1 FROM aihc_members WHERE id = $1 AND status = 'active'", [me.memberId]);
      if (!still.rows.length) { ws.close(4401, 'revoked'); return; }
    }
    const msg = await saveMessage({ id: frame.id, channel: frame.channel, parent: frame.parent, name: me.name, body: frame.body },
                                  { role: me.role, name: me.name, memberId: me.memberId });
    if (msg) wsBroadcast({ type: 'msg', message: msg }, channelVis.get(msg.channel));
    return;
  }
  if (frame.type === 'react' && frame.message && frame.emoji) {
    const m = await msgChannel(frame.message);
    if (!m || !canSee(me.role, m.channel)) return;
    const on = await toggleReaction(frame.message, me.name, frame.emoji);
    wsBroadcast({ type: 'react', message: String(frame.message).slice(0, 40), channel: m.channel, name: me.name, emoji: String(frame.emoji).slice(0, 8), on }, channelVis.get(m.channel));
    return;
  }
  if (frame.type === 'del' && frame.id) {
    const gone = await deleteMessage(frame.id, { role: me.role, name: me.name, memberId: me.memberId });
    if (!gone) return;
    wsBroadcast({ type: 'del', id: String(frame.id), channel: gone.channel }, channelVis.get(gone.channel));
    return;
  }
}

/* auto reminders: 12 hours and 1 hour before start, once each, to every seated rsvp with an email.
   fires only for events with a start_time set. */
async function runReminders() {
  if (!mailer) return;
  /* until a real admin word exists (db hash from the console, or the env var),
     the burned legacy word is still full admin. one nag email per day, deduped
     through the reminder ledger, until rotation. */
  if (!ADMIN_SECRET && !adminHash) {
    const nag = await pool.query(
      'INSERT INTO aihc_reminders (event, kind, ts) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event',
      ['_meta', 'rotate-nag-' + new Date().toISOString().slice(0, 10), new Date().toISOString()]
    );
    if (nag.rows.length) {
      notify('Rotate the admin secret',
        'The clubhouse admin credential is still the old shared word, which is public in the site\'s git history.\n\n' +
        'Easiest fix: log in to the admin console - it will prompt you to pick a new word right at the gate.\n\n' +
        'Or by hand:\n  heroku config:set ADMIN_SECRET=<a strong new secret> -a aihc-notes\n\n' +
        'Either way the old word stops working everywhere, members keep their personal invite links, ' +
        'and this nag stops.');
    }
  }
  const q = await pool.query("SELECT * FROM aihc_events WHERE status = 'upcoming' AND start_time <> ''");
  const now = Date.now();
  for (const row of q.rows) {
    const ev = {
      title: row.title, when: row.when_text, location: row.location,
      capacity: row.capacity, sort_date: row.sort_date, start_time: row.start_time,
    };
    const start = eventStartUtc(ev);
    if (!start) continue;
    const windows = [
      { kind: '12h', from: start.getTime() - 12 * 3600000, until: start.getTime() - 10 * 3600000 },
      { kind: '1h', from: start.getTime() - 3600000, until: start.getTime() },
    ];
    for (const w of windows) {
      if (now < w.from || now >= w.until) continue;
      const ins = await pool.query(
        'INSERT INTO aihc_reminders (event, kind, ts) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event',
        [row.id, w.kind, new Date().toISOString()]
      );
      if (!ins.rows.length) continue; /* already sent */
      const seats = await pool.query(
        "SELECT * FROM aihc_rsvps WHERE event = $1 AND status = 'seat' AND email <> ''", [row.id]
      );
      for (const s of seats.rows) {
        mailTo(
          s.email,
          (w.kind === '12h' ? 'Reminder: ' : 'Almost time: ') + ev.title + ', ' + ev.when,
          'Hey ' + s.name + ',\n\n' +
          (w.kind === '12h'
            ? (s.guest_name ? 'Your seats are saved, yours and ' + s.guest_name + '\'s.' : 'Your seat is saved.')
            : 'It is nearly time. Your seat is waiting.') +
          '\n\nWhen: ' + ev.when + ', ' + fmtTime(ev.start_time) +
          '\nWhere: ' + ev.location +
          '\nBring: a laptop or just your phone, and one real task that is eating your week.' +
          (w.kind === '12h'
            ? '\n\nKnow a neighbor who should be at this table? Send them your link: ' + shareUrl(row.id, s.id)
            : '') +
          '\n\nCannot make it after all? Free the seat for a neighbor: ' + cancelUrl(row.id, s.id) +
          '\n\nCoffee is on.\nThe AI Homebrew Club\nhttps://aihomebrewclub.com'
        );
      }
      notify('Reminders sent (' + w.kind + '): ' + ev.when, 'Sent to ' + seats.rows.length + ' seated RSVPs for ' + row.id + '.');
    }
  }
}
cron.schedule('*/5 * * * *', () => { runReminders().catch(err => console.error('reminders failed:', err.message)); });

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/chat/ws' });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  /* a socket that never says hello gets shown the door */
  const helloTimer = setTimeout(() => { if (!chatClients.has(ws)) ws.close(4403, 'nope'); }, 10000);
  ws.on('message', data => {
    let frame;
    try { frame = JSON.parse(String(data).slice(0, 8000)); } catch { return; }
    if (!frame || typeof frame.type !== 'string') return;
    handleChatFrame(ws, frame).catch(err => console.error('chat frame failed:', err.message));
  });
  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (chatClients.delete(ws)) broadcastPresence();
  });
  ws.on('error', () => {});
});

/* protocol pings every 30s: keeps heroku's 55s idle router timeout at bay
   and reaps sockets that stopped answering */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

init()
  .then(() => server.listen(PORT, () => console.log('aihc-notes listening on ' + PORT)))
  .catch(err => { console.error('init failed', err); process.exit(1); });
