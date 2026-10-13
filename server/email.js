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
     buttons: [{label, href, primary}], notes: [{text, label, href}], signoff: [lines], place } */
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

/* the standing seat: whoever sat at the last table has a chair at the next one.
   { ev, rsvp: {id, name, guest_name, status: 'seat'|'waitlist'}, last: {title, when},
     taken, agenda, links: {calendar, cancel, share, optout} } */
function holdEmail({ ev, rsvp, last, taken, agenda, links }) {
  const place = ev.place || 'Maine';
  const town = townOf(place);
  const w = whenLine(ev);
  const name = String(rsvp.name || 'neighbor').trim();
  const first = name.split(/\s+/)[0];
  const pair = !!rsvp.guest_name;
  const seated = rsvp.status !== 'waitlist';
  const cap = +ev.capacity || 0;
  const tableLine = cap && taken != null ? ' ' + Math.min(taken, cap) + ' of ' + cap + ' chairs spoken for.' : '';
  const seatLine = seated
    ? (pair ? 'Held for ' + name + ' and ' + rsvp.guest_name + '.' : 'Held for ' + name + '.') + tableLine
    : 'Waitlist, first in line. The moment a chair opens it is yours.';
  const subject = seated
    ? 'Your chair is held: ' + ev.title + ', ' + ev.when
    : 'First in line: ' + ev.title + ', ' + ev.when;
  const headline = seated ? 'Your chair is held.' : 'First in line.';
  const lede = seated
    ? 'You sat with us on ' + last.when + ', so we held ' + (pair ? 'two chairs, yours and ' + rsvp.guest_name + '\'s,' : 'your chair') +
      ' for the next ' + town + ' table. No need to RSVP. It is yours unless you tell us otherwise.'
    : 'You sat with us on ' + last.when + ', and the next ' + town + ' table filled before we could seat you. ' +
      'You are at the top of the waitlist; the moment a chair opens it is yours, and we will email you.';

  const where = whereRow(ev);
  const buttons = [];
  if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar, primary: true });
  buttons.push({ label: 'Directions', href: where.maps, primary: !links.calendar });
  const notes = [];
  if (links.cancel) notes.push(seated
    ? { text: 'Cannot make this one? Free your chair for a neighbor:', label: 'give up my chair', href: links.cancel }
    : { text: 'Rather not wait? Leave the line here:', label: 'leave the waitlist', href: links.cancel });
  if (links.share) notes.push({ text: 'Know a neighbor who should be at this table? Send them your link:', label: 'your invite link', href: links.share });
  if (links.optout) notes.push({ text: 'Would you rather we did not hold a chair for you each time?', label: 'stop holding my chair', href: links.optout });

  const html = renderEmail({
    title: subject, place,
    preheader: w.both + '. ' + ev.location + '.',
    stamp: seated ? 'Chair held' : 'First in line',
    dateline: ev.title + ' · ' + town,
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket: [
      { k: 'Meetup', html: '<b style="font-weight:700">' + esc(ev.title) + '</b>' },
      { k: 'When', html: esc(w.date) + '<br><b style="font-weight:700">' + esc(w.range) + '</b>' },
      where,
      { k: 'Your seat', v: seatLine },
      { k: 'Bring', v: BRING },
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
    'Your seat: ' + seatLine + '\n' +
    'Bring: ' + BRING + '\n' +
    agendaText(agenda, w.minutes) +
    (links.calendar ? '\nAdd it to your calendar: ' + links.calendar : '') +
    '\nDirections: ' + where.maps + '\n' +
    notes.map(n => '\n' + n.text + ' ' + n.href).join('') +
    signoffText(place);

  return { subject, text, html };
}

/* the roster hears that the next table is on the calendar.
   { ev, person: {name, email}, taken, agenda, links: {rsvp, calendar, optout} } */
function nextTableEmail({ ev, person, taken, agenda, links }) {
  const place = ev.place || 'Maine';
  const town = townOf(place);
  const w = whenLine(ev);
  const time = fmtTime(ev.start_time);
  const name = String(person.name || 'neighbor').trim();
  const first = name.split(/\s+/)[0];
  const cap = +ev.capacity || 0;
  const left = cap ? Math.max(0, cap - (taken || 0)) : 0;
  const seatsLine = cap
    ? (left > 0 ? left + ' of ' + cap + ' open, first come, first served.' : 'Full. The waitlist moves, and it is worth joining.')
    : 'First come, first served.';
  const subject = 'The next ' + town + ' table is on the calendar: ' + ev.when;
  const headline = ev.when + '.';
  const lede = 'You have sat with us before, so you hear first: the next ' + town + ' meetup is on the calendar. ' +
    (left > 0 ? left + ' of ' + cap + ' chairs are open, and it takes ten seconds to take one.' : 'The table is already full, but seats open up and the waitlist moves.');

  const where = whereRow(ev);
  const buttons = [{ label: left > 0 ? 'Save my seat' : 'Join the waitlist', href: links.rsvp, primary: true }];
  if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar });
  const notes = [{ text: 'Know a neighbor who should be at this table? Forward this note; the link works for anyone.' }];
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
    buttons, notes,
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
    notes.map(n => '\n' + n.text + (n.href ? ' ' + n.href : '')).join('') +
    signoffText(place);

  return { subject, text, html };
}

module.exports = {
  esc, fmtTime, endTime, fmtRange, longDate, maineToday, dayWord, mapsUrl, townOf,
  renderEmail, reminderEmail, holdEmail, nextTableEmail,
};
