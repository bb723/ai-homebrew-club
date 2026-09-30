/* Runs the REAL runReminders() lifted out of a given server.js against an in-memory club:
   a fake Postgres pool and a capturing mailer, with the real email.js templates and the
   real calendar/chapter helpers. No network, no database, nothing sent.
   Written after a shadowed `now` silently killed every reminder tick for two weeks: the
   templates had been tested, the loop never had.
   usage: npm test   (or: node test/reminders.test.js [server.js] [email.js] [label]) */
const fs = require('fs');
const path = require('path');
const serverPath = process.argv[2] || path.join(__dirname, '..', 'server.js');
const emailPath = process.argv[3] || path.join(__dirname, '..', 'email.js');
const label = process.argv[4] || 'reminders (server/server.js)';
const src = fs.readFileSync(serverPath, 'utf8').split(/\r?\n/);

/* lift a top-level block: from the first line starting with `head` to the first line that is exactly `tail` */
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
  lift('async function seatsTaken(', '}'),
  lift('function shareUrl(', '}'),
  lift('async function runReminders(', '}'),
].join('\n\n');

const Email = require(path.resolve(emailPath));
let world;
function reset() { world = { events: [], rsvps: [], agenda: [], markers: new Set(), sent: [], notes: [] }; }
reset();

/* the six queries runReminders (and seatsTaken) make, answered from memory */
const pool = {
  async query(sql, params) {
    params = params || [];
    if (sql.includes('FROM aihc_events WHERE status')) {
      return { rows: world.events.filter(e => e.status === 'upcoming' && e.start_time !== '') };
    }
    if (sql.includes('INSERT INTO aihc_reminders')) {
      const k = params[0] + '|' + params[1];
      if (world.markers.has(k)) return { rows: [] };
      world.markers.add(k);
      return { rows: [{ event: params[0] }] };
    }
    if (sql.includes('COALESCE(SUM')) {
      const n = world.rsvps.filter(r => r.event === params[0] && r.status === 'seat')
        .reduce((a, r) => a + 1 + (r.guest_name ? 1 : 0), 0);
      return { rows: [{ n }] };
    }
    if (sql.includes('FROM aihc_rsvps') && sql.includes("email <> ''")) {
      return { rows: world.rsvps.filter(r => r.event === params[0] && r.status === 'seat' && r.email) };
    }
    if (sql.includes('FROM aihc_rsvps') && sql.includes("email = ''")) {
      return { rows: world.rsvps.filter(r => r.event === params[0] && r.status === 'seat' && !r.email).map(r => ({ name: r.name })) };
    }
    if (sql.includes('FROM aihc_agenda_items')) {
      return { rows: world.agenda.filter(a => a.event === params[0]) };
    }
    throw new Error('unexpected query: ' + sql);
  },
};
const mailTo = (to, subject, text, attachments, html) => { world.sent.push({ to, subject, text, html }); };
const notify = (subject, text) => { world.notes.push({ subject, text }); };

const make = new Function('pool', 'Email', 'mailTo', 'notify', 'mailer', 'ADMIN_SECRET', 'adminHash', 'fmtTime',
  code + '\nreturn { runReminders, eventStartUtc };');
const { runReminders, eventStartUtc } = make(pool, Email, mailTo, notify, {}, 'set', 'set', Email.fmtTime);

/* an event whose Maine-time start lands `hours` from now (the server stores local date + HH:MM) */
function eventAt(id, hours, extra) {
  const target = Date.now() + hours * 3600000;
  for (const off of [4, 5]) {
    const local = new Date(target - off * 3600000);
    const sort_date = local.toISOString().slice(0, 10);
    const start_time = local.toISOString().slice(11, 16);
    const st = eventStartUtc({ sort_date, start_time });
    if (st && Math.abs(st.getTime() - target) < 60000) {
      return Object.assign({
        id, city: 'portland', title: 'Harness meetup ' + id, when_text: 'Harness day', sort_date, start_time,
        minutes: 120, location: 'the conference room at Maine & Co., 280 Fore St, Suite 402, Portland',
        capacity: 8, status: 'upcoming',
      }, extra || {});
    }
  }
  throw new Error('could not place an event ' + hours + 'h out');
}
const seat = (event, name, email, more) => Object.assign(
  { id: 'r-' + name.toLowerCase().replace(/[^a-z]/g, ''), event, name, email, status: 'seat', guest_name: '', ts: '2026-09-30T00:00:00Z' }, more || {});

let failures = 0;
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function scenario(name, fn) {
  reset();
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { failures++; console.log('  FAIL  ' + name + '\n        -> ' + e.message); }
}

