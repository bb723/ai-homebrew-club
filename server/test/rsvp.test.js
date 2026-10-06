/* Runs the REAL POST /rsvp handler lifted out of server.js against an in-memory book: a fake
   Postgres pool, a capturing mailer and feed, and the real helpers. No network, nothing sent.
   Written after one neighbor ended up holding four of eight chairs: a seat made for him by
   hand, a second one from the chapter page, and a third with "No" typed as his guest's name.
   usage: npm test   (or: node test/rsvp.test.js [server.js] [label]) */
const fs = require('fs');
const path = require('path');
const serverPath = process.argv[2] || path.join(__dirname, '..', 'server.js');
const label = process.argv[3] || 'rsvp (server/server.js)';
const src = fs.readFileSync(serverPath, 'utf8').split(/\r?\n/);

function lift(head, tail) {
  const i = src.findIndex(l => l.startsWith(head));
  if (i < 0) throw new Error('not found in ' + serverPath + ': ' + head);
  let j = i;
  while (src[j] !== tail) j++;
  return src.slice(i, j + 1).join('\n');
}
const helpers = [
  lift('const CHAPTERS = {', '};'),
  lift('function chapterOf(', '}'),
  lift('function cleanRef(', '}'),
  lift('function shareUrl(', '}'),
  lift('function cancelUrl(', '}'),
  lift('async function seatsTaken(', '}'),
  lift('async function waitlistSize(', '}'),
  lift('async function findReservation(', '}'),
].join('\n\n');
/* the route body: `app.post('/rsvp', async (req, res) => { ... });` becomes a plain function */
const route = lift("app.post('/rsvp', ", '});')
  .replace("app.post('/rsvp', ", 'return ')
  .replace(/\);\s*$/, ';');

let world;
function reset() { world = { event: null, rsvps: [], posts: [], sent: [], notes: [] }; }
reset();

const pool = {
  async query(sql, params) {
    params = params || [];
    if (sql.includes('FROM aihc_rsvps') && sql.includes("status IN ('seat', 'waitlist')") && sql.includes('lower(email)')) {
      const [event, em, tail] = params;
      const norm = p => String(p || '').replace(/[ ()\-.+]/g, '').slice(-10);
      const rows = world.rsvps.filter(r => r.event === event && (r.status === 'seat' || r.status === 'waitlist') &&
        ((em && String(r.email).toLowerCase() === em) || (tail && norm(r.phone) === tail)))
        .sort((a, b) => (a.ts < b.ts ? -1 : 1));
      return { rows: rows.slice(0, 1) };
    }
    if (sql.includes('COALESCE(SUM') && sql.includes("status = 'seat'")) {
      const n = world.rsvps.filter(r => r.event === params[0] && r.status === 'seat').reduce((a, r) => a + 1 + (r.guest_name ? 1 : 0), 0);
      return { rows: [{ n }] };
    }
    if (sql.includes('COALESCE(SUM') && sql.includes("status = 'waitlist'")) {
      const n = world.rsvps.filter(r => r.event === params[0] && r.status === 'waitlist').reduce((a, r) => a + 1 + (r.guest_name ? 1 : 0), 0);
      return { rows: [{ n }] };
    }
    if (sql.includes('INSERT INTO aihc_rsvps')) {
      const [id, event, name, contact, email, phone, biz, note, status, ts, ref, guest_name] = params;
      world.rsvps.push({ id, event, name, contact, email, phone, biz, note, status, ts, ref, guest_name });
      return { rows: [] };
    }
    throw new Error('unexpected query: ' + sql.slice(0, 80));
  },
};
const stubs = {
  pool,
  getEvent: async id => (world.event && world.event.id === id ? world.event : null),
  addFeedPost: async (id, title, body) => { world.posts.push({ id, title, body }); return { rows: [{ id }] }; },
  notify: (subject, text) => { world.notes.push({ subject, text }); },
  mailTo: (to, subject, text) => { world.sent.push({ to, subject, text }); },
  mailer: {},
  gcalUrl: () => 'https://calendar.example/x',
  icsText: () => null,
  fmtTime: t => t,
};
const names = Object.keys(stubs);
const make = new Function(...names, helpers + '\n' + route);
const handler = make(...names.map(k => stubs[k]));

async function post(body) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ body: JSON.stringify(body) }, res);
  return res;
}
const EV = { id: 'pdx', title: 'The first Portland meetup', when: 'Thursday, October 15', location: 'Maine & Co.', capacity: 8, city: 'portland', status: 'upcoming', sort_date: '2026-10-15', start_time: '16:00', minutes: 120 };

let failures = 0;
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function scenario(name, fn) {
  reset(); world.event = Object.assign({}, EV);
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { failures++; console.log('  FAIL  ' + name + '\n        -> ' + e.message); }
}

