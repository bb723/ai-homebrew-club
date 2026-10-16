/* Runs the REAL runRoster() lifted out of server.js against an in-memory club: a fake Postgres
   pool, a capturing mailer, the real email templates and the real calendar helpers. No network,
   no database, nothing sent.
   The roster is four promises: the book closes by itself; everyone who ever reserved, waited,
   gave a chair back or was invited by hand in a town is on its roster; once per table the whole
   roster hears, with a seat link and the card (whoever sat at the last table gets it as the
   thank-you), and nobody is ever seated by the loop; and the whole town hears again one week out.
   Mail only goes out 9 am to 8 pm Maine time.
   usage: npm test   (or: node test/roster.test.js [server.js] [email.js]) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const serverPath = process.argv[2] || path.join(__dirname, '..', 'server.js');
const emailPath = process.argv[3] || path.join(__dirname, '..', 'email.js');
const label = 'roster (server/server.js)';
const src = fs.readFileSync(serverPath, 'utf8').split(/\r?\n/);

function lift(head, tail) {
  const i = src.findIndex(l => l.startsWith(head));
  if (i < 0) throw new Error('not found in ' + serverPath + ': ' + head);
  let j = i;
  while (src[j] !== tail) j++;
  return src.slice(i, j + 1).join('\n');
}
const code = [
  lift('function eventStartUtc(', '}'),
  lift('function calStamp(', '}'),
  lift('const CHAPTERS = {', '};'),
  lift('function chapterOf(', '}'),
  lift('function eventMinutes(', '}'),
  lift('function lengthWord(', '}'),
  lift('function gcalUrl(', '}'),
  lift('function cancelUrl(', '}'),
  lift('function partySize(', '}'),
  lift('async function seatsTaken(', '}'),
  lift('async function findReservation(', '}'),
  lift('function shareUrl(', '}'),
  lift('function addFeedPost(', '}'),
  lift('function eventView(', '}'),
  lift('function eventEndMs(', '}'),
  lift('function rosterUrl(', '}'),
  lift('function rsvpLink(', '}'),
  lift('async function markOnce(', '}'),
  lift('function cardAttachment(', '}'),
  lift('function roomUrl(', '}'),
  lift('async function roomCount(', '}'),
  lift('async function roomStatusLine(', '}'),
  lift('async function askRoom(', '}'),
  lift('async function askRoomSeries(', '}'),
  lift('async function runRoster(', '}'),
].join('\n\n');

const Email = require(path.resolve(emailPath));
let world;
function reset() {
  world = { events: [], rsvps: [], roster: [], markers: new Set(), posts: [], invites: [], agenda: [], sent: [], notes: [], card: null, rooms: [], checks: [] };
}
reset();

const byDate = (a, b) => a.sort_date.localeCompare(b.sort_date);
const lower = s => String(s || '').trim().toLowerCase();
const pool = {
  async query(sql, params) {
    params = params || [];
    if (sql.includes('q:open-events')) return { rows: world.events.filter(e => e.status === 'upcoming') };
    if (sql.includes('q:close-event')) {
      const e = world.events.find(x => x.id === params[0] && x.status === 'upcoming');
      if (e) e.status = 'past';
      return { rows: [] };
    }
    if (sql.includes('q:towns')) return { rows: [...new Set(world.events.map(e => e.city))].map(city => ({ city })) };
    if (sql.includes('q:invited')) {
      const ids = new Set(world.events.filter(e => e.city === params[0]).map(e => e.id));
      const rows = world.invites
        .filter(i => ids.has(i.event) && i.email && !i.by.startsWith('note:') && !i.by.startsWith('resched:') && i.by !== 'roster')
        .map(i => ({ name: i.name, email: i.email }));
      return { rows };
    }
    if (sql.includes('q:interest')) {
      const rows = [];
      for (const e of world.events.filter(e => e.city === params[0]).sort(byDate)) {
        for (const r of world.rsvps.filter(r => r.event === e.id && r.email)) {
          rows.push({ name: r.name, email: r.email, phone: r.phone || '', biz: r.biz || '', event: e.id, rstatus: r.status, estatus: e.status });
        }
      }
      return { rows };
    }
    if (sql.includes('q:roster-upsert')) {
      const [city, email, name, phone, biz, token, last_event, ts] = params;
      const k = world.roster.find(r => r.city === city && r.email === email);
      if (k) { if (name) k.name = name; if (phone) k.phone = phone; if (biz) k.biz = biz; if (last_event) k.last_event = last_event; }
      else world.roster.push({ city, email, name, phone, biz, token, status: 'in', last_event, ts });
      return { rows: [] };
    }
    if (sql.includes('q:last-table')) {
      return { rows: world.events.filter(e => e.city === params[0] && e.status === 'past').sort((a, b) => byDate(b, a)).slice(0, 1) };
    }
    if (sql.includes('q:next-table')) {
      return { rows: world.events.filter(e => e.city === params[0] && e.status === 'upcoming' && e.sort_date >= params[1]).sort(byDate).slice(0, 1) };
    }
    if (sql.includes('INSERT INTO aihc_reminders')) {
      const k = params[0] + '|' + params[1];
      if (world.markers.has(k)) return { rows: [] };
      world.markers.add(k);
      return { rows: [{ event: params[0] }] };
    }
    if (sql.includes('q:room-count')) return { rows: [{ n: world.rooms.filter(r => r.city === params[0]).length }] };
    if (sql.includes('q:room-contacts')) return { rows: world.rooms.filter(r => r.city === params[0]) };
    if (sql.includes('q:room-checks')) return { rows: world.checks.filter(c => c.event === params[0]) };
    if (sql.includes('q:holder-checks')) return { rows: world.checks.filter(c => c.email === params[0]) };
    if (sql.includes('q:coming-tables')) {
      return { rows: world.events.filter(e => e.city === params[0] && e.status === 'upcoming' && e.sort_date >= params[1]).sort(byDate).slice(0, params[2]) };
    }
    if (sql.includes('q:opted-out')) return { rows: world.roster.filter(r => r.city === params[0] && r.status === 'out').map(r => ({ name: r.name, email: r.email })) };
    if (sql.includes('q:last-seats')) return { rows: world.rsvps.filter(r => r.event === params[0] && r.status === 'seat') };
    if (sql.includes('q:agenda')) return { rows: world.agenda.filter(a => a.event === params[0]) };
    if (sql.includes('q:roster-in')) return { rows: world.roster.filter(r => r.city === params[0] && r.status === 'in') };
    if (sql.includes('q:on-book')) {
      return { rows: world.rsvps.filter(r => r.event === params[0] && (r.status === 'seat' || r.status === 'waitlist') && r.email).map(r => ({ e: lower(r.email) })) };
    }
    if (sql.includes('q:asked')) return { rows: world.invites.filter(i => i.event === params[0] && !i.by.startsWith('note:')).map(i => ({ e: lower(i.email) })) };
    if (sql.includes('q:week-events')) return { rows: world.events.filter(e => e.status === 'upcoming' && e.start_time) };
    if (sql.includes('q:book')) return { rows: world.rsvps.filter(r => r.event === params[0] && (r.status === 'seat' || r.status === 'waitlist')) };
    if (sql.includes('q:declined')) {
      return { rows: world.rsvps.filter(r => r.event === params[0] && (r.status === 'cancelled' || r.status === 'rescheduled') && r.email).map(r => ({ e: lower(r.email) })) };
    }
    if (sql.includes('COALESCE(SUM') && sql.includes("status = 'seat'")) {
      const n = world.rsvps.filter(r => r.event === params[0] && r.status === 'seat').reduce((a, r) => a + 1 + (r.guest_name ? 1 : 0), 0);
      return { rows: [{ n }] };
    }
    if (sql.includes('INSERT INTO aihc_rsvps')) {
      const [id, event, name, contact, email, phone, biz, note, status, ts, ref, guest_name] = params;
      world.rsvps.push({ id, event, name, contact, email, phone, biz, note, status, ts, ref, guest_name });
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO aihc_posts')) {
      if (world.posts.some(p => p.id === params[0])) return { rows: [] };
      world.posts.push({ id: params[0], title: params[1], body: params[2] });
      return { rows: [{ id: params[0] }] };
    }
    if (sql.includes('INSERT INTO aihc_invites')) {
      const [id, event, email, name, by, ts] = params;
      world.invites.push({ id, event, email, name, by, ts });
      return { rows: [] };
    }
    throw new Error('unexpected query: ' + sql);
  },
};
const mailTo = (to, subject, text, attachments, html, opts) => {
  world.sent.push({ to, subject, text, html, attachments: attachments || [], cc: !!(opts && opts.cc) });
};
const notify = (subject, text) => { world.notes.push({ subject, text }); };
const newToken = () => crypto.randomBytes(24).toString('hex');
const cardFor = async () => world.card;

const make = new Function('pool', 'Email', 'mailTo', 'notify', 'mailer', 'newToken', 'API_BASE', 'fmtTime', 'cardFor', 'NOTIFY_EMAIL',
  code + '\nreturn { runRoster, eventStartUtc, askRoomSeries };');
const { runRoster, eventStartUtc, askRoomSeries } = make(pool, Email, mailTo, notify, {}, newToken, 'https://api.example.test', Email.fmtTime, cardFor, 'club@example.test');

/* the clock the loop runs on: a fixed instant today at a given Maine hour, so the scenarios
   never depend on when the suite happens to run */
