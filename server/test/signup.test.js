/* Runs the REAL POST /signup handler lifted out of server.js against an in-memory club: a fake
   Postgres pool, a capturing mailer, the real email templates. No network, nothing sent.
   The sign-up page is the one door for the whole club: pick a town (or both) and you are on
   its list, with one welcome note that carries the next table, a seat link and the card.
   usage: npm test   (or: node test/signup.test.js [server.js] [email.js]) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const serverPath = process.argv[2] || path.join(__dirname, '..', 'server.js');
const emailPath = process.argv[3] || path.join(__dirname, '..', 'email.js');
const label = 'signup (server/server.js)';
const src = fs.readFileSync(serverPath, 'utf8').split(/\r?\n/);

function lift(head, tail) {
  const i = src.findIndex(l => l.startsWith(head));
  if (i < 0) throw new Error('not found in ' + serverPath + ': ' + head);
  let j = i;
  while (j < src.length && src[j] !== tail) j++;
  if (j >= src.length) throw new Error('no end for ' + head);
  return src.slice(i, j + 1).join('\n');
}
const helpers = [
  lift('function eventStartUtc(', '}'),
  lift('function calStamp(', '}'),
  lift('const CHAPTERS = {', '};'),
  lift('function chapterOf(', '}'),
  lift('function eventMinutes(', '}'),
  lift('function lengthWord(', '}'),
  lift('function gcalUrl(', '}'),
  lift('function cleanRef(', '}'),
  lift('async function seatsTaken(', '}'),
  lift('function eventView(', '}'),
  lift('function rosterUrl(', '}'),
  lift('function rsvpLink(', '}'),
  lift('function cardAttachment(', '}'),
  'const SIGNUP_BUCKET = new Map();',
].join('\n\n');
/* the route body: `app.post('/signup', async (req, res) => { ... });` becomes a plain function */
const route = lift("app.post('/signup', ", '});')
  .replace("app.post('/signup', ", 'return ')
  .replace(/\);\s*$/, ';');

const Email = require(path.resolve(emailPath));
let world;
function reset() { world = { events: [], roster: [], invites: [], rsvps: [], posts: [], sent: [], notes: [], card: null }; }
reset();

const pool = {
  async query(sql, params) {
    params = params || [];
    if (sql.includes('q:signup-upsert')) {
      const [city, email, name, phone, biz, token, ts] = params;
      const k = world.roster.find(r => r.city === city && r.email === email);
      if (k) { if (name) k.name = name; if (phone) k.phone = phone; if (biz) k.biz = biz; k.status = 'in'; }
      else world.roster.push({ city, email, name, phone, biz, token, status: 'in', last_event: '', ts });
      return { rows: [] };
    }
    if (sql.includes('q:signup-token')) return { rows: world.roster.filter(r => r.city === params[0] && r.email === params[1]).map(r => ({ token: r.token })) };
    if (sql.includes('q:signup-next')) {
      return { rows: world.events.filter(e => e.city === params[0] && e.status === 'upcoming' && e.sort_date >= params[1]).sort((a, b) => a.sort_date.localeCompare(b.sort_date)).slice(0, 1) };
    }
    if (sql.includes('q:signup-asked')) return { rows: world.invites.filter(i => i.event === params[0] && i.email.toLowerCase() === params[1] && !i.by.startsWith('note:')).slice(0, 1) };
    if (sql.includes('q:signup-invite')) {
      const [id, event, email, name, by, ts] = params;
      world.invites.push({ id, event, email, name, by, ts });
      return { rows: [] };
    }
    if (sql.includes('COALESCE(SUM') && sql.includes("status = 'seat'")) {
      const n = world.rsvps.filter(r => r.event === params[0] && r.status === 'seat').reduce((a, r) => a + 1 + (r.guest_name ? 1 : 0), 0);
      return { rows: [{ n }] };
    }
    throw new Error('unexpected query: ' + sql.slice(0, 90));
  },
};
const stubs = {
  pool, Email,
  mailTo: (to, subject, text, attachments, html, opts) => { world.sent.push({ to, subject, text, html, attachments: attachments || [], cc: !!(opts && opts.cc) }); },
  notify: (subject, text) => { world.notes.push({ subject, text }); },
  addFeedPost: async (id, title, body) => { world.posts.push({ id, title, body }); return { rows: [{ id }] }; },
  newToken: () => crypto.randomBytes(24).toString('hex'),
  cardFor: async () => world.card,
  mailer: {},
  NOTIFY_EMAIL: 'club@example.test',
  API_BASE: 'https://api.example.test',
};
const names = Object.keys(stubs);
const make = new Function(...names, helpers + '\n' + route);
const handler = make(...names.map(k => stubs[k]));

