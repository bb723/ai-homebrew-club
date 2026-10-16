/* email.js: the club's emails, each with a plain-text twin.
   The Bulletin: every message is a dated notice on paper. Ink, one blue for every action,
   mono for times and labels, ruled structure, no motifs. Table layout and inline styles
   only, so Gmail, Outlook and Apple Mail all draw the same page. */

const B = {
  paper: '#F4F0E6', line: '#D9D2C3', hair: '#E8E3D8',
  ink: '#191919', ink2: '#4B4A45', ink3: '#77746B',
  accent: '#1F4C9C', accentDeep: '#173A78', accentWash: '#E3EAF6', onAccent: '#FFFFFF',
  alert: '#B3261E',
};
const FONT_DISPLAY = "'IBM Plex Serif', Georgia, 'Times New Roman', serif";
const FONT_BODY = "'IBM Plex Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_MONO = "'IBM Plex Mono', Menlo, Consolas, 'Courier New', monospace";
const SITE = 'https://aihomebrewclub.com';
const BRING = 'A laptop or just your phone, and one real task that is eating your week.';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* "10:30" -> "10:30 am" */
function fmtTime(t) {
  if (!/^\d{1,2}:\d{2}$/.test(t || '')) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
/* "10:30" -> "11:30" (meetups run one hour unless told otherwise) */
function endTime(t, minutes) {
  if (!/^\d{1,2}:\d{2}$/.test(t || '')) return '';
  const [h, m] = t.split(':').map(Number);
  const end = (h * 60 + m + (minutes || 60)) % 1440;
  return Math.floor(end / 60) + ':' + String(end % 60).padStart(2, '0');
}
/* "10:30" -> "10:30 to 11:30 am"; "11:30" -> "11:30 am to 12:30 pm" */
function fmtRange(t, minutes) {
  const a = fmtTime(t), b = fmtTime(endTime(t, minutes));
  if (!a || !b) return a;
  return a.slice(-2) === b.slice(-2) ? a.slice(0, -3) + ' to ' + b : a + ' to ' + b;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function ymd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
/* "2026-09-15" -> "Tuesday, September 15, 2026" */
function longDate(sortDate) {
  const d = ymd(sortDate);
  return d ? DAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear() : '';
}
/* today's date on Maine's calendar, as YYYY-MM-DD */
function maineToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now || new Date());
}
/* "Today", "Tomorrow", or the weekday, relative to Maine's calendar */
function dayWord(sortDate, now) {
  const d = ymd(sortDate), t = ymd(maineToday(now));
  if (!d || !t) return '';
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return DAYS[d.getUTCDay()];
}
/* the hour on Maine's clock, 0-23 */
function maineHour(now) {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })
    .format(now || new Date()), 10);
}
/* whole days from a to b, both YYYY-MM-DD; NaN when either is not a date */
function daysBetween(a, b) {
  const da = ymd(a), db = ymd(b);
  return da && db ? Math.round((db.getTime() - da.getTime()) / 86400000) : NaN;
}
/* "2026-11-10" -> "Tuesday" */
function weekday(sortDate) {
  const d = ymd(sortDate);
  return d ? DAYS[d.getUTCDay()] : '';
}
function mapsUrl(location) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location || '');
}
/* 'Portland, Maine' -> 'Portland' */
function townOf(place) {
  return String(place || 'Maine').split(',')[0].trim() || 'Maine';
}

/* one notice. spec:
   { title, preheader, stamp, dateline, headline, greeting, lede,
     ticket: [{k, v, html}], agendaLabel, agenda: [{t, title, detail}],
     buttons: [{label, href, primary}], card: {cid, alt, label, caption} (or cards: [...]), notes: [{text, label, href}], signoff: [lines], place } */