function maineAt(hour) {
  const base = new Date();
  for (let k = -30; k <= 30; k++) {
    const d = new Date(base.getTime() + k * 3600000);
    d.setUTCMinutes(7, 0, 0);
    if (Email.maineHour(d) === hour) return d;
  }
  throw new Error('no instant found for Maine hour ' + hour);
}
const AT = maineAt(11);         /* late morning: inside the send window */
const LATE = new Date(AT.getTime() + 11 * 3600000);   /* the same evening, after eight: outside it */
const TODAY = Email.maineToday(AT);

/* an event whose Maine-time start lands `hours` from AT (the server stores local date + HH:MM) */
function eventAt(id, hours, extra) {
  const target = AT.getTime() + hours * 3600000;
  for (const off of [4, 5]) {
    const local = new Date(target - off * 3600000);
    const sort_date = local.toISOString().slice(0, 10);
    const start_time = local.toISOString().slice(11, 16);
    const st = eventStartUtc({ sort_date, start_time });
    if (st && Math.abs(st.getTime() - target) < 60000) {
      return Object.assign({
        id, city: 'waterville', title: 'Table ' + id, when_text: 'Table day ' + id, sort_date, start_time,
        minutes: 60, location: 'the conference room at Bricks Coworking, 10 Water St, Waterville',
        capacity: 8, status: 'upcoming', ts: '2026-01-01T00:00:00Z',
      }, extra || {});
    }
  }
  throw new Error('could not place an event ' + hours + 'h out');
}
const pastTable = (id, sort_date, extra) => Object.assign({
  id, city: 'waterville', title: 'Table ' + id, when_text: 'Table day ' + id, sort_date, start_time: '10:00', minutes: 60,
  location: 'the conference room at Bricks Coworking, 10 Water St, Waterville', capacity: 8, status: 'past', ts: '2026-01-01T00:00:00Z',
}, extra || {});
const seat = (event, name, email, more) => Object.assign(
  { id: 'r-' + event + '-' + name.toLowerCase().replace(/[^a-z]/g, ''), event, name, email, phone: '', biz: '', status: 'seat', guest_name: '', attended: false, ref: 'qr', ts: '2026-02-01T00:00:00Z' }, more || {});