(async () => {
  console.log('\n=== ' + label + ' ===');

  await scenario('12 hours out: every seated RSVP with an email gets the reminder', async () => {
    const ev = eventAt('e12', 11);
    world.events = [ev];
    world.rsvps = [
      seat('e12', 'Ada Alpha', 'ada@example.test'),
      seat('e12', 'Ben Bravo', 'ben@example.test', { guest_name: 'Cy Guest' }),
      seat('e12', 'Dee NoEmail', ''),
      seat('e12', 'Eve Waitlist', 'eve@example.test', { status: 'waitlist' }),
    ];
    world.agenda = [{ event: 'e12', t: '4:00 pm', title: 'Find your seat', detail: '' }, { event: 'e12', t: '4:10 pm', title: 'Round the table', detail: '' }];
    await runReminders();
    expect(world.sent.length === 2, 'expected 2 reminder emails, got ' + world.sent.length);
    expect(world.sent.map(m => m.to).join(',') === 'ada@example.test,ben@example.test', 'wrong recipients: ' + world.sent.map(m => m.to));
    expect(world.sent[1].subject.includes('your seats are saved'), 'the pair should read "seats are": ' + world.sent[1].subject);
    const range = Email.fmtRange(ev.start_time, 120);
    expect(world.sent[0].text.includes(range), 'two-hour range "' + range + '" missing from the email');
    expect(world.sent[0].html.includes('Portland, Maine') && !world.sent[0].html.includes('Waterville'), 'place should be Portland, Maine');
    expect(world.sent[0].text.includes('Round the table'), 'run sheet missing from the email');
    expect(world.notes.length === 1 && world.notes[0].subject.startsWith('Reminders sent (12h)'), 'admin note missing');
    expect(world.notes[0].text.includes('No email on file, not sent: Dee NoEmail'), 'admin note should name the seat with no email');
    expect(world.markers.has('e12|12h'), 'dedup marker not written');
  });

  await scenario('12 hours out: the next five-minute tick sends nothing twice', async () => {
    world.events = [eventAt('e12', 11)];
    world.rsvps = [seat('e12', 'Ada Alpha', 'ada@example.test')];
    await runReminders();
    await runReminders();
    await runReminders();
    expect(world.sent.length === 1, 'expected exactly 1 email across three ticks, got ' + world.sent.length);
    expect(world.notes.length === 1, 'expected exactly 1 admin note, got ' + world.notes.length);
  });

  await scenario('1 hour out: the "One hour to go" reminder goes out', async () => {
    world.events = [eventAt('e1', 0.5)];
    world.rsvps = [seat('e1', 'Ada Alpha', 'ada@example.test')];
    await runReminders();
    expect(world.sent.length === 1, 'expected 1 email, got ' + world.sent.length);
    expect(world.sent[0].subject.startsWith('One hour to go:'), 'wrong subject: ' + world.sent[0].subject);
    expect(world.markers.has('e1|1h'), '1h marker not written');
  });

  await scenario('both reminders for one meetup: 12h, then 1h later, never crossed', async () => {
    world.rsvps = [seat('ex', 'Ada Alpha', 'ada@example.test')];
    world.events = [eventAt('ex', 11)];
    await runReminders();
    world.events = [eventAt('ex', 0.5)];
    await runReminders();
    await runReminders();
    expect(world.sent.length === 2, 'expected 2 emails (12h + 1h), got ' + world.sent.length);
    expect(!world.sent[0].subject.startsWith('One hour') && world.sent[1].subject.startsWith('One hour'), 'order or kind wrong');
  });

  await scenario('outside both windows (3 days out, 5 hours out, already started): silence', async () => {
    world.events = [eventAt('far', 72), eventAt('gap', 5), eventAt('gone', -0.25)];
    world.rsvps = [seat('far', 'Ada Alpha', 'ada@example.test'), seat('gap', 'Ben Bravo', 'ben@example.test'), seat('gone', 'Cy Charlie', 'cy@example.test')];
    await runReminders();
    expect(world.sent.length === 0 && world.notes.length === 0 && world.markers.size === 0,
      'expected nothing, got ' + world.sent.length + ' emails, ' + world.notes.length + ' notes, ' + world.markers.size + ' markers');
  });

  await scenario('a one-hour Waterville meetup still reads as one hour in Waterville', async () => {
    const ev = eventAt('wv', 11, { city: 'waterville', minutes: 60, location: 'the conference room at Bricks Coworking, 10 Water St, Waterville' });
    world.events = [ev];
    world.rsvps = [seat('wv', 'Ada Alpha', 'ada@example.test')];
    world.agenda = [{ event: 'wv', t: '10:00 am', title: 'Find your seat', detail: '' }];
    await runReminders();
    expect(world.sent.length === 1, 'expected 1 email, got ' + world.sent.length);
    expect(world.sent[0].text.includes(Email.fmtRange(ev.start_time, 60)), 'one-hour range missing');
    expect(world.sent[0].html.includes('Waterville, Maine'), 'place should be Waterville, Maine');
    expect(world.sent[0].text.includes('The hour:'), 'a one-hour meetup should still say "The hour"');
  });

  await scenario('an empty table: no emails, but the admin still hears the tick happened', async () => {
    world.events = [eventAt('empty', 11)];
    await runReminders();
    expect(world.sent.length === 0, 'expected 0 emails, got ' + world.sent.length);
    expect(world.notes.length === 1 && world.notes[0].text.includes('went to 0 seated RSVPs'), 'admin note missing or wrong');
  });

  await scenario('a meetup with no start time is skipped without error', async () => {
    world.events = [Object.assign(eventAt('nostart', 11), { start_time: '' })];
    world.rsvps = [seat('nostart', 'Ada Alpha', 'ada@example.test')];
    await runReminders();
    expect(world.sent.length === 0, 'expected 0 emails, got ' + world.sent.length);
  });

  console.log('\n' + label + ': ' + (failures ? failures + ' scenario(s) FAILED' : 'all scenarios passed'));
  process.exit(failures ? 1 : 0);
})();