function renderEmail(spec) {
  const body = 'font-family:' + FONT_BODY + ';color:' + B.ink + ';';
  const mono = 'font-family:' + FONT_MONO + ';font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:' + B.ink3 + ';';
  const link = 'color:' + B.accentDeep + ';font-weight:600;';
  const ticket = (spec.ticket || []).map((r, i) => {
    const top = 'border-top:1px dashed ' + B.line + ';';
    const bottom = i === spec.ticket.length - 1 ? 'border-bottom:1px dashed ' + B.line + ';' : '';
    return '<tr>' +
      '<td style="padding:11px 12px 11px 0;' + top + bottom + mono + 'white-space:nowrap;vertical-align:top;width:84px">' + esc(r.k) + '</td>' +
      '<td style="padding:11px 0;' + top + bottom + body + 'font-size:16px;line-height:1.45;vertical-align:top">' + (r.html || esc(r.v)) + '</td>' +
      '</tr>';
  }).join('');
  const agenda = (spec.agenda || []).map((a, i) =>
    '<tr>' +
    '<td style="padding:8px 12px 8px 0;' + (i ? 'border-top:1px solid ' + B.hair + ';' : '') + 'font-family:' + FONT_MONO + ';font-size:13px;font-weight:600;color:' + B.accent + ';white-space:nowrap;vertical-align:top;width:76px">' + esc(a.t) + '</td>' +
    '<td style="padding:8px 0;' + (i ? 'border-top:1px solid ' + B.hair + ';' : '') + body + 'font-size:15px;line-height:1.45;vertical-align:top">' +
      '<b style="font-weight:700">' + esc(a.title) + '</b>' +
      (a.detail ? '<span style="display:block;color:' + B.ink2 + ';font-size:14px;line-height:1.45">' + esc(a.detail) + '</span>' : '') +
    '</td></tr>').join('');
  const buttons = (spec.buttons || []).map(b =>
    '<a href="' + esc(b.href) + '" style="display:inline-block;margin:0 10px 10px 0;padding:13px 20px;border-radius:4px;' +
    'font-family:' + FONT_BODY + ';font-size:15px;font-weight:600;text-decoration:none;' +
    (b.primary ? 'background:' + B.accent + ';border:1.5px solid ' + B.accent + ';color:' + B.onAccent + ';'
               : 'background:transparent;border:1.5px solid ' + B.ink + ';color:' + B.ink + ';') +
    '">' + esc(b.label) + '</a>').join('');
  const notes = (spec.notes || []).map(n =>
    '<p style="margin:0 0 10px;' + body + 'font-size:14px;line-height:1.5;color:' + B.ink2 + '">' + esc(n.text) +
    (n.href ? ' <a href="' + esc(n.href) + '" style="' + link + '">' + esc(n.label || n.href) + '</a>' : '') +
    '</p>').join('');
  const signoff = (spec.signoff || []).map((l, i) =>
    '<p style="margin:0;' + body + 'font-size:16px;line-height:1.5;' + (i ? 'color:' + B.ink2 + ';' : 'font-weight:700;') + '">' + esc(l) + '</p>').join('');

  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>' + esc(spec.title || 'The AI Homebrew Club') + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + B.paper + ';">' +
    (spec.preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px">' + esc(spec.preheader) + '</div>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:' + B.paper + '"><tr><td align="center" style="padding:30px 20px 40px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:collapse">' +
      /* masthead: the one heavy rule */
      '<tr><td style="padding:0 0 10px;border-bottom:1.5px solid ' + B.ink + '">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
          '<td style="font-family:' + FONT_DISPLAY + ';font-size:19px;font-weight:700;letter-spacing:-.01em;color:' + B.ink + '">The AI Homebrew Club</td>' +
          '<td align="right" style="' + mono + 'white-space:nowrap">' + esc(spec.dateline || spec.place || 'Maine') + '</td>' +
        '</tr></table>' +
      '</td></tr>' +
      '<tr><td style="padding:26px 0 0">' +
        (spec.stamp ? '<span style="display:inline-block;background:' + B.accentWash + ';color:' + B.accent + ';font-family:' + FONT_MONO + ';font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;padding:5px 8px;border-radius:3px">' + esc(spec.stamp) + '</span>' : '') +
        '<h1 style="margin:' + (spec.stamp ? 14 : 0) + 'px 0 12px;font-family:' + FONT_DISPLAY + ';font-size:36px;line-height:1.05;font-weight:700;letter-spacing:-.02em;color:' + B.ink + '">' + esc(spec.headline) + '</h1>' +
        (spec.greeting ? '<p style="margin:0 0 8px;' + body + 'font-size:17px;line-height:1.5">' + esc(spec.greeting) + '</p>' : '') +
        '<p style="margin:0;' + body + 'font-size:17px;line-height:1.55">' + esc(spec.lede) + '</p>' +
      '</td></tr>' +
      (ticket ? '<tr><td style="padding:22px 0 0">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' + ticket + '</table>' +
      '</td></tr>' : '') +
      (agenda ? '<tr><td style="padding:24px 0 0">' +
        '<p style="margin:0 0 6px;' + mono + '"><b style="color:' + B.accent + ';font-weight:600">' + esc(spec.agendaLabel || 'The hour') + '</b></p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' + agenda + '</table>' +
      '</td></tr>' : '') +
      (buttons ? '<tr><td style="padding:26px 0 0">' + buttons + '</td></tr>' : '') +
      (spec.cards || (spec.card ? [spec.card] : [])).map(c => '<tr><td style="padding:26px 0 0">' +
        '<p style="margin:0 0 8px;' + mono + '"><b style="color:' + B.accent + ';font-weight:600">' + esc(c.label || 'The card') + '</b></p>' +
        '<img src="cid:' + esc(c.cid) + '" width="600" alt="' + esc(c.alt || '') + '" style="display:block;width:100%;max-width:600px;height:auto;border:1px solid ' + B.line + ';border-radius:6px">' +
        (c.caption ? '<p style="margin:8px 0 0;' + body + 'font-size:14px;line-height:1.5;color:' + B.ink2 + '">' + esc(c.caption) + '</p>' : '') +
      '</td></tr>').join('') +
      '<tr><td style="padding:16px 0 24px">' + notes + '<div style="height:8px;line-height:8px;font-size:1px">&nbsp;</div>' + signoff + '</td></tr>' +
      '<tr><td style="padding:12px 0 0;border-top:1.5px solid ' + B.ink + ';' + mono + 'line-height:1.7">' +
        '<a href="' + SITE + '" style="color:' + B.ink3 + ';text-decoration:none">aihomebrewclub.com</a> &middot; ' + esc(spec.place || 'Maine') + ' &middot; Free, and it always will be' +
      '</td></tr>' +
    '</table>' +
    '</td></tr></table></body></html>';
}

/* the facts every notice carries, html and text alike */
function whenLine(ev) {
  const minutes = parseInt(ev.minutes, 10) || 60;
  const date = longDate(ev.sort_date) || ev.when;
  const range = fmtRange(ev.start_time, minutes);
  return { date, range, both: date + (range ? ', ' + range : ''), minutes };
}
function whereRow(ev) {
  const maps = mapsUrl(ev.location);
  return { k: 'Where', html: esc(ev.location) + '<br><a href="' + esc(maps) + '" style="color:' + B.accentDeep + ';font-weight:600">Directions</a>', maps };
}
function agendaText(agenda, minutes) {
  return (agenda && agenda.length)
    ? '\n' + (minutes === 60 ? 'The hour' : 'The session') + ':\n' + agenda.map(a => '  ' + a.t + '  ' + a.title).join('\n') + '\n'
    : '';
}
function signoffText(place) {
  return '\n\nSee you at the table.\nThe AI Homebrew Club\n' + place + '\n' + SITE + '\n';
}

/* the two automatic reminders: 12 hours out and 1 hour out.
   { kind: '12h'|'1h', ev: {id, title, when, sort_date, start_time, minutes, location, capacity, place},
     rsvp: {id, name, guest_name}, agenda: [{t, title, detail}], taken, links: {calendar, share, cancel}, now } */
function reminderEmail({ kind, ev, rsvp, agenda, taken, links, now }) {
  const is1h = kind === '1h';
  const time = fmtTime(ev.start_time);
  const place = ev.place || 'Maine';
  const w = whenLine(ev);
  const out = fmtTime(endTime(ev.start_time, w.minutes));
  const day = dayWord(ev.sort_date, now) || ev.when;
  const name = String(rsvp.name || 'neighbor').trim();
  const first = name.split(/\s+/)[0];
  const pair = !!rsvp.guest_name;
  const cap = +ev.capacity || 0;
  const tableLine = cap && taken != null
    ? (taken >= cap ? 'Full house: all ' + cap + ' chairs are spoken for.' : taken + ' of ' + cap + ' chairs spoken for.')
    : '';
  const seatLine = (pair ? 'Two chairs, saved for ' + name + ' and ' + rsvp.guest_name + '.' : 'Saved for ' + name + '.') +
    (tableLine ? ' ' + tableLine : '');

  const headline = is1h ? 'One hour to go.' : day + (day === 'Today' || day === 'Tomorrow' ? "'s the day." : ' is the day.');
  const lede = is1h
    ? 'Grab your laptop and your logins and come find your chair. We start at ' + time + ' on the dot.'
    : 'We saved you a chair' + (pair ? ', and one for ' + rsvp.guest_name : '') + '. We start at ' + time +
      ' sharp, and by ' + out + ' you walk out with one problem off your plate.';
  const subject = is1h
    ? 'One hour to go: ' + ev.title + ' starts at ' + time
    : day + ' at ' + time + ': your ' + (pair ? 'seats are' : 'seat is') + ' saved for ' + ev.title;

  const where = whereRow(ev);
  const buttons = [];
  if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar, primary: true });
  buttons.push({ label: 'Directions', href: where.maps, primary: !links.calendar });
  const notes = [];
  if (!is1h && links.share) notes.push({ text: 'Know a neighbor who should be at this table? Send them your link:', label: 'your invite link', href: links.share });
  if (links.cancel) notes.push({ text: 'Cannot make it after all? Free your chair for a neighbor:', label: 'cancel my seat', href: links.cancel });

  const html = renderEmail({
    title: subject, place,
    preheader: w.both + '. ' + ev.location + '.',
    stamp: is1h ? 'One hour to go' : day + ' at ' + time,
    dateline: ev.title + ' · ' + townOf(place),
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket: [
      { k: 'When', html: esc(w.date) + '<br><b style="font-weight:700">' + esc(w.range) + '</b>' },
      where,
      { k: 'Bring', v: BRING },
      { k: 'Your seat', v: seatLine },
      { k: 'Cost', v: 'Free. No tickets, no vendors.' },
    ],
    agendaLabel: (w.minutes === 60 ? 'The hour' : 'The session') + ' · ' + w.range,
    agenda: agenda || [],
    buttons, notes,
    signoff: ['See you at the table.', 'The AI Homebrew Club', place],
  });

  const text =
    'Hey ' + first + ',\n\n' + headline + ' ' + lede + '\n\n' +
    ev.title + '\n' +
    'When: ' + w.both + '\n' +
    'Where: ' + ev.location + '\n' +
    'Bring: ' + BRING + '\n' +
    'Your seat: ' + seatLine + '\n' +
    'Cost: free. No tickets, no vendors.\n' +
    agendaText(agenda, w.minutes) +
    (links.calendar ? '\nAdd it to your calendar: ' + links.calendar : '') +
    '\nDirections: ' + where.maps + '\n' +
    notes.map(n => '\n' + n.text + ' ' + n.href).join('') +
    signoffText(place);

  return { subject, text, html };
}