const onRoster = (city, name, email, status, last_event) => ({ city, email, name, phone: '', biz: '', token: 'tok-' + name.split(' ')[0].toLowerCase(), status, last_event: last_event || '', ts: '2026-02-11T00:00:00Z' });
const CARD = { png: Buffer.from('89504e470d0a1a0a', 'hex'), url: 'https://aihomebrewclub.com/cards/n.png', dated: true, cid: 'card-n@aihomebrewclub.com', filename: 'ai-homebrew-club-n.png' };
const THANKS = 'Thanks for coming. The next Waterville table is';
const NEXT = 'The next Waterville table is on the calendar';

let failures = 0;
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function scenario(name, fn) {
  reset();
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { failures++; console.log('  FAIL  ' + name + '\n        -> ' + e.message); }
}

(async () => {
  console.log('\n=== ' + label + ' ===');

  await scenario('the book closes by itself two hours after a meetup ends, and not before', async () => {
    world.events = [eventAt('done', -3.5), eventAt('fresh', -1.5), eventAt('later', 72),
      pastTable('dateonly', '2026-01-05', { status: 'upcoming', start_time: '' })];
    await runRoster(AT);
    const st = id => world.events.find(e => e.id === id).status;
    expect(st('done') === 'past', 'a meetup that ended 2.5h ago should be past');
    expect(st('fresh') === 'upcoming', 'a meetup that ended 30 minutes ago should still be upcoming');
    expect(st('later') === 'upcoming', 'a meetup three days out should still be upcoming');
    expect(st('dateonly') === 'past', 'a dated meetup with no clock time should close after its day');
  });

  await scenario('right after a table, whoever sat there gets a thank-you with a seat link, and nothing is held', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [
      seat('l', 'Ada Alpha', 'ada@example.test', { phone: '207-555-0101', biz: 'Alpha Plumbing' }),
      seat('l', 'Ben Bravo', 'ben@example.test', { guest_name: 'Cy Guest' }),
      seat('l', 'Dee NoEmail', ''),
    ];
    world.agenda = [
      { event: 'l', t: '10:00 am', title: 'Find your seat', detail: '' },
      { event: 'n', t: '10:00 am', title: 'Receipts into a table', detail: '' },
    ];
    await runRoster(AT);
    expect(world.rsvps.filter(r => r.event === 'n').length === 0, 'nobody should be seated by the loop');
    expect(world.posts.length === 0, 'no feed post: nothing was held');
    expect(world.sent.length === 2 && world.sent.every(m => m.cc), 'expected 2 thank-you notes, each cc to the host; got ' + world.sent.length);
    const ada = world.sent.find(m => m.to === 'ada@example.test');
    expect(ada && ada.subject.startsWith(THANKS), 'wrong subject: ' + (ada || {}).subject);
    expect(ada.text.includes('Good to have you at the table on Table day l.'), 'the note should name the last table');
    expect(!ada.text.includes('On the sheet') && !/held|standing/i.test(ada.text), 'no recap line, no held chair: ' + ada.text.slice(0, 400));
    expect(ada.text.includes('Chairs are first come, first served, so if you want one, save it now.'), 'the opt-in line is missing');
    expect(ada.text.includes('Save your seat (takes ten seconds): https://aihomebrewclub.com/rsvp.html?event=n&ref=thanks&name=Ada%20Alpha&email=ada%40example.test'), 'the seat link should be prefilled and tagged thanks');
    expect(ada.text.includes('Receipts into a table') && !ada.text.includes('Find your seat'), 'the note carries the next run sheet, not the last one');
    expect(ada.html.includes('/roster/optout?t=') && ada.html.includes('stop these notes'), 'the opt-out line is missing');
    expect(ada.text.includes('rsvp.html?event=n&ref=friend'), 'the neighbor link is missing');
    expect(world.invites.filter(i => i.event === 'n' && i.by === 'roster').length === 2, 'both notes should be logged as invites');
    const note = world.notes.find(n => n.subject.startsWith('The roster heard:'));
    expect(note && note.text.includes('Thanked, they sat at Table l (Table day l) (2)') && note.text.includes('Nobody was seated'), 'admin note should list the thanked: ' + (note || {}).text);
    expect(note.text.includes('Nobody was marked attended'), 'the attendance nudge should appear when attendance was not taken');
    expect(world.roster.length === 2, 'the roster should hold the two with emails, got ' + world.roster.length);
  });

  await scenario('weeks after a table, it is the plain next-table note, as someone who has sat with us', async () => {
    world.events = [pastTable('l', '2026-02-10'), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    await runRoster(AT);
    expect(world.sent.length === 1 && world.sent[0].subject.startsWith(NEXT), 'wrong subject: ' + (world.sent[0] || {}).subject);
    expect(world.sent[0].text.includes('You have sat with us before'), 'wrong opener: ' + world.sent[0].text.slice(0, 200));
    expect(world.sent[0].text.includes('rsvp.html?event=n&ref=roster&name=Ada%20Alpha&email=ada%40example.test'), 'the seat link should be prefilled');
    expect(world.rsvps.filter(r => r.event === 'n').length === 0, 'nobody should be seated by the loop');
  });

  await scenario('an evening close waits for the morning: no notes after eight', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72), pastTable('old', '2026-01-13')];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test'), seat('old', 'Olive Older', 'olive@example.test')];
    await runRoster(LATE);
    expect(world.sent.length === 0 && world.markers.size === 0, 'expected silence after eight, got ' + world.sent.length + ' mails and ' + world.markers.size + ' markers');
    expect(world.roster.length === 2, 'the roster still fills in the evening, got ' + world.roster.length);
    await runRoster(AT);
    expect(world.sent.length === 2, 'the morning tick should send the thank-you and the next-table note, got ' + world.sent.length);
    expect(world.sent.find(m => m.to === 'ada@example.test').subject.startsWith(THANKS), 'Ada sat at the last table: the thank-you');
    expect(world.sent.find(m => m.to === 'olive@example.test').subject.startsWith(NEXT), 'Olive sat at an older one: the next-table note');
  });

  await scenario('the next tick sends nothing twice', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    await runRoster(AT);
    await runRoster(AT);
    await runRoster(AT);
    expect(world.sent.length === 1, 'expected exactly 1 note across three ticks, got ' + world.sent.length);
    expect(world.rsvps.filter(r => r.event === 'n').length === 0, 'still nobody seated');
  });

  await scenario('when the host marked attendance, only those marked get the thank-you; the rest hear the plain note', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [
      seat('l', 'Ada Alpha', 'ada@example.test', { attended: true }),
      seat('l', 'Ben Bravo', 'ben@example.test', { attended: false }),
    ];
    await runRoster(AT);
    expect(world.sent.length === 2, 'both should hear, got ' + world.sent.length);
    expect(world.sent.find(m => m.to === 'ada@example.test').subject.startsWith(THANKS), 'Ada was marked attended: the thank-you');
    expect(world.sent.find(m => m.to === 'ben@example.test').subject.startsWith(NEXT), 'Ben was not: the next-table note');
    const note = world.notes.find(n => n.subject.startsWith('The roster heard:'));
    expect(note.text.includes('Thanked, they sat at Table l (Table day l) (1)') && note.text.includes('Told the next table is up (1)'), 'the note should split them: ' + note.text);
    expect(!note.text.includes('Nobody was marked attended'), 'the attendance nudge should not appear when attendance was taken');
  });

  await scenario('a full next table: the thank-you points at the waitlist', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72, { capacity: 2 })];
    world.rsvps = [
      seat('n', 'Early Bird', 'early@example.test'),
      seat('n', 'Second Bird', 'second@example.test'),
      seat('l', 'Ada Alpha', 'ada@example.test'),
    ];
    await runRoster(AT);
    const ada = world.sent.find(m => m.to === 'ada@example.test');
    expect(world.sent.length === 1 && ada && ada.subject.startsWith(THANKS), 'Ada alone should hear, got ' + world.sent.map(m => m.to));
    expect(ada.text.includes('Join the waitlist (takes ten seconds):') && ada.text.includes('Full. The waitlist moves'), 'the full-table wording is missing: ' + ada.text.slice(0, 500));
    expect(world.rsvps.filter(r => r.event === 'n').length === 2, 'nobody should be waitlisted by the loop');
  });

  await scenario('already on the book, invited by hand, or paused: left alone, and the host hears why', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [
      seat('l', 'Ada Alpha', 'ada@example.test'),
      seat('l', 'Ben Bravo', 'ben@example.test'),
      seat('l', 'Cal Charlie', 'cal@example.test'),
      seat('n', 'Ada Alpha', 'ADA@example.test', { ref: 'town' }),
    ];
    world.roster = [onRoster('waterville', 'Ben Bravo', 'ben@example.test', 'out', 'l')];
    world.invites = [{ id: 'iv0', event: 'n', email: 'cal@example.test', name: 'Cal Charlie', by: 'Brett', ts: '2026-02-12T00:00:00Z' }];
    await runRoster(AT);
    expect(world.sent.length === 0, 'expected no mail, got ' + world.sent.map(m => m.to));
    expect(world.roster.find(r => r.email === 'ben@example.test').status === 'out', 'the roster must not flip a paused person back on');
    const note = world.notes.find(n => n.subject.startsWith('The roster heard:'));
    expect(note && note.text.includes('Ada Alpha <ada@example.test>: already on the book') && note.text.includes('Cal Charlie <cal@example.test>: already invited'), 'the note should explain the skips: ' + (note || {}).text);
    expect(note.text.includes('Paused, left alone (1):') && note.text.includes('Ben Bravo <ben@example.test>'), 'the note should list the paused');
  });

  await scenario('everyone who ever reserved, waited, gave a chair back or was invited by hand is on the roster', async () => {
    world.events = [pastTable('old', '2026-01-13'), eventAt('n', 72)];
    world.rsvps = [
      seat('old', 'Olive Older', 'olive@example.test'),
      seat('old', 'Wally Waited', 'wally@example.test', { status: 'waitlist' }),
      seat('old', 'Deb Declined', 'deb@example.test', { status: 'cancelled' }),
      seat('n', 'Nia NextBook', 'nia@example.test', { ref: 'town' }),
    ];
    world.invites = [
      { id: 'iv1', event: 'old', email: 'ivan@example.test', name: 'Ivan Invited', by: 'Brett', ts: '2026-01-02T00:00:00Z' },
      { id: 'nt1', event: 'old', email: 'nate@example.test', name: 'Nate Noted', by: 'note:Brett', ts: '2026-01-02T00:00:00Z' },
      { id: 'rs1', event: 'old', email: 'rae@example.test', name: 'Rae Resched', by: 'resched:Brett', ts: '2026-01-02T00:00:00Z' },
      { id: 'rt1', event: 'old', email: 'rhea@example.test', name: 'Rhea Roster', by: 'roster', ts: '2026-01-02T00:00:00Z' },
    ];
    await runRoster(AT);
    const emails = world.roster.map(r => r.email).sort();
    expect(emails.join(',') === 'deb@example.test,ivan@example.test,nia@example.test,olive@example.test,wally@example.test', 'roster: ' + emails.join(','));
    const last = e => world.roster.find(r => r.email === e).last_event;
    expect(last('olive@example.test') === 'old' && last('wally@example.test') === '' && last('deb@example.test') === '' && last('nia@example.test') === '' && last('ivan@example.test') === '',
      'only a seat at a past table counts as having sat: ' + JSON.stringify(world.roster.map(r => [r.email, r.last_event])));
    const to = world.sent.map(m => m.to).sort();
    expect(to.join(',') === 'deb@example.test,ivan@example.test,olive@example.test,wally@example.test', 'Nia is on the book already; the rest hear: ' + to.join(','));
    expect(world.sent.every(m => m.subject.startsWith(NEXT)), 'an old table: the next-table note for everyone');
    expect(world.sent.find(m => m.to === 'olive@example.test').text.includes('You have sat with us before'), 'Olive sat with us');
    expect(world.sent.find(m => m.to === 'wally@example.test').text.includes('You are on the Waterville list'), 'Wally never sat');
    await runRoster(AT);
    expect(world.sent.length === 4, 'everyone hears exactly once');
  });

  await scenario('the note carries the card, shown in it and attached, with a link for a neighbor', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    world.card = CARD;
    await runRoster(AT);
    const m = world.sent[0];
    expect(m && m.attachments.length === 1 && m.attachments[0].cid === CARD.cid && m.attachments[0].filename === CARD.filename && m.attachments[0].contentType === 'image/png',
      'the card should ride along as an inline attachment: ' + JSON.stringify((m || {}).attachments));
    expect(m.attachments[0].content === CARD.png, 'the attachment should be the fetched picture');
    expect(m.html.includes('cid:' + CARD.cid) && m.html.includes('Text this picture to a neighbor'), 'the html should show the card');
    expect(m.text.includes('Text them the card attached to this note, or send them this link: https://aihomebrewclub.com/rsvp.html?event=n&ref=friend'), 'the text twin should say the card is attached: ' + m.text);
    const note = world.notes.find(n => n.subject.startsWith('The roster heard:'));
    expect(note.text.includes('with a seat link and the card') && note.text.includes('The card: ' + CARD.url), 'the admin note should say which card went: ' + note.text);
  });

  await scenario('no card reachable: the note still goes, with the link for a neighbor', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    world.card = null;
    await runRoster(AT);
    const m = world.sent[0];
    expect(m && m.attachments.length === 0 && !m.html.includes('cid:'), 'no attachment, no broken picture');
    expect(m.text.includes('Send them this link: https://aihomebrewclub.com/rsvp.html?event=n&ref=friend'), 'the neighbor link should still be there: ' + m.text);
    expect(world.notes.find(n => n.subject.startsWith('The roster heard:')).text.includes('No card could be fetched'), 'the admin note should say the card was missing');
  });

  await scenario('someone added by hand hears about the next table without being told they sat with us', async () => {
    world.events = [eventAt('n', 72)];
    world.roster = [onRoster('waterville', 'Hal Handadded', 'hand@example.test', 'in')];
    await runRoster(AT);
    expect(world.sent.length === 1 && world.sent[0].to === 'hand@example.test', 'Hal should get the next-table note, got ' + world.sent.map(m => m.to));
    expect(world.sent[0].text.includes('You are on the Waterville list') && !world.sent[0].text.includes('sat with us'), 'wrong opener: ' + world.sent[0].text.slice(0, 160));
  });

  await scenario('one week out, the whole town hears, each in their own words, once, with the card', async () => {
    const ev = eventAt('w', 156);   /* six and a half days out: inside the [7d, 6d] window */
    world.events = [ev];
    world.rsvps = [
      seat('w', 'Ada Alpha', 'ada@example.test', { ref: 'thanks' }),
      seat('w', 'Ben Bravo', 'ben@example.test', { guest_name: 'Cy Guest' }),
      seat('w', 'Wally Waits', 'wally@example.test', { status: 'waitlist' }),
      seat('w', 'Deb Declined', 'deb@example.test', { status: 'cancelled' }),
    ];
    world.roster = [onRoster('waterville', 'Olive Older', 'olive@example.test', 'in', 'old'), onRoster('waterville', 'Deb Declined', 'deb@example.test', 'in', 'old'), onRoster('waterville', 'Otto Out', 'otto@example.test', 'out', 'old')];
    world.agenda = [{ event: 'w', t: '10:00 am', title: 'Find your seat', detail: '' }];
    world.card = Object.assign({}, CARD, { cid: 'card-w@aihomebrewclub.com' });
    await runRoster(AT);
    const upNotes = world.sent.filter(m => m.subject.startsWith(NEXT));
    expect(upNotes.length === 1 && upNotes[0].to === 'olive@example.test', 'the next-table note should reach Olive alone (Deb gave her chair up, Otto opted out), got ' + upNotes.map(m => m.to));
    const week = world.sent.filter(m => m.subject.startsWith('One week out:'));
    const to = who => week.find(m => m.to === who);
    expect(week.length === 4, 'expected 4 week-before notes (Ada, Ben, Wally, Olive), got ' + week.map(m => m.to).join(','));
    expect(to('ada@example.test') && to('ada@example.test').subject.includes('your chair is saved'), 'Ada: seated wording');
    expect(to('ben@example.test') && to('ben@example.test').subject.includes('your chairs are saved') && to('ben@example.test').text.includes('Saved for Ben Bravo and Cy Guest'), 'Ben: the pair');
    expect(to('ben@example.test').text.includes('Text them the card attached to this note, or send them your link:'), 'Ben: the card, with his own share link');
    expect(to('wally@example.test') && to('wally@example.test').subject.includes('you are on the waitlist'), 'Wally: waitlist wording');
    expect(to('olive@example.test') && to('olive@example.test').subject.includes('5 chairs open') && to('olive@example.test').text.includes('ref=week'), 'Olive: open chairs, with the seat link');
    expect(to('olive@example.test').text.includes('rsvp.html?event=w&ref=friend'), 'Olive: the neighbor link');
    expect(!to('deb@example.test') && !to('otto@example.test'), 'Deb gave her chair up and Otto opted out: neither should hear');
    expect(week.every(m => m.cc) && week.every(m => m.text.includes('Find your seat')), 'every note cc to the host and carrying the run sheet');
    expect(week.every(m => m.attachments.length === 1 && m.html.includes('cid:card-w@aihomebrewclub.com')), 'every week-before note carries the card');
    expect(world.notes.some(n => n.subject.startsWith('One week out:') && n.text.includes('went to 4 people') && n.text.includes('with the card')), 'admin note for the week-before missing');
    await runRoster(AT);
    expect(world.sent.filter(m => m.subject.startsWith('One week out:')).length === 4, 'the week-before note must go once');
  });

  await scenario('one week out but after eight: it waits for the morning', async () => {
    world.events = [eventAt('w', 156)];
    world.rsvps = [seat('w', 'Ada Alpha', 'ada@example.test')];
    await runRoster(LATE);
    expect(world.sent.length === 0 && !world.markers.has('w|7d'), 'nothing should go out at night');
    await runRoster(AT);
    expect(world.sent.length === 1 && world.sent[0].subject.startsWith('One week out:'), 'the morning tick should send it');
  });

  await scenario('a table that starts within a day is too close to invite anyone to', async () => {
    world.events = [pastTable('l', TODAY), eventAt('soon', 6)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    await runRoster(AT);
    expect(world.sent.length === 0 && world.markers.size === 0, 'expected silence, got ' + world.sent.length + ' mails and ' + world.markers.size + ' markers');
  });

  await scenario('the book closed and nothing follows: one nudge to schedule, then quiet', async () => {
    world.events = [pastTable('l', TODAY)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test'), seat('l', 'Ben Bravo', 'ben@example.test', { guest_name: 'Cy Guest' })];
    await runRoster(AT);
    await runRoster(AT);
    expect(world.sent.length === 0, 'no attendee mail without a next table');
    expect(world.notes.length === 1 && world.notes[0].subject.startsWith('The book closed:') && world.notes[0].text.includes('3 chairs were taken') && world.notes[0].text.includes('Nobody is seated by the club'),
      'one nudge expected, got ' + JSON.stringify(world.notes.map(n => n.subject)));
  });

  await scenario('towns keep to themselves: a Portland table never pulls the Waterville roster', async () => {
    world.events = [
      pastTable('wl', '2026-02-10'),
      pastTable('pl', TODAY, { city: 'portland', location: 'the conference room at Maine & Co., 280 Fore St, Suite 402, Portland', minutes: 120 }),
      eventAt('pn', 72, { city: 'portland', location: 'the conference room at Maine & Co., 280 Fore St, Suite 402, Portland', minutes: 120, capacity: 12 }),
    ];
    world.rsvps = [seat('wl', 'Wally Waterville', 'wally@example.test'), seat('pl', 'Pat Portland', 'pat@example.test')];
    await runRoster(AT);
    expect(world.sent.length === 1 && world.sent[0].to === 'pat@example.test', 'only Pat should hear, got ' + world.sent.map(m => m.to));
    expect(world.sent[0].subject.startsWith('Thanks for coming. The next Portland table is'), 'Pat sat at the last Portland table: the thank-you, got ' + world.sent[0].subject);
    expect(world.sent[0].html.includes('Portland, Maine') && !world.sent[0].html.includes('Waterville'), 'the note should be Portland through and through');
    expect(world.sent[0].text.includes(Email.fmtRange(world.events[2].start_time, 120)) && world.sent[0].text.includes('12 of 12 open'), 'two-hour range and the twelve chairs missing');
    expect(world.rsvps.filter(r => r.event === 'pn').length === 0, 'nobody seated in Portland by the loop');
    expect(world.notes.some(n => n.subject.startsWith('The book closed: Table wl')), 'Waterville, with nothing scheduled, should get the nudge');
  });

  await scenario('whoever holds the room is asked, separately, to confirm it, once per table', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    world.rooms = [
      { city: 'waterville', email: 'sam@example.test', name: 'Sam Secretary', token: 'a'.repeat(48), ts: '2026-02-01T00:00:00Z' },
      { city: 'waterville', email: 'host@example.test', name: 'Hal Host', token: 'b'.repeat(48), ts: '2026-02-01T00:00:01Z' },
    ];
    await runRoster(AT);
    const room = world.sent.filter(m => m.subject.startsWith('Please confirm the room: Table n, Table day n'));
    expect(room.length === 2 && room.map(m => m.to).sort().join(',') === 'host@example.test,sam@example.test', 'both holders should be asked, got ' + room.map(m => m.to));
    expect(room.every(m => m.cc), 'the host rides along on each room check');
    const sam = room.find(m => m.to === 'sam@example.test');
    expect(sam.text.includes('Yes, the room is booked: https://api.example.test/room/confirm?t=' + 'a'.repeat(48) + '&e=n'), 'the confirm link should be signed by her token and name the table: ' + sam.text);
    expect(sam.text.includes('Something is off: https://api.example.test/room/problem?t=' + 'a'.repeat(48) + '&e=n'), 'the problem link is missing');
    expect(sam.text.includes('Hey Sam,') && sam.text.includes('up to 8 people') && sam.html.includes('Is the room booked?'), 'wrong copy: ' + sam.text.slice(0, 300));
    expect(!sam.text.includes('Save your seat'), 'the room check is not an invite');
    expect(world.sent.some(m => m.to === 'ada@example.test' && m.subject.startsWith(THANKS)), 'Ada still gets her thank-you');
    expect(world.notes.some(n => n.subject.startsWith('Room check sent: Table n') && n.text.includes('Sam Secretary <sam@example.test>')), 'the admin note for the room check is missing');
    await runRoster(AT);
    expect(world.sent.filter(m => m.subject.startsWith('Please confirm the room:')).length === 2, 'the room check goes once');
  });

  await scenario('nobody holds the room yet: nothing is asked, and the marker waits for someone to', async () => {
    world.events = [eventAt('n', 72)];
    world.roster = [onRoster('waterville', 'Hal Handadded', 'hand@example.test', 'in')];
    await runRoster(AT);
    expect(!world.sent.some(m => m.subject.startsWith('Please confirm the room')), 'no room check without holders');
    expect(!world.markers.has('n|room'), 'the room marker must not be spent while nobody holds the room');
    world.rooms = [{ city: 'waterville', email: 'sam@example.test', name: 'Sam Secretary', token: 'a'.repeat(48), ts: '2026-02-01T00:00:00Z' }];
    await runRoster(AT);
    expect(world.sent.filter(m => m.subject.startsWith('Please confirm the room')).length === 1, 'adding a holder later still gets the table checked');
  });

  await scenario('one week out, only holders who have not answered are asked again, and the note shows the room status', async () => {
    world.events = [eventAt('w', 156)];
    world.rsvps = [seat('w', 'Ada Alpha', 'ada@example.test')];
    world.rooms = [
      { city: 'waterville', email: 'sam@example.test', name: 'Sam Secretary', token: 'a'.repeat(48), ts: '2026-02-01T00:00:00Z' },
      { city: 'waterville', email: 'host@example.test', name: 'Hal Host', token: 'b'.repeat(48), ts: '2026-02-01T00:00:01Z' },
    ];
    world.checks = [{ event: 'w', email: 'sam@example.test', name: 'Sam Secretary', status: 'confirmed', ts: '2026-02-12T10:00:00Z' }];
    world.markers.add('w|room');
    await runRoster(AT);
    const again = world.sent.filter(m => m.subject.startsWith('One week out: please confirm the room for Table w'));
    expect(again.length === 1 && again[0].to === 'host@example.test', 'only Hal should be asked again, got ' + again.map(m => m.to));
    expect(again[0].text.includes('We have not heard that the room is confirmed'), 'wrong copy: ' + again[0].text.slice(0, 300));
    const week = world.notes.find(n => n.subject.startsWith('One week out: Table w'));
    expect(week && week.text.includes('Room: Sam Secretary confirmed 2026-02-12; Hal Host not confirmed yet.'), 'the week-before admin note should carry the room status: ' + (week || {}).text);
    expect(world.notes.some(n => n.subject.startsWith('Room check, one week out: Table w') && n.text.includes('Already confirmed (1)')), 'the room nag note is missing');
    await runRoster(AT);
    expect(world.sent.filter(m => m.subject.startsWith('One week out: please confirm the room')).length === 1, 'the nag goes once');
  });

  await scenario('the series check: one note per holder covering the next tables, skipping ones they confirmed, one tap for all', async () => {
    world.events = [eventAt('n1', 72), eventAt('n2', 30 * 24), eventAt('n3', 60 * 24), eventAt('n4', 90 * 24)];
    world.rooms = [
      { city: 'waterville', email: 'sam@example.test', name: 'Sam Secretary', token: 'a'.repeat(48), ts: '2026-02-01T00:00:00Z' },
      { city: 'waterville', email: 'host@example.test', name: 'Hal Host', token: 'b'.repeat(48), ts: '2026-02-01T00:00:01Z' },
    ];
    world.checks = [{ event: 'n1', email: 'sam@example.test', name: 'Sam Secretary', status: 'confirmed', ts: '2026-02-12T10:00:00Z' }];
    const r = await askRoomSeries('waterville', 3);
    expect(r.tables.join(',') === 'n1,n2,n3' && r.sent.length === 2, 'three tables, two holders, got ' + JSON.stringify(r));
    const sam = world.sent.find(m => m.to === 'sam@example.test'), hal = world.sent.find(m => m.to === 'host@example.test');
    expect(sam && sam.subject === 'Please confirm the room for the next 2 Waterville tables: Table day n2 to Table day n3', 'Sam already confirmed n1, so her note covers n2 and n3: ' + (sam || {}).subject);
    expect(sam.text.includes('Yes, all 2 are booked: https://api.example.test/room/confirm?t=' + 'a'.repeat(48) + '&e=n2%2Cn3'), 'the one-tap link should name both tables: ' + sam.text);
    expect(sam.text.includes('Yes, this one is booked: https://api.example.test/room/confirm?t=' + 'a'.repeat(48) + '&e=n2'), 'the per-table link is missing');
    expect(sam.html.includes('Are these rooms booked?') && sam.html.includes('Yes, this one is booked') && sam.cc, 'wrong html or no cc');
    expect(hal && hal.subject.includes('next 3 Waterville tables') && hal.text.includes('&e=n1%2Cn2%2Cn3'), 'Hal has confirmed nothing: all three');
    expect(world.markers.has('n1|room') && world.markers.has('n2|room') && world.markers.has('n3|room') && !world.markers.has('n4|room'), 'the per-table markers for the covered tables should be spent');
    expect(world.notes.some(n => n.subject === 'Room check sent for the next 3 Waterville tables' && n.text.includes('Sam Secretary <sam@example.test>: Table day n2, Table day n3')), 'the admin note is missing');
    await runRoster(AT);
    expect(world.sent.length === 2, 'the loop must not ask again for a table the series note covered, got ' + world.sent.map(m => m.subject));
  });

  await scenario("the host's own address never joins a roster, however it got on a book", async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Brett Host', 'club@example.test'), seat('l', 'Ada Alpha', 'ada@example.test')];
    world.invites = [{ id: 'iv9', event: 'l', email: 'Club@example.test', name: 'Brett', by: 'The club', ts: '2026-01-02T00:00:00Z' }];
    await runRoster(AT);
    expect(world.roster.map(r => r.email).join(',') === 'ada@example.test', 'only Ada belongs on the roster, got ' + world.roster.map(r => r.email));
    expect(world.sent.length === 1 && world.sent[0].to === 'ada@example.test', 'only Ada should hear, got ' + world.sent.map(m => m.to));
  });

  console.log('\n' + label + ': ' + (failures ? failures + ' scenario(s) FAILED' : 'all scenarios passed'));
  process.exit(failures ? 1 : 0);
})();
