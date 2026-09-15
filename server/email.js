/* email.js: the club's branded emails, with a plain-text twin for every html message.
   Bean Supper brand: linen ground, walnut ink, terracotta for the one action, butter hem.
   Table layout and inline styles only, so Gmail, Outlook and Apple Mail all render it. */

const B = {
  paper: '#F6F0E4', card: '#FFFDF7', line: '#EFE7D6',
  ink: '#2B2419', ink2: '#5F5445', ink3: '#8C8071',
  tangerine: '#C1552F', tangerineDeep: '#96401D', tangerineWash: '#F7E4D8',
  butter: '#E7B84E', butterWash: '#F8ECCB',
};
const FONT_DISPLAY = "Besley, Clarendon, Georgia, 'Times New Roman', serif";
const FONT_BODY = "'Public Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_MONO = "'IBM Plex Mono', Menlo, Consolas, 'Courier New', monospace";
const SITE = 'https://aihomebrewclub.com';

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
/* "10:30" -> "11:30" (meetups run one hour) */
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

/* the gingham hem: two rows of butter checks, plain table cells so every client draws it */
function hem() {
  const row = offset => {
    let s = '';
    for (let i = 0; i < 24; i++) {
      s += '<td style="height:9px;line-height:9px;font-size:1px;background:' + ((i + offset) % 2 ? B.butter : B.butterWash) + '">&nbsp;</td>';
    }
    return '<tr>' + s + '</tr>';
  };
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' + row(0) + row(1) + '</table>';
}

/* one branded page. spec:
   { title, preheader, folio: [{text, strong}], headline, greeting, lede,
     ticket: [{k, v, html}], agendaLabel, agenda: [{t, title, detail}],
     buttons: [{label, href, primary}], notes: [{text, label, href}], signoff: [lines] } */