/* "bring a neighbor": the card, when the note carries one, and a link that works for anyone.
   own: the link is the recipient's own share link rather than the open door */
function neighborNote(href, label, card, own) {
  if (!href) return null;
  const send = own ? 'send them your link:' : 'send them this link:';
  return card
    ? { text: 'Know a neighbor who should be at this table? Text them the card below, or ' + send,
        plain: 'Know a neighbor who should be at this table? Text them the card attached to this note, or ' + send, label, href }
    : { text: 'Know a neighbor who should be at this table? ' + send.charAt(0).toUpperCase() + send.slice(1), label, href };
}
/* the picture of the invitation, shown in the note and attached to it. card: {cid} or null */
function cardBlock(card, ev) {
  return card ? {
    cid: card.cid,
    alt: 'The card: ' + ev.title + ', ' + ev.when + '. Save a seat at aihomebrewclub.com.',
    label: 'The card',
    caption: 'Text this picture to a neighbor. The code on it saves them a seat.',
  } : null;
}
function notesText(notes) {
  return notes.map(n => '\n' + (n.plain || n.text) + (n.href ? ' ' + n.href : '')).join('');
}
function seatsOpenLine(cap, left) {
  return cap
    ? (left > 0 ? left + ' of ' + cap + ' open, first come, first served.' : 'Full. The waitlist moves, and it is worth joining.')
    : 'First come, first served.';
}