(async () => {
  console.log('\n=== ' + label + ' ===');

  await scenario('a first reservation takes a seat and mails a confirmation', async () => {
    const r = await post({ event: 'pdx', name: 'Remick French', email: 'french.remick@gmail.com', phone: '7703310333' });
    expect(r.code === 200 && r.body.ok && r.body.status === 'seat', 'expected a seat, got ' + JSON.stringify(r.body));
    expect(world.rsvps.length === 1, 'expected 1 row, got ' + world.rsvps.length);
    expect(world.sent.length === 1 && world.sent[0].to === 'french.remick@gmail.com', 'confirmation not mailed');
    expect(r.body.left === 7, 'expected 7 left, got ' + r.body.left);
  });

  await scenario('the same email again (any case, from another device) gets the first seat back', async () => {
    const a = await post({ event: 'pdx', name: 'Remick French', email: 'french.remick@gmail.com', phone: '', contact: 'french.remick@gmail.com', ref: 'host' });
    const b = await post({ event: 'pdx', name: 'Remick French', email: 'French.remick@gmail.com', phone: '7703310333', ref: 'town' });
    expect(b.code === 200 && b.body.ok && b.body.already === true, 'expected already:true, got ' + JSON.stringify(b.body));
    expect(b.body.id === a.body.id, 'should hand back the first reservation id');
    expect(world.rsvps.length === 1, 'expected 1 row, got ' + world.rsvps.length);
    expect(world.sent.length === 1, 'no second confirmation should go out, sent ' + world.sent.length);
    expect(world.notes.some(n => n.subject.startsWith('RSVP repeated')), 'the admin should hear about the repeat');
    expect(b.body.left === 7, 'seat count must not move, got left ' + b.body.left);
  });

  await scenario('a different email with the same phone is the same person', async () => {
    const a = await post({ event: 'pdx', name: 'Remick French', email: 'french.remick@gmail.com', phone: '(770) 331-0333' });
    const b = await post({ event: 'pdx', name: 'Remick french', email: 'rfrench@mainevision2040.com', phone: '7703310333' });
    expect(b.body.already === true && b.body.id === a.body.id, 'phone match should return the first reservation');
    expect(world.rsvps.length === 1, 'expected 1 row, got ' + world.rsvps.length);
  });

  await scenario('"No" in the neighbor field is nobody, not a second chair', async () => {
    const r = await post({ event: 'pdx', name: 'Pat Example', email: 'pat@example.test', phone: '2075550123', guest: 'No' });
    expect(r.body.status === 'seat' && r.body.left === 7, 'a lone seat should leave 7, got ' + r.body.left);
    expect(world.rsvps[0].guest_name === '', 'guest_name should be empty, got "' + world.rsvps[0].guest_name + '"');
    expect(!world.sent[0].text.includes('You and No'), 'the confirmation must not say "You and No"');
  });

  await scenario('a real neighbor still gets their chair', async () => {
    const r = await post({ event: 'pdx', name: 'Pat Example', email: 'pat@example.test', phone: '2075550123', guest: 'Sam Neighbor' });
    expect(r.body.status === 'seat' && r.body.left === 6, 'a pair should leave 6, got ' + r.body.left);
    expect(world.rsvps[0].guest_name === 'Sam Neighbor', 'guest should be kept');
  });

  await scenario('a cancelled reservation does not block coming back', async () => {
    await post({ event: 'pdx', name: 'Pat Example', email: 'pat@example.test', phone: '2075550123' });
    world.rsvps[0].status = 'cancelled';
    const r = await post({ event: 'pdx', name: 'Pat Example', email: 'pat@example.test', phone: '2075550123' });
    expect(r.body.ok && !r.body.already && r.body.status === 'seat', 'should take a fresh seat, got ' + JSON.stringify(r.body));
    expect(world.rsvps.length === 2, 'expected 2 rows (one cancelled, one seat), got ' + world.rsvps.length);
  });

  await scenario('a repeat from someone on the waitlist comes back as waitlist', async () => {
    world.event.capacity = 1;
    await post({ event: 'pdx', name: 'First Person', email: 'first@example.test', phone: '2075550001' });
    const w = await post({ event: 'pdx', name: 'Pat Example', email: 'pat@example.test', phone: '2075550123' });
    expect(w.body.status === 'waitlist', 'second person should be waitlisted');
    const again = await post({ event: 'pdx', name: 'Pat Example', email: 'PAT@example.test', phone: '(207) 555-0123' });
    expect(again.body.already === true && again.body.status === 'waitlist', 'repeat should return the waitlist spot');
    expect(world.rsvps.length === 2, 'expected 2 rows, got ' + world.rsvps.length);
  });

  await scenario('two different people still get two seats', async () => {
    await post({ event: 'pdx', name: 'Owen McCarthy', email: 'owen@example.test', phone: '2075550002' });
    const r = await post({ event: 'pdx', name: 'Remick French', email: 'remick@example.test', phone: '2075550003' });
    expect(!r.body.already && r.body.left === 6, 'expected a second seat and 6 left, got ' + JSON.stringify(r.body));
  });

  console.log('\n' + label + ': ' + (failures ? failures + ' scenario(s) FAILED' : 'all scenarios passed'));
  process.exit(failures ? 1 : 0);
})();