function renderEmail(spec) {
  const body = 'font-family:' + FONT_BODY + ';color:' + B.ink + ';';
  const mono = 'font-family:' + FONT_MONO + ';font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:' + B.ink3 + ';';
  const folio = (spec.folio || []).map(f => f.strong
    ? '<b style="color:' + B.tangerine + ';font-weight:600">' + esc(f.text) + '</b>'
    : esc(f.text)).join(' &middot; ');
  const ticket = (spec.ticket || []).map((r, i) => {
    const top = i ? 'border-top:1px solid ' + B.line + ';' : '';
    return '<tr>' +
      '<td style="padding:11px 12px 11px 16px;' + top + mono + 'white-space:nowrap;vertical-align:top;width:76px">' + esc(r.k) + '</td>' +
      '<td style="padding:11px 16px 11px 0;' + top + body + 'font-size:16px;line-height:1.45;vertical-align:top">' + (r.html || esc(r.v)) + '</td>' +
      '</tr>';
  }).join('');
  const agenda = (spec.agenda || []).map((a, i) =>
    '<tr>' +
    '<td style="padding:' + (i ? 9 : 0) + 'px 12px 0 0;font-family:' + FONT_MONO + ';font-size:13px;font-weight:600;color:' + B.tangerineDeep + ';white-space:nowrap;vertical-align:top;width:66px">' + esc(a.t) + '</td>' +
    '<td style="padding:' + (i ? 9 : 0) + 'px 0 0;' + body + 'font-size:15px;line-height:1.45;vertical-align:top">' +
      '<b style="font-weight:700">' + esc(a.title) + '</b>' +
      (a.detail ? '<span style="display:block;color:' + B.ink2 + ';font-size:14px;line-height:1.45">' + esc(a.detail) + '</span>' : '') +
    '</td></tr>').join('');
  const buttons = (spec.buttons || []).map(b =>
    '<a href="' + esc(b.href) + '" style="display:inline-block;margin:0 10px 10px 0;padding:13px 22px;border-radius:999px;' +
    'font-family:' + FONT_BODY + ';font-size:15px;font-weight:700;text-decoration:none;' +
    (b.primary ? 'background:' + B.tangerine + ';color:' + B.card + ';' : 'background:' + B.tangerineWash + ';color:' + B.tangerineDeep + ';') +
    '">' + esc(b.label) + '</a>').join('');
  const notes = (spec.notes || []).map(n =>
    '<p style="margin:0 0 10px;' + body + 'font-size:14px;line-height:1.5;color:' + B.ink2 + '">' + esc(n.text) +
    (n.href ? ' <a href="' + esc(n.href) + '" style="color:' + B.tangerine + ';font-weight:700">' + esc(n.label || n.href) + '</a>' : '') +
    '</p>').join('');
  const signoff = (spec.signoff || []).map((l, i) =>
    '<p style="margin:0;' + body + 'font-size:16px;line-height:1.5;' + (i ? '' : 'font-weight:700;') + '">' + esc(l) + '</p>').join('');

  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>' + esc(spec.title || 'The AI Homebrew Club') + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + B.paper + ';">' +
    (spec.preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px">' + esc(spec.preheader) + '</div>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:' + B.paper + '"><tr><td align="center" style="padding:28px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:separate;background:' + B.card + ';border:1px solid ' + B.line + ';border-radius:22px">' +
      '<tr><td style="padding:26px 30px 0">' +
        '<p style="margin:0 0 6px;' + mono + '">' + folio + '</p>' +
        '<p style="margin:0;font-family:' + FONT_DISPLAY + ';font-size:19px;font-weight:800;letter-spacing:-.01em;color:' + B.ink + '">The AI Homebrew Club</p>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 30px 0">' +
        '<h1 style="margin:0 0 14px;font-family:' + FONT_DISPLAY + ';font-size:36px;line-height:1.05;font-weight:800;letter-spacing:-.02em;color:' + B.ink + '">' + esc(spec.headline) + '</h1>' +
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="width:64px;border-top:3px dotted ' + B.tangerine + ';font-size:1px;line-height:1px">&nbsp;</td></tr></table>' +
      '</td></tr>' +
      '<tr><td style="padding:18px 30px 0">' +
        (spec.greeting ? '<p style="margin:0 0 10px;' + body + 'font-size:17px;line-height:1.5">' + esc(spec.greeting) + '</p>' : '') +
        '<p style="margin:0;' + body + 'font-size:17px;line-height:1.55">' + esc(spec.lede) + '</p>' +
      '</td></tr>' +
      (ticket ? '<tr><td style="padding:22px 30px 0">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:' + B.paper + ';border:1px solid ' + B.line + ';border-radius:16px">' + ticket + '</table>' +
      '</td></tr>' : '') +
      (agenda ? '<tr><td style="padding:24px 30px 0">' +
        '<p style="margin:0 0 12px;' + mono + '">' + esc(spec.agendaLabel || 'The hour') + '</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">' + agenda + '</table>' +
      '</td></tr>' : '') +
      (buttons ? '<tr><td style="padding:26px 30px 0">' + buttons + '</td></tr>' : '') +
      '<tr><td style="padding:18px 30px 26px">' + notes + '<div style="height:8px;line-height:8px;font-size:1px">&nbsp;</div>' + signoff + '</td></tr>' +
      '<tr><td style="padding:0">' + hem() + '</td></tr>' +
    '</table>' +
    '<p style="margin:18px 0 0;' + mono + 'line-height:1.7;text-align:center">' +
      '<a href="' + SITE + '" style="color:' + B.ink3 + ';text-decoration:none">aihomebrewclub.com</a> &middot; Waterville, Maine &middot; Free, and it always will be' +
    '</p>' +
    '</td></tr></table></body></html>';
}

/* the two automatic reminders: 12 hours out and 1 hour out.
   { kind: '12h'|'1h', ev: {id, title, when, sort_date, start_time, location, capacity},
     rsvp: {id, name, guest_name}, agenda: [{t, title, detail}], taken, links: {calendar, share, cancel}, now } */
function reminderEmail({ kind, ev, rsvp, agenda, taken, links, now }) {
  const is1h = kind === '1h';
  const time = fmtTime(ev.start_time);
  const out = fmtTime(endTime(ev.start_time));
  const range = fmtRange(ev.start_time);
  const date = longDate(ev.sort_date) || ev.when;
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
    ? 'The coffee is already brewing. Grab your laptop and your logins and come find your chair. We start at ' + time + ' on the dot.'
    : 'We saved you a chair' + (pair ? ', and one for ' + rsvp.guest_name : '') + '. Coffee is on at ' + time +
      ' sharp, and by ' + out + ' you walk out with one problem off your plate.';
  const subject = is1h
    ? 'One hour to go: ' + ev.title + ' starts at ' + time
    : day + ' at ' + time + ': your ' + (pair ? 'seats are' : 'seat is') + ' saved for ' + ev.title;

  const bring = 'A laptop or just your phone, and one real task that is eating your week.';
  const maps = mapsUrl(ev.location);
  const buttons = [];
  if (links.calendar) buttons.push({ label: 'Add to calendar', href: links.calendar, primary: true });
  buttons.push({ label: 'Directions', href: maps, primary: !links.calendar });
  const notes = [];
  if (!is1h && links.share) notes.push({ text: 'Know a neighbor who should be at this table? Send them your link:', label: 'your invite link', href: links.share });
  if (links.cancel) notes.push({ text: 'Cannot make it after all? Free your chair for a neighbor:', label: 'cancel my seat', href: links.cancel });

  const html = renderEmail({
    title: subject,
    preheader: date + ', ' + range + '. ' + ev.location + '.',
    folio: [{ text: is1h ? 'One hour to go' : day + ' at ' + time, strong: true }, { text: ev.title }, { text: 'Waterville, Maine' }],
    headline,
    greeting: 'Hey ' + first + ',',
    lede,
    ticket: [
      { k: 'When', html: esc(date) + '<br><b style="font-weight:700">' + esc(range) + '</b>' },
      { k: 'Where', html: esc(ev.location) + '<br><a href="' + esc(maps) + '" style="color:' + B.tangerine + ';font-weight:700">Directions</a>' },
      { k: 'Bring', v: bring },
      { k: 'Your seat', v: seatLine },
      { k: 'Cost', v: 'Free. Coffee on.' },
    ],
    agendaLabel: 'The hour · ' + range,
    agenda: agenda || [],
    buttons,
    notes,
    signoff: ['Coffee is on.', 'The AI Homebrew Club', 'Waterville, Maine'],
  });

  const text =
    'Hey ' + first + ',\n\n' + headline + ' ' + lede + '\n\n' +
    ev.title + '\n' +
    'When: ' + date + ', ' + range + '\n' +
    'Where: ' + ev.location + '\n' +
    'Bring: ' + bring + '\n' +
    'Your seat: ' + seatLine + '\n' +
    'Cost: free. Coffee on.\n' +
    ((agenda && agenda.length) ? '\nThe hour:\n' + agenda.map(a => '  ' + a.t + '  ' + a.title).join('\n') + '\n' : '') +
    (links.calendar ? '\nAdd it to your calendar: ' + links.calendar : '') +
    '\nDirections: ' + maps + '\n' +
    notes.map(n => '\n' + n.text + ' ' + n.href).join('') +
    '\n\nCoffee is on.\nThe AI Homebrew Club\n' + SITE + '\n';

  return { subject, text, html };
}

module.exports = { esc, fmtTime, endTime, fmtRange, longDate, dayWord, mapsUrl, renderEmail, reminderEmail };