/* the thank-you, the morning after a table: good to have you, and the next one is on the
   calendar. Nothing is held; chairs are first come, first served, so the note is a seat link.
   { ev, person: {name}, last: {title, when}, taken, agenda,
     links: {rsvp, calendar, friend, optout}, card: {cid} | null } */
function thanksEmail({ ev, person, last, taken, agenda, links, card }) {
  const place = ev.place || 'Maine';
  const town = townOf(place);
  const w = whenLine(ev);
  const name = String(person.name || 'neighbor').trim();
  const first = name.split(/\s+/)[0];
  const cap = +ev.capacity || 0;
  const left = cap ? Math.max(0, cap - (taken || 0)) : 0;
  const open = !cap || left > 0;
  const seatsLine = seatsOpenLine(cap, left);
  const subject = 'Thanks for coming. The next ' + town + ' table is ' + ev.when + '.';
  const headline = 'Thanks for coming.';
  const lede = 'Good to have you at the table on ' + last.when + '. The next ' + town + ' table is ' + ev.when +
    (w.range ? ', ' + w.range : '') + '. ' +
    (open
      ? 'Chairs are first come, first served, so if you want one, save it now. It takes ten seconds.'
      : 'The table is already full, but chairs open up and the waitlist moves, so join it if you want to come.');

  const where = whereRow(ev);
  const buttons = [{ label: open ? 'Save my seat' : 'Join the waitlist', href: links.rsvp, primary: true }];
  if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar });
  const notes = [];
  const nb = neighborNote(links.friend, 'aihomebrewclub.com/rsvp', card, false);
  if (nb) notes.push(nb);
  if (links.optout) notes.push({ text: 'Would you rather not hear about meetups?', label: 'stop these notes', href: links.optout });

  const html = renderEmail({
    title: subject, place,
    preheader: w.both + '. ' + ev.location + '. ' + seatsLine,
    stamp: 'Thanks for coming',
    dateline: ev.title + ' · ' + town,
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket: [
      { k: 'Meetup', html: '<b style="font-weight:700">' + esc(ev.title) + '</b>' },
      { k: 'When', html: esc(w.date) + '<br><b style="font-weight:700">' + esc(w.range) + '</b>' },
      where,
      { k: 'Seats', v: seatsLine },
      { k: 'Bring', v: BRING },
    ],
    agendaLabel: (w.minutes === 60 ? 'The hour' : 'The session') + ' · ' + w.range,
    agenda: agenda || [],
    buttons, card: cardBlock(card, ev), notes,
    signoff: ['See you at the table.', 'The AI Homebrew Club', place],
  });

  const text =
    'Hey ' + first + ',\n\n' + headline + ' ' + lede + '\n\n' +
    ev.title + '\n' +
    'When: ' + w.both + '\n' +
    'Where: ' + ev.location + '\n' +
    'Seats: ' + seatsLine + '\n' +
    'Bring: ' + BRING + '\n' +
    agendaText(agenda, w.minutes) +
    '\n' + (open ? 'Save your seat' : 'Join the waitlist') + ' (takes ten seconds): ' + links.rsvp + '\n' +
    (links.calendar ? 'Add it to your calendar: ' + links.calendar + '\n' : '') +
    'Directions: ' + where.maps + '\n' +
    notesText(notes) +
    signoffText(place);

  return { subject, text, html };
}

