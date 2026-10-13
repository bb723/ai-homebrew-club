/* Runs the REAL runRoster() lifted out of server.js against an in-memory club: a fake Postgres
   pool, a capturing mailer, the real email templates and the real calendar helpers. No network,
   no database, nothing sent.
   The roster is four promises: the book closes by itself, whoever sat at the last table has a
   chair at the next one, everyone who ever sat in a town hears when its next table is up, and
   the whole town hears again one week out. Mail only goes out 9 am to 8 pm Maine time.
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
  lift('async function runRoster(', '}'),
].join('\n\n');

const Email = require(path.resolve(emailPath));
let world;
function reset() { world = { events: [], rsvps: [], roster: [], markers: new Set(), posts: [], invites: [], agenda: [], sent: [], notes: [] }; }
reset();

const byDate = (a, b) => a.sort_date.localeCompare(b.sort_date);
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
    if (sql.includes('q:sat-here')) {
      const rows = [];
      for (const e of world.events.filter(e => e.city === params[0] && e.status === 'past').sort(byDate)) {
        for (const r of world.rsvps.filter(r => r.event === e.id && r.status === 'seat' && r.email)) {
          rows.push({ name: r.name, email: r.email, phone: r.phone || '', biz: r.biz || '', event: e.id });
        }
      }
      return { rows };
    }
    if (sql.includes('q:roster-upsert')) {
      const [city, email, name, phone, biz, token, last_event, ts] = params;
      const k = world.roster.find(r => r.city === city && r.email === email);
      if (k) { k.name = name; if (phone) k.phone = phone; if (biz) k.biz = biz; k.last_event = last_event; }
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
    if (sql.includes('q:opted-out')) return { rows: world.roster.filter(r => r.status === 'out').map(r => ({ email: r.email })) };
    if (sql.includes('q:last-seats')) return { rows: world.rsvps.filter(r => r.event === params[0] && r.status === 'seat') };
    if (sql.includes('q:last-agenda')) return { rows: world.agenda.filter(a => a.event === params[0]).map(a => ({ title: a.title })) };
    if (sql.includes('q:agenda')) return { rows: world.agenda.filter(a => a.event === params[0]) };
    if (sql.includes('q:token')) return { rows: world.roster.filter(r => r.city === params[0] && r.email === params[1]).map(r => ({ token: r.token })) };
    if (sql.includes('q:roster-in')) return { rows: world.roster.filter(r => r.city === params[0] && r.status === 'in') };
    if (sql.includes('q:on-book')) {
      return { rows: world.rsvps.filter(r => r.event === params[0] && (r.status === 'seat' || r.status === 'waitlist') && r.email).map(r => ({ e: r.email.toLowerCase() })) };
    }
    if (sql.includes('q:asked')) return { rows: world.invites.filter(i => i.event === params[0] && !i.by.startsWith('note:')).map(i => ({ e: i.email.toLowerCase() })) };
    if (sql.includes('q:week-events')) return { rows: world.events.filter(e => e.status === 'upcoming' && e.start_time) };
    if (sql.includes('q:book')) return { rows: world.rsvps.filter(r => r.event === params[0] && (r.status === 'seat' || r.status === 'waitlist')) };
    if (sql.includes('q:declined')) {
      return { rows: world.rsvps.filter(r => r.event === params[0] && (r.status === 'cancelled' || r.status === 'rescheduled') && r.email).map(r => ({ e: r.email.toLowerCase() })) };
    }
    if (sql.includes("status IN ('seat', 'waitlist')") && sql.includes('lower(email) = $2')) {
      const [event, em, tail] = params;
      const norm = p => String(p || '').replace(/[ ()\-.+]/g, '').slice(-10);
      const rows = world.rsvps.filter(r => r.event === event && (r.status === 'seat' || r.status === 'waitlist') &&
        ((em && String(r.email).toLowerCase() === em) || (tail && norm(r.phone) === tail)));
      return { rows: rows.slice(0, 1) };
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
const mailTo = (to, subject, text, attachments, html, opts) => { world.sent.push({ to, subject, text, html, cc: !!(opts && opts.cc) }); };
const notify = (subject, text) => { world.notes.push({ subject, text }); };
const newToken = () => crypto.randomBytes(24).toString('hex');

const make = new Function('pool', 'Email', 'mailTo', 'notify', 'mailer', 'newToken', 'API_BASE', 'fmtTime',
  code + '\nreturn { runRoster, eventStartUtc };');
const { runRoster, eventStartUtc } = make(pool, Email, mailTo, notify, {}, newToken, 'https://api.example.test', Email.fmtTime);

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

  await scenario('whoever sat at the last table has a chair at the next one, with a note', async () => {
    const next = eventAt('n', 72);
    world.events = [pastTable('l', '2026-02-10'), next];
    world.rsvps = [
      seat('l', 'Ada Alpha', 'ada@example.test', { phone: '207-555-0101', biz: 'Alpha Plumbing' }),
      seat('l', 'Ben Bravo', 'ben@example.test', { guest_name: 'Cy Guest' }),
      seat('l', 'Dee NoEmail', ''),
    ];
    world.agenda = [{ event: 'n', t: '10:00 am', title: 'Find your seat', detail: '' }];
    await runRoster(AT);
    const standing = world.rsvps.filter(r => r.event === 'n');
    expect(standing.length === 2, 'expected 2 standing seats, got ' + standing.length);
    expect(standing.every(r => r.status === 'seat' && r.ref === 'standing'), 'standing seats should be seats tagged standing');
    expect(standing[1].guest_name === 'Cy Guest' && standing[0].biz === 'Alpha Plumbing', 'guest and business should carry over');
    expect(world.sent.length === 2 && world.sent.every(m => m.cc), 'expected 2 hold notes, each cc to the host; got ' + world.sent.length);
    expect(world.sent[0].subject.startsWith('Your chair is held:'), 'a table weeks ago reads as a held chair, got: ' + world.sent[0].subject);
    expect(world.sent[0].text.includes('Table day l') && world.sent[0].text.includes('Find your seat'), 'the note should name the last table and carry the run sheet');
    expect(world.sent[0].html.includes('/roster/optout?t=') && world.sent[0].html.includes('give up my chair') && world.sent[0].text.includes('&cancel='), 'opt-out and cancel links missing');
    expect(world.sent[1].text.includes('Held for Ben Bravo and Cy Guest'), 'the pair should be held together');
    expect(world.posts.length === 1 && world.posts[0].body.includes('Ada Alpha, Ben Bravo +1 (Cy Guest)'), 'one feed post naming the carried chairs');
    const carry = world.notes.find(n => n.subject.startsWith('Chairs held over:'));
    expect(carry && carry.text.includes('Dee NoEmail: no email on file') && carry.text.includes('Held (2)'), 'admin note should list held and skipped');
    expect(world.roster.length === 2, 'the roster should hold the two with emails, got ' + world.roster.length);
  });

  await scenario('right after a table, the held chair is the thank-you note, with what was on the sheet', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    world.agenda = [
      { event: 'l', t: '10:00 am', title: 'Find your seat', detail: '' },
      { event: 'l', t: '10:10 am', title: 'Receipts into a table', detail: '' },
    ];
    await runRoster(AT);
    expect(world.sent.length === 1, 'expected 1 note, got ' + world.sent.length);
    expect(world.sent[0].subject.startsWith('Thanks for coming. Your chair is held for'), 'wrong subject: ' + world.sent[0].subject);
    expect(world.sent[0].text.includes('On the sheet: Find your seat; Receipts into a table.'), 'the recap line is missing: ' + world.sent[0].text.slice(0, 300));
    expect(world.sent[0].html.includes('Thanks for coming'), 'the html should carry the thank-you stamp');
  });

  await scenario('an evening close waits for the morning: no notes after eight', async () => {
    world.events = [pastTable('l', TODAY), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test'), seat('old', 'Olive Older', 'olive@example.test')];
    world.events.push(pastTable('old', '2026-01-13'));
    await runRoster(LATE);
    expect(world.sent.length === 0 && world.markers.size === 0, 'expected silence after eight, got ' + world.sent.length + ' mails and ' + world.markers.size + ' markers');
    expect(world.roster.length === 2, 'the roster still fills in the evening, got ' + world.roster.length);
    await runRoster(AT);
    expect(world.sent.length === 2, 'the morning tick should send the held chair and the next-table note, got ' + world.sent.length);
  });

  await scenario('the next tick holds nothing twice, even after a chair is given back', async () => {
    world.events = [pastTable('l', '2026-02-10'), eventAt('n', 72)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    await runRoster(AT);
    world.rsvps.find(r => r.event === 'n').status = 'cancelled';
    await runRoster(AT);
    await runRoster(AT);
    expect(world.rsvps.filter(r => r.event === 'n').length === 1, 'the cancelled standing seat must not come back');
    expect(world.sent.length === 1, 'expected exactly 1 hold note across three ticks, got ' + world.sent.length);
  });

  await scenario('when the host marked attendance, only those marked attended carry', async () => {
    world.events = [pastTable('l', '2026-02-10'), eventAt('n', 72)];
    world.rsvps = [
      seat('l', 'Ada Alpha', 'ada@example.test', { attended: true }),
      seat('l', 'Ben Bravo', 'ben@example.test', { attended: false }),
    ];
    await runRoster(AT);
    const standing = world.rsvps.filter(r => r.event === 'n');
    expect(standing.length === 1 && standing[0].name === 'Ada Alpha', 'only Ada should carry, got ' + standing.map(r => r.name));
    const carry = world.notes.find(n => n.subject.startsWith('Chairs held over:'));
    expect(carry.text.includes('Ben Bravo: not marked attended'), 'the note should say why Ben stayed off');
    expect(!carry.text.includes('Nobody was marked attended'), 'the attendance nudge should not appear when attendance was taken');
  });

  await scenario('a full table puts the carried neighbor first in line instead', async () => {
    world.events = [pastTable('l', '2026-02-10'), eventAt('n', 72, { capacity: 2 })];
    world.rsvps = [
      seat('n', 'Early Bird', 'early@example.test'),
      seat('n', 'Second Bird', 'second@example.test'),
      seat('l', 'Ada Alpha', 'ada@example.test'),
    ];
    await runRoster(AT);
    const ada = world.rsvps.find(r => r.event === 'n' && r.name === 'Ada Alpha');
    expect(ada && ada.status === 'waitlist', 'Ada should be waitlisted');
    expect(world.sent.length === 1 && world.sent[0].subject.startsWith('First in line:'), 'wrong subject: ' + (world.sent[0] || {}).subject);
    expect(world.posts.length === 0, 'no feed post when nobody was seated');
  });

  await scenario('already on the book, or opted out: left alone', async () => {
    world.events = [pastTable('l', '2026-02-10'), eventAt('n', 72)];
    world.rsvps = [
      seat('l', 'Ada Alpha', 'ada@example.test'),
      seat('l', 'Ben Bravo', 'ben@example.test'),
      seat('n', 'Ada Alpha', 'ADA@example.test', { ref: 'town' }),
    ];
    world.roster = [{ city: 'waterville', email: 'ben@example.test', name: 'Ben Bravo', phone: '', biz: '', token: 'tok-ben', status: 'out', last_event: 'l', ts: '2026-02-11T00:00:00Z' }];
    await runRoster(AT);
    expect(world.rsvps.filter(r => r.event === 'n').length === 1, 'nothing should be added for Ada or Ben');
    expect(world.sent.length === 0, 'expected no mail, got ' + world.sent.length);
    const carry = world.notes.find(n => n.subject.startsWith('Chairs held over:'));
    expect(carry.text.includes('Ada Alpha: already on the book') && carry.text.includes('Ben Bravo: asked us not to'), 'the note should explain both');
  });

  await scenario('the rest of the roster hears once that the next table is up', async () => {
    world.events = [pastTable('old', '2026-01-13'), pastTable('l', '2026-02-10'), eventAt('n', 72)];
    world.rsvps = [
      seat('old', 'Olive Older', 'olive@example.test'),
      seat('old', 'Ivan Invited', 'ivan@example.test'),
      seat('old', 'Bea OnBook', 'bea@example.test'),
      seat('l', 'Ada Alpha', 'ada@example.test'),
      seat('n', 'Bea OnBook', 'bea@example.test', { ref: 'town' }),
    ];
    world.invites = [{ id: 'iv1', event: 'n', email: 'ivan@example.test', name: 'Ivan Invited', by: 'Brett', ts: '2026-02-12T00:00:00Z' }];
    await runRoster(AT);
    const notes = world.sent.filter(m => m.subject.startsWith('The next Waterville table is on the calendar'));
    expect(notes.length === 1 && notes[0].to === 'olive@example.test' && notes[0].cc, 'only Olive should get the note (cc to host), got ' + notes.map(m => m.to));
    expect(notes[0].text.includes('rsvp.html?event=n&ref=roster&name=Olive%20Older&email=olive%40example.test'), 'the seat link should be prefilled');
    expect(notes[0].html.includes('stop these notes') && notes[0].text.includes('/roster/optout?t='), 'the opt-out line is missing');
    expect(world.invites.some(i => i.email === 'olive@example.test' && i.by === 'roster'), 'the note should be logged as an invite');
    expect(world.sent.some(m => m.to === 'ada@example.test' && m.subject.startsWith('Your chair is held:')), 'Ada should get a held chair, not the note');
    await runRoster(AT);
    expect(world.sent.filter(m => m.to === 'olive@example.test').length === 1, 'Olive must hear exactly once');
    expect(world.notes.some(n => n.subject.startsWith('The roster heard:') && n.text.includes('Olive Older')), 'admin note for the roster missing');
  });

  await scenario('one week out, the whole town hears, each in their own words, once', async () => {
    const ev = eventAt('w', 156);   /* six and a half days out: inside the [7d, 6d] window */
    world.events = [ev];
    world.rsvps = [
      seat('w', 'Ada Alpha', 'ada@example.test', { ref: 'standing' }),
      seat('w', 'Ben Bravo', 'ben@example.test', { guest_name: 'Cy Guest' }),
      seat('w', 'Wally Waits', 'wally@example.test', { status: 'waitlist' }),
      seat('w', 'Deb Declined', 'deb@example.test', { status: 'cancelled' }),
    ];
    const onRoster = (name, email, status) => ({ city: 'waterville', email, name, phone: '', biz: '', token: 'tok-' + name.split(' ')[0].toLowerCase(), status, last_event: 'old', ts: '2026-02-11T00:00:00Z' });
    world.roster = [onRoster('Olive Older', 'olive@example.test', 'in'), onRoster('Deb Declined', 'deb@example.test', 'in'), onRoster('Otto Out', 'otto@example.test', 'out')];
    world.agenda = [{ event: 'w', t: '10:00 am', title: 'Find your seat', detail: '' }];
    await runRoster(AT);
    const upNotes = world.sent.filter(m => m.subject.startsWith('The next Waterville table'));
    expect(upNotes.length === 1 && upNotes[0].to === 'olive@example.test', 'the next-table note should reach Olive alone (Deb gave her chair up, Otto opted out), got ' + upNotes.map(m => m.to));
    const week = world.sent.filter(m => m.subject.startsWith('One week out:'));
    const to = who => week.find(m => m.to === who);
    expect(week.length === 4, 'expected 4 week-before notes (Ada, Ben, Wally, Olive), got ' + week.map(m => m.to).join(','));
    expect(to('ada@example.test') && to('ada@example.test').subject.includes('your chair is saved'), 'Ada: seated wording');
    expect(to('ben@example.test') && to('ben@example.test').subject.includes('your chairs are saved') && to('ben@example.test').text.includes('Saved for Ben Bravo and Cy Guest'), 'Ben: the pair');
    expect(to('wally@example.test') && to('wally@example.test').subject.includes('you are on the waitlist'), 'Wally: waitlist wording');
    expect(to('olive@example.test') && to('olive@example.test').subject.includes('5 chairs open') && to('olive@example.test').text.includes('ref=week'), 'Olive: open chairs, with the seat link');
    expect(!to('deb@example.test') && !to('otto@example.test'), 'Deb gave her chair up and Otto opted out: neither should hear');
    expect(week.every(m => m.cc) && week.every(m => m.text.includes('Find your seat')), 'every note cc to the host and carrying the run sheet');
    expect(world.notes.some(n => n.subject.startsWith('One week out:') && n.text.includes('went to 4 people')), 'admin note for the week-before missing');
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

  await scenario('a table that starts within a day is too close to hold chairs for', async () => {
    world.events = [pastTable('l', '2026-02-10'), eventAt('soon', 6)];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test')];
    await runRoster(AT);
    expect(world.sent.length === 0 && world.markers.size === 0, 'expected silence, got ' + world.sent.length + ' mails and ' + world.markers.size + ' markers');
  });

  await scenario('the book closed and nothing follows: one nudge to schedule, then quiet', async () => {
    world.events = [pastTable('l', '2026-02-10')];
    world.rsvps = [seat('l', 'Ada Alpha', 'ada@example.test'), seat('l', 'Ben Bravo', 'ben@example.test', { guest_name: 'Cy Guest' })];
    await runRoster(AT);
    await runRoster(AT);
    expect(world.sent.length === 0, 'no attendee mail without a next table');
    expect(world.notes.length === 1 && world.notes[0].subject.startsWith('The book closed:') && world.notes[0].text.includes('3 chairs were taken'), 'one nudge expected, got ' + JSON.stringify(world.notes.map(n => n.subject)));
  });

  await scenario('towns keep to themselves: a Portland table never pulls the Waterville roster', async () => {
    world.events = [
      pastTable('wl', '2026-02-10'),
      pastTable('pl', '2026-02-12', { city: 'portland', location: 'the conference room at Maine & Co., 280 Fore St, Suite 402, Portland', minutes: 120 }),
      eventAt('pn', 72, { city: 'portland', location: 'the conference room at Maine & Co., 280 Fore St, Suite 402, Portland', minutes: 120 }),
    ];
    world.rsvps = [seat('wl', 'Wally Waterville', 'wally@example.test'), seat('pl', 'Pat Portland', 'pat@example.test')];
    await runRoster(AT);
    expect(world.sent.length === 1 && world.sent[0].to === 'pat@example.test', 'only Pat should hear, got ' + world.sent.map(m => m.to));
    expect(world.sent[0].html.includes('Portland, Maine') && !world.sent[0].html.includes('Waterville'), 'the note should be Portland through and through');
    expect(world.sent[0].text.includes(Email.fmtRange(world.events[2].start_time, 120)), 'two-hour range missing');
    expect(world.rsvps.filter(r => r.event === 'pn').length === 1, 'one standing seat in Portland');
    expect(world.notes.some(n => n.subject.startsWith('The book closed: Table wl')), 'Waterville, with nothing scheduled, should get the nudge');
  });

  console.log('\n' + label + ': ' + (failures ? failures + ' scenario(s) FAILED' : 'all scenarios passed'));
  process.exit(failures ? 1 : 0);
})();