let ipCounter = 0;
async function post(body, ip) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ body: JSON.stringify(body), headers: { 'x-forwarded-for': ip || ('10.0.0.' + (++ipCounter)) }, socket: {} }, res);
  return res;
}
const TODAY = Email.maineToday(new Date());
const future = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const PDX = { id: 'pdx', city: 'portland', title: 'Portland meetup no. 2', when_text: 'Thursday, November 19', sort_date: future(30), start_time: '16:00', minutes: 120, location: 'the conference room at Maine & Co., 280 Fore St, Suite 402, Portland', capacity: 12, status: 'upcoming', ts: '2026-01-01T00:00:00Z' };
const WTV = { id: 'wtv', city: 'waterville', title: 'AI Brown Bag no. 4', when_text: 'Tuesday, November 10', sort_date: future(21), start_time: '10:00', minutes: 60, location: 'the conference room at Bricks Coworking, 10 Water St, Waterville', capacity: 8, status: 'upcoming', ts: '2026-01-01T00:00:00Z' };
const CARD = { png: Buffer.from('89504e470d0a1a0a', 'hex'), url: 'https://aihomebrewclub.com/cards/pdx.png', dated: true, cid: 'card-pdx@aihomebrewclub.com', filename: 'ai-homebrew-club-pdx.png' };

let failures = 0;
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function scenario(name, fn) {
  reset();
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { failures++; console.log('  FAIL  ' + name + '\n        -> ' + e.message); }
}