/* the roster hears that the next table is on the calendar.
   { ev, person: {name, email, sat}, taken, agenda, links: {rsvp, calendar, friend, optout}, card } */
function nextTableEmail({ ev, person, taken, agenda, links, card }) {
  const place = ev.place || 'Maine';
  const town = townOf(place);
  const w = whenLine(ev);
  const time = fmtTime(ev.start_time);
  const name = String(person.name || 'neighbor').trim();
  const first = name.split(/\s+/)[0];
  const cap = +ev.capacity || 0;
  const left = cap ? Math.max(0, cap - (taken || 0)) : 0;
  const seatsLine = seatsOpenLine(cap, left);
  const subject = 'The next ' + town + ' table is on the calendar: ' + ev.when;
  const headline = ev.when + '.';
  const opener = person.sat === false
    ? 'You are on the ' + town + ' list, so you hear first: '
    : 'You have sat with us before, so you hear first: ';
  const lede = opener + 'the next ' + town + ' meetup is on the calendar. ' +
    (left > 0 ? left + ' of ' + cap + ' chairs are open, and it takes ten seconds to take one.' : 'The table is already full, but seats open up and the waitlist moves.');

  const where = whereRow(ev);
  const buttons = [{ label: left > 0 ? 'Save my seat' : 'Join the waitlist', href: links.rsvp, primary: true }];
  if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar });
  const notes = [];
  const nb = neighborNote(links.friend, 'aihomebrewclub.com/rsvp', card, false);
  notes.push(nb || { text: 'Know a neighbor who should be at this table? Forward this note; the link works for anyone.' });
  if (links.optout) notes.push({ text: 'Would you rather not hear about meetups?', label: 'stop these notes', href: links.optout });

  const html = renderEmail({
    title: subject, place,
    preheader: w.both + '. ' + ev.location + '. ' + seatsLine,
    stamp: 'Next table' + (time ? ' · ' + time : ''),
    dateline: ev.title + ' · ' + town,
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket: [
      { k: 'Meetup', html: '<b style="font-weight:700">' + esc(ev.title) + '</b>' },
      { k: 'When', html: esc(w.date) + '<br><b style="font-weight:700">' + esc(w.range) + '</b>' },
      where,
      { k: 'Seats', v: seatsLine },
      { k: 'Bring', v: BRING },
    ],
    agendaLabel: (w.minutes === 60 ? 'The hour' : 'The session') + ' · ' + w.range,
    agenda: agenda || [],
    buttons, card: cardBlock(card, ev), notes,
    signoff: ['See you at the table.', 'The AI Homebrew Club', place],
  });

  const text =
    'Hey ' + first + ',\n\n' + ev.when + (time ? ', ' + time : '') + '. ' + lede + '\n\n' +
    ev.title + '\n' +
    'When: ' + w.both + '\n' +
    'Where: ' + ev.location + '\n' +
    'Seats: ' + seatsLine + '\n' +
    'Bring: ' + BRING + '\n' +
    agendaText(agenda, w.minutes) +
    '\n' + (left > 0 ? 'Save your seat' : 'Join the waitlist') + ' (takes ten seconds): ' + links.rsvp + '\n' +
    (links.calendar ? 'Add it to your calendar: ' + links.calendar + '\n' : '') +
    'Directions: ' + where.maps + '\n' +
    notesText(notes) +
    signoffText(place);

  return { subject, text, html };
}

/* one week out, to everyone in the town: the seated hear their chair is saved, the waitlist
   that they are still in line, the rest how many chairs are open.
   { ev, person: {name, guest_name}, kind: 'seat'|'waitlist'|'open', taken, agenda,
     links: {calendar, cancel, share, rsvp, friend, optout}, card } */
function weekBeforeEmail({ ev, person, kind, taken, agenda, links, card }) {
  const place = ev.place || 'Maine';
  const w = whenLine(ev);
  const day = weekday(ev.sort_date) || ev.when;
  const name = String(person.name || 'neighbor').trim();
  const first = name.split(/\s+/)[0];
  const pair = !!person.guest_name;
  const cap = +ev.capacity || 0;
  const left = cap ? Math.max(0, cap - (taken || 0)) : 0;
  const seated = kind === 'seat', waiting = kind === 'waitlist';
  const seatLine = seated
    ? (pair ? 'Saved for ' + name + ' and ' + person.guest_name + '.' : 'Saved for ' + name + '.') + (cap ? ' ' + Math.min(taken || 0, cap) + ' of ' + cap + ' chairs spoken for.' : '')
    : waiting
      ? 'You are on the waitlist. If a chair opens it is yours, and we will email you.'
      : seatsOpenLine(cap, left);
  const subject = seated
    ? 'One week out: your ' + (pair ? 'chairs are' : 'chair is') + ' saved for ' + ev.when
    : waiting
      ? 'One week out: you are on the waitlist for ' + ev.when
      : 'One week out: ' + (left > 0 ? left + ' chair' + (left === 1 ? '' : 's') + ' open for ' : 'the table is full for ') + ev.when;
  const headline = 'Next ' + day + '.';
  const lede = seated
    ? ev.title + ' is a week out: ' + ev.when + ', ' + w.range + '. Your ' + (pair ? 'chairs are' : 'chair is') + ' saved. If plans changed, free ' +
      (pair ? 'them' : 'it') + ' now so a neighbor can have ' + (pair ? 'them' : 'it') + '.'
    : waiting
      ? ev.title + ' is a week out: ' + ev.when + ', ' + w.range + '. You are still on the waitlist, and chairs do open up in the last week.'
      : ev.title + ' is a week out: ' + ev.when + ', ' + w.range + '. ' +
        (left > 0 ? left + ' of ' + cap + ' chairs are open, and it takes ten seconds to take one.' : 'The table is full, but seats open up and the waitlist moves.');

  const where = whereRow(ev);
  const buttons = [];
  if (seated || waiting) {
    if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar, primary: true });
    buttons.push({ label: 'Directions', href: where.maps, primary: !links.calendar });
  } else {
    buttons.push({ label: left > 0 ? 'Save my seat' : 'Join the waitlist', href: links.rsvp, primary: true });
    if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar });
  }
  const notes = [];
  if (seated && links.cancel) notes.push({ text: 'Plans changed? Free your chair for a neighbor:', label: 'give up my chair', href: links.cancel });
  if (waiting && links.cancel) notes.push({ text: 'Rather not wait? Leave the line here:', label: 'leave the waitlist', href: links.cancel });
  if (seated || waiting) {
    const nb = neighborNote(links.share || links.friend, links.share ? 'your invite link' : 'aihomebrewclub.com/rsvp', card, !!links.share);
    if (nb) notes.push(nb);
  } else {
    const nb = neighborNote(links.friend, 'aihomebrewclub.com/rsvp', card, false);
    notes.push(nb || { text: 'Know a neighbor who should be at this table? Forward this note; the link works for anyone.' });
  }
  if (links.optout) notes.push({ text: 'Would you rather not hear about meetups?', label: 'stop these notes', href: links.optout });

  const html = renderEmail({
    title: subject, place,
    preheader: w.both + '. ' + ev.location + '.',
    stamp: 'One week out',
    dateline: ev.title + ' · ' + townOf(place),
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket: [
      { k: 'Meetup', html: '<b style="font-weight:700">' + esc(ev.title) + '</b>' },
      { k: 'When', html: esc(w.date) + '<br><b style="font-weight:700">' + esc(w.range) + '</b>' },
      where,
      { k: seated ? 'Your seat' : 'Seats', v: seatLine },
      { k: 'Bring', v: BRING },
    ],
    agendaLabel: (w.minutes === 60 ? 'The hour' : 'The session') + ' · ' + w.range,
    agenda: agenda || [],
    buttons, card: cardBlock(card, ev), notes,
    signoff: ['See you at the table.', 'The AI Homebrew Club', place],
  });

  const text =
    'Hey ' + first + ',\n\n' + headline + ' ' + lede + '\n\n' +
    ev.title + '\n' +
    'When: ' + w.both + '\n' +
    'Where: ' + ev.location + '\n' +
    (seated ? 'Your seat: ' : 'Seats: ') + seatLine + '\n' +
    'Bring: ' + BRING + '\n' +
    agendaText(agenda, w.minutes) +
    (kind === 'open' ? '\n' + (left > 0 ? 'Save your seat' : 'Join the waitlist') + ' (takes ten seconds): ' + links.rsvp + '\n' : '\n') +
    (links.calendar ? 'Add it to your calendar: ' + links.calendar + '\n' : '') +
    'Directions: ' + where.maps + '\n' +
    notesText(notes) +
    signoffText(place);

  return { subject, text, html };
}

/* the room check for a run of tables: are these rooms booked? One tap confirms them all, one
   line per table confirms one, another flags a problem.
   { person: {name}, place, tables: [{ev, confirm}], links: {confirmAll, problem} } */