(async () => {
  console.log('\n=== ' + label + ' ===');

  await scenario('joining a town puts you on its list and sends the welcome with the next table, a seat link and the card', async () => {
    world.events = [PDX];
    world.card = CARD;
    const r = await post({ cities: ['portland'], name: 'Pat Example', email: 'Pat@Example.test', phone: '207-555-0100', biz: 'Example Co.', ref: 'card' });
    expect(r.code === 200 && r.body.ok, 'expected ok, got ' + JSON.stringify(r.body));
    expect(world.roster.length === 1 && world.roster[0].city === 'portland' && world.roster[0].email === 'pat@example.test' && world.roster[0].status === 'in' && world.roster[0].token.length === 48, 'one roster row, lowercased, in, with a token: ' + JSON.stringify(world.roster));
    expect(world.invites.length === 1 && world.invites[0].event === 'pdx' && world.invites[0].by === 'signup', 'the welcome should be logged as this table\'s invite');
    expect(world.sent.length === 1 && world.sent[0].to === 'pat@example.test' && !world.sent[0].cc, 'one welcome to the person, no cc: ' + JSON.stringify(world.sent.map(m => [m.to, m.cc])));
    const m = world.sent[0];
    expect(m.subject === 'You are on the Portland list.', 'wrong subject: ' + m.subject);
    expect(m.text.includes('Save your seat (takes ten seconds): https://aihomebrewclub.com/rsvp.html?event=pdx&ref=signup-card&name=Pat%20Example&email=pat%40example.test'), 'the seat link should be prefilled and carry the ref: ' + m.text);
    expect(m.text.includes('12 of 12 open') && m.text.includes('Thursday, November 19'), 'the next table should be in the note');
    expect(m.attachments.length === 1 && m.attachments[0].cid === CARD.cid && m.html.includes('cid:' + CARD.cid), 'the card should ride along, shown and attached');
    expect(m.html.includes('/roster/optout?t=' + world.roster[0].token) && m.text.includes('Text them the card attached to this note'), 'opt-out link and the neighbor line missing');
    expect(world.notes.length === 1 && world.notes[0].subject === 'Joined the Portland list: Pat Example' && world.notes[0].text.includes('Heard via: card'), 'the host should hear: ' + JSON.stringify(world.notes));
    expect(world.posts.length === 1 && world.posts[0].body === 'Pat Example joined the Portland list.', 'one feed post');
    expect(r.body.towns.length === 1 && r.body.towns[0].next && r.body.towns[0].next.left === 12 && r.body.towns[0].next.rsvp.includes('ref=signup-card'), 'the page gets the next table back: ' + JSON.stringify(r.body));
  });

  await scenario('both towns at once: one note, two tables, two cards, two rows', async () => {
    world.events = [PDX, WTV];
    world.rsvps = [{ event: 'wtv', status: 'seat', guest_name: '' }, { event: 'wtv', status: 'seat', guest_name: 'Plus One' }];
    world.card = CARD;
    const r = await post({ cities: ['waterville', 'portland', 'portland', 'nowhere'], name: 'Pat Example', email: 'pat@example.test' });
    expect(r.code === 200 && r.body.towns.map(t => t.city).join(',') === 'waterville,portland', 'two towns, deduped, unknown dropped: ' + JSON.stringify(r.body.towns));
    expect(world.roster.length === 2 && world.invites.length === 2, 'a row and an invite per town');
    expect(world.sent.length === 1, 'exactly one note, never two');
    const m = world.sent[0];
    expect(m.subject === 'You are on the Waterville and Portland lists.', 'wrong subject: ' + m.subject);
    expect(m.text.includes('5 of 8 open') && m.text.includes('12 of 12 open'), 'both tables with their open chairs: ' + m.text);
    expect(m.html.includes('Save my seat in Waterville') && m.html.includes('Save my seat in Portland'), 'a seat button per town');
    expect(m.attachments.length === 2, 'a card per town, got ' + m.attachments.length);
    expect(world.notes[0].subject === 'Joined the Waterville and Portland lists: Pat Example', 'wrong note: ' + world.notes[0].subject);
  });

  await scenario('a town with nothing on the calendar: on the list, told so, no card', async () => {
    world.events = [];
    const r = await post({ cities: ['waterville'], name: 'Pat Example', email: 'pat@example.test' });
    expect(r.code === 200 && r.body.towns[0].next === null, 'no next table: ' + JSON.stringify(r.body));
    expect(world.roster.length === 1 && world.invites.length === 0, 'on the list, nothing invited');
    const m = world.sent[0];
    expect(m && m.text.includes('Nothing is on the calendar yet; we will write when there is.') && m.attachments.length === 0, 'the note should say so: ' + (m || {}).text);
    expect(!m.text.includes('Save your seat'), 'no seat link without a table');
  });

  await scenario('a repeat sign-up refreshes the row, puts a paused person back on, and never doubles the invite', async () => {
    world.events = [PDX];
    world.roster = [{ city: 'portland', email: 'pat@example.test', name: 'Old Name', phone: '', biz: '', token: 'a'.repeat(48), status: 'out', last_event: 'old', ts: '2026-01-01T00:00:00Z' }];
    world.invites = [{ id: 'iv1', event: 'pdx', email: 'pat@example.test', name: 'Pat', by: 'roster', ts: '2026-01-02T00:00:00Z' }];
    const r = await post({ cities: ['portland'], name: 'Pat Example', email: 'pat@example.test', phone: '207-555-0100' });
    expect(r.code === 200, 'ok expected');
    expect(world.roster.length === 1 && world.roster[0].status === 'in' && world.roster[0].name === 'Pat Example' && world.roster[0].phone === '207-555-0100' && world.roster[0].last_event === 'old' && world.roster[0].token === 'a'.repeat(48),
      'the row should be refreshed in place: ' + JSON.stringify(world.roster));
    expect(world.invites.length === 1, 'already invited to this table: no second invite row');
    expect(world.sent.length === 1 && world.sent[0].html.includes('/roster/optout?t=' + 'a'.repeat(48)), 'the welcome still goes, with the existing token');
  });

  await scenario('the honeypot, the host\'s own address, and bad input write nothing', async () => {
    world.events = [PDX];
    const hp = await post({ cities: ['portland'], name: 'Bot', email: 'bot@example.test', website: 'http://spam' });
    expect(hp.code === 200 && hp.body.ok && hp.body.towns.length === 0, 'the honeypot answers ok and does nothing');
    const host = await post({ cities: ['portland'], name: 'Brett', email: 'Club@example.test' });
    expect(host.code === 200 && host.body.towns.length === 0, 'the host never joins a roster');
    const noTown = await post({ cities: ['nowhere'], name: 'Pat', email: 'pat@example.test' });
    const noEmail = await post({ cities: ['portland'], name: 'Pat', email: 'pat example' });
    expect(noTown.code === 400 && noEmail.code === 400, 'bad input is a 400: ' + noTown.code + ' ' + noEmail.code);
    expect(world.roster.length === 0 && world.sent.length === 0 && world.notes.length === 0, 'nothing written, nothing sent');
  });

  await scenario('the brake: the eleventh sign-up from one address in a minute is refused', async () => {
    world.events = [PDX];
    let last;
    for (let i = 0; i < 11; i++) last = await post({ cities: ['portland'], name: 'Pat ' + i, email: 'pat' + i + '@example.test' }, '203.0.113.9');
    expect(last.code === 429, 'the eleventh should be refused, got ' + last.code);
    expect(world.roster.length === 10, 'ten got through, got ' + world.roster.length);
  });

  console.log('\n' + label + ': ' + (failures ? failures + ' scenario(s) FAILED' : 'all scenarios passed'));
  process.exit(failures ? 1 : 0);
})();