function roomSeriesEmail({ person, place, tables, links }) {
  const town = townOf(place || 'Maine');
  const name = String(person.name || 'there').trim();
  const first = name.split(/\s+/)[0];
  const n = tables.length;
  const head = tables[0].ev, tail = tables[n - 1].ev;
  const cap = +head.capacity || 0;
  const sameRoom = tables.every(t => t.ev.location === head.location);
  const subject = 'Please confirm the room for the next ' + n + ' ' + town + ' tables: ' + head.when + ' to ' + tail.when;
  const headline = 'Are these rooms booked?';
  const lede = 'The club has the next ' + n + ' ' + town + ' tables on the calendar' +
    (sameRoom ? ', all at ' + head.location : '') + (cap ? ', for up to ' + cap + ' people' : '') + '. ' +
    'You are one of the people who holds that booking, so please confirm them: one tap covers all ' + n + ', or confirm them one at a time below, ' +
    'or tell us if anything is off. Everyone who holds the booking gets this note and confirms separately.';
  const short = ev => {
    const d = ymd(ev.sort_date);
    return d ? MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate() : ev.when;
  };
  const link = 'color:' + B.accentDeep + ';font-weight:600;';
  const ticket = tables.map(t => {
    const w = whenLine(t.ev);
    return { k: short(t.ev), html: '<b style="font-weight:700">' + esc(w.date) + '</b>' + (w.range ? ', ' + esc(w.range) : '') +
      (sameRoom ? '' : '<br>' + esc(t.ev.location)) +
      '<br><a href="' + esc(t.confirm) + '" style="' + link + '">Yes, this one is booked</a>' };
  });
  if (sameRoom) {
    const maps = mapsUrl(head.location);
    ticket.push({ k: 'Where', html: esc(head.location) + '<br><a href="' + esc(maps) + '" style="' + link + '">Directions</a>' });
  }
  const buttons = [
    { label: 'Yes, all ' + n + ' are booked', href: links.confirmAll, primary: true },
    { label: 'Something is off', href: links.problem },
  ];
  const notes = [{ text: 'Replying to this note reaches the club as well.' }];

  const html = renderEmail({
    title: subject, place,
    preheader: n + ' tables, ' + head.when + ' to ' + tail.when + '. One tap confirms them all.',
    stamp: 'Room check · ' + n + ' tables',
    dateline: 'The next ' + n + ' tables · ' + town,
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket,
    buttons, notes,
    signoff: ['Thank you.', 'The AI Homebrew Club', place],
  });

  const text =
    'Hey ' + first + ',\n\n' + headline + ' ' + lede + '\n\n' +
    tables.map(t => {
      const w = whenLine(t.ev);
      return t.ev.title + '\n  When: ' + w.both + (sameRoom ? '' : '\n  Where: ' + t.ev.location) + '\n  Yes, this one is booked: ' + t.confirm;
    }).join('\n\n') + '\n' +
    (sameRoom ? '\nWhere: ' + head.location + '\n' : '') +
    '\nYes, all ' + n + ' are booked: ' + links.confirmAll + '\n' +
    'Something is off: ' + links.problem + '\n' +
    '\nReplying to this note reaches the club as well.' +
    '\n\nThank you.\nThe AI Homebrew Club\n' + place + '\n' + SITE + '\n';

  return { subject, text, html };
}

/* the host asks for the card: one note with the picture for each table, shown and attached,
   so it can be saved and texted on. { items: [{ev, card: {cid, url}, taken}], place } */
function cardsEmail({ items, place }) {
  const n = items.length;
  const one = n === 1;
  const short = ev => {
    const d = ymd(ev.sort_date);
    return d ? MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate() : ev.when;
  };
  const seats = it => {
    const cap = +it.ev.capacity || 0;
    const left = cap ? Math.max(0, cap - (it.taken || 0)) : 0;
    return cap ? (left > 0 ? left + ' of ' + cap + ' chairs open.' : 'Full; the waitlist is open.') : 'First come, first served.';
  };
  const subject = one
    ? 'The card: ' + items[0].ev.title + ', ' + items[0].ev.when
    : 'The cards: ' + items.map(it => it.ev.when).join(' and ');
  const headline = one ? 'Your card for ' + items[0].ev.when + '.' : 'Your cards, one per table.';
  const lede = (one
    ? 'Save the picture below and text it to whoever should be at the table. '
    : 'Save each picture and text it to whoever should be at that table. ') +
    'The code on it saves them a seat, and so does the short link printed on it. ' +
    (one ? 'It is attached to this note as well.' : 'Both are attached to this note as well.');
  const ticket = items.map(it => ({
    k: short(it.ev),
    html: '<b style="font-weight:700">' + esc(it.ev.title) + '</b><br>' + esc(whenLine(it.ev).both) + '<br>' + esc(seats(it)),
  }));
  const cards = items.map(it => ({
    cid: it.card.cid,
    alt: 'The card: ' + it.ev.title + ', ' + it.ev.when,
    label: it.ev.title + ' · ' + it.ev.when,
    caption: '',
  }));
  const notes = items.map(it => ({ text: (one ? 'The picture on the web, for a link instead:' : it.ev.title + ', as a link instead:'), label: it.card.url.replace(/^https?:\/\//, ''), href: it.card.url }));
  const html = renderEmail({
    title: subject, place,
    preheader: (one ? 'The card for ' : 'The cards for ') + items.map(it => it.ev.when).join(' and ') + '. Save and text it.',
    stamp: one ? 'The card' : 'The cards',
    dateline: one ? items[0].ev.title + ' · ' + townOf(place) : n + ' tables · ' + townOf(place),
    headline,
    lede,
    ticket,
    cards, notes,
    signoff: ['The AI Homebrew Club', place],
  });
  const text =
    headline + ' ' + lede + '\n\n' +
    items.map(it => it.ev.title + '\nWhen: ' + whenLine(it.ev).both + '\nSeats: ' + seats(it) + '\nThe picture on the web: ' + it.card.url).join('\n\n') +
    '\n\nThe AI Homebrew Club\n' + place + '\n' + SITE + '\n';
  return { subject, text, html };
}

/* the room check, to whoever holds the booking: is the room set for this table? One tap
   confirms, another flags a problem. kind 'ask' goes out with the invites, 'again' a week out
   to anyone who has not answered.
   { ev, person: {name}, kind: 'ask'|'again', taken, agenda, links: {confirm, problem, calendar} } */
function roomEmail({ ev, person, kind, taken, agenda, links }) {
  const place = ev.place || 'Maine';
  const town = townOf(place);
  const w = whenLine(ev);
  const name = String(person.name || 'there').trim();
  const first = name.split(/\s+/)[0];
  const cap = +ev.capacity || 0;
  const again = kind === 'again';
  const roomLine = (cap ? 'Up to ' + cap + ' people.' : 'A small table.') +
    (cap && taken != null ? ' ' + Math.min(taken, cap) + ' of ' + cap + ' chairs spoken for so far.' : '');
  const subject = again
    ? 'One week out: please confirm the room for ' + ev.title + ', ' + ev.when
    : 'Please confirm the room: ' + ev.title + ', ' + ev.when;
  const headline = again ? 'Is the room still set?' : 'Is the room booked?';
  const lede = again
    ? ev.title + ' is a week out: ' + ev.when + (w.range ? ', ' + w.range : '') + ', at ' + ev.location + '. ' +
      'We have not heard that the room is confirmed. One tap below settles it, or tell us if anything is off.'
    : 'The club is inviting people to ' + ev.title + ' on ' + ev.when + (w.range ? ', ' + w.range : '') + ', at ' + ev.location +
      (cap ? ', for up to ' + cap + ' people' : '') + '. You are one of the people who holds that booking, so please confirm it with one tap below, ' +
      'or tell us if anything is off. Everyone who holds the booking gets this note and confirms separately.';

  const where = whereRow(ev);
  const buttons = [
    { label: 'Yes, the room is booked', href: links.confirm, primary: true },
    { label: 'Something is off', href: links.problem },
  ];
  const notes = [{ text: 'Replying to this note reaches the club as well.' }];
  if (links.calendar) notes.push({ text: 'The table on your calendar:', label: 'add it', href: links.calendar });

  const html = renderEmail({
    title: subject, place,
    preheader: w.both + '. ' + ev.location + '. ' + roomLine,
    stamp: again ? 'Room check · one week out' : 'Room check',
    dateline: ev.title + ' · ' + town,
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket: [
      { k: 'Meetup', html: '<b style="font-weight:700">' + esc(ev.title) + '</b>' },
      { k: 'When', html: esc(w.date) + '<br><b style="font-weight:700">' + esc(w.range) + '</b>' },
      where,
      { k: 'Room', v: roomLine },
    ],
    agendaLabel: (w.minutes === 60 ? 'The hour' : 'The session') + ' · ' + w.range,
    agenda: agenda || [],
    buttons, notes,
    signoff: ['Thank you.', 'The AI Homebrew Club', place],
  });

  const text =
    'Hey ' + first + ',\n\n' + headline + ' ' + lede + '\n\n' +
    ev.title + '\n' +
    'When: ' + w.both + '\n' +
    'Where: ' + ev.location + '\n' +
    'Room: ' + roomLine + '\n' +
    agendaText(agenda, w.minutes) +
    '\nYes, the room is booked: ' + links.confirm + '\n' +
    'Something is off: ' + links.problem + '\n' +
    (links.calendar ? 'The table on your calendar: ' + links.calendar + '\n' : '') +
    'Directions: ' + where.maps + '\n' +
    '\nReplying to this note reaches the club as well.' +
    '\n\nThank you.\nThe AI Homebrew Club\n' + place + '\n' + SITE + '\n';

  return { subject, text, html };
}

module.exports = {
  esc, fmtTime, endTime, fmtRange, longDate, maineToday, maineHour, daysBetween, weekday, dayWord, mapsUrl, townOf,
  renderEmail, reminderEmail, thanksEmail, nextTableEmail, weekBeforeEmail, roomEmail, roomSeriesEmail, cardsEmail,
};
