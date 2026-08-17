/* Shared site config: the one place that knows the backend, the nav, and the logo.
   Loaded by every page (public and gated) before site.js / club.js. */
window.AIHC_CONFIG = (function(){
  'use strict';

  var API_BASE = 'https://aihc-notes-690dcde965fd.herokuapp.com';

  var SITE_HOSTS = ['aihomebrewclub.com', 'www.aihomebrewclub.com', 'bb723.github.io',
                    'aibrownbag.com', 'www.aibrownbag.com', 'localhost', '127.0.0.1'];

  /* The one nav. Order is display order; group headings render on change.
     Members see only 'The club'; the other groups are admin-only. */
  var DECKS = [
    {id: 'members', title: 'The members&rsquo; room', desc: 'Your front door: chat, recipes, the next table.', group: 'The club'},
    {id: 'chat', title: 'The clubhouse', desc: 'Members&rsquo; chat and the bulletin board.', group: 'The club'},
    {id: 'recipes', title: 'The recipe box', desc: 'Public prompt library, one steal at a time.', group: 'The club'},
    {id: 'waterville', title: 'Waterville', desc: 'Public meetup page: agendas, seats, QR.', group: 'The club'},
    {id: 'events', title: 'The circuit', desc: 'Every meetup, mapped and dated.', group: 'The club'},
    {id: 'home', title: 'The invite', desc: 'The public landing page.', group: 'The club'},
    {id: 'admin', title: 'Meetup controls', desc: 'Create meetups, edit agendas, the keyring.', group: 'The back office', admin: true},
    {id: 'charter', title: 'The Charter', desc: 'The whole plan. Every pitch is cut from this.', group: 'The pitches &amp; plans', admin: true},
    {id: 'invest', title: 'Investor pitch', desc: 'The hardest room in America.', group: 'The pitches &amp; plans', admin: true},
    {id: 'join', title: 'Attendee pitch', desc: 'Come to the first AI Brown Bag.', group: 'The pitches &amp; plans', admin: true},
    {id: 'why', title: 'Why we meet', desc: 'Fear, lies, and folding chairs.', group: 'The pitches &amp; plans', admin: true},
    {id: 'kit101', title: 'The 101 kit', desc: 'Twelve live demos, step by step.', group: 'The pitches &amp; plans', admin: true},
    {id: 'funding', title: 'The funding plan', desc: 'Grants, links, deadlines, in unlock order.', group: 'The pitches &amp; plans', admin: true},
    {id: 'model', title: 'The model', desc: 'The studio P&amp;L, live.', group: 'The pitches &amp; plans', admin: true}
  ];

  /* Root-level pages; everything else lives under deck/. 'feed' stays routable for old links. */
  var ROOT_PAGES = {feed: 1, chat: 1, waterville: 1, recipes: 1, members: 1, events: 1, rsvp: 1, lend: 1};

  /* The circuit map: where each chapter sits on the hand-drawn Maine SVG
     (viewBox 0 0 400 520 in events.html). One line per town as chapters open. */
  var CITY_POINTS = {
    waterville: {x: 156, y: 334, label: 'Waterville', page: 'waterville.html'}
  };

  function deckHref(id){
    var local = location.protocol === 'file:' || SITE_HOSTS.indexOf(location.hostname) !== -1;
    var inDeck = /\/deck\//.test(location.pathname);
    var up = inDeck ? '../' : '';
    if (id === 'home') return local ? up + 'index.html' : 'https://aihomebrewclub.com/';
    if (ROOT_PAGES[id]) return local ? up + id + '.html' : 'https://aihomebrewclub.com/' + id + '.html';
    return local ? (inDeck ? '' : 'deck/') + id + '.html' : 'https://aihomebrewclub.com/deck/' + id + '.html';
  }

  /* Renders the member nav into a .deckpane element (the public-page hamburger and the decks).
     currentId gets the "here" mark. role 'admin' unlocks the back-office groups. */
  function buildDeckPane(pane, currentId, role){
    if (!pane) return;
    pane.innerHTML = '';
    var lastGroup = '';
    DECKS.forEach(function(d){
      if (d.admin && role !== 'admin') return;
      if (d.group !== lastGroup){
        var h = document.createElement('h3');
        h.innerHTML = d.group;
        pane.appendChild(h);
        lastGroup = d.group;
      }
      var a = document.createElement('a');
      a.href = deckHref(d.id);
      if (location.protocol !== 'file:' && SITE_HOSTS.indexOf(location.hostname) === -1) a.target = '_blank';
      if (d.id === currentId) a.className = 'here';
      a.innerHTML = '<span class="t">' + d.title + '</span><span class="d">' + d.desc + '</span>';
      pane.appendChild(a);
    });
    var c = document.createElement('button');
    c.className = 'close'; c.type = 'button'; c.textContent = 'Close';
    c.addEventListener('click', function(){ document.body.classList.remove('deck-open'); });
    pane.appendChild(c);
  }

  /* Renders the club shell sidebar (members.html, chat.html, deck/admin.html).
     Fills el with the brand, grouped .navi links, and an empty .me block that club.js
     paints on unlock. extra = optional {group, items:[{id, title, href, k}]} injected
     after the matching group (chat rooms, console panels). Returns el. */
  function buildSideNav(el, currentId, role, extras){
    if (!el) return el;
    el.innerHTML = '';
    var brand = document.createElement('a');
    brand.className = 'brand'; brand.href = deckHref('home');
    brand.innerHTML = '<span class="logo" data-size="26" aria-hidden="true"></span><span>The AI Homebrew Club</span>';
    el.appendChild(brand);
    var groups = {}, order = [];
    DECKS.forEach(function(d){
      if (d.admin && role !== 'admin') return;
      if (!groups[d.group]){ groups[d.group] = []; order.push(d.group); }
      groups[d.group].push(d);
    });
    order.forEach(function(g){
      var box = document.createElement('div');
      box.className = 'grp';
      var h = document.createElement('span'); h.className = 'h'; h.innerHTML = g;
      box.appendChild(h);
      groups[g].forEach(function(d){
        var a = document.createElement('a');
        a.className = 'navi' + (d.id === currentId ? ' here' : '');
        a.href = deckHref(d.id);
        a.setAttribute('data-nav', d.id);
        a.innerHTML = d.title;
        box.appendChild(a);
      });
      el.appendChild(box);
      (extras || []).forEach(function(x){
        if (x.after !== g) return;
        var xb = document.createElement('div');
        xb.className = 'grp'; xb.id = x.id || '';
        var xh = document.createElement('span'); xh.className = 'h'; xh.innerHTML = x.group;
        xb.appendChild(xh);
        (x.items || []).forEach(function(it){
          var a = document.createElement('a');
          a.className = 'navi' + (it.here ? ' here' : '');
          a.href = it.href || '#';
          if (it.id) a.setAttribute('data-nav', it.id);
          a.innerHTML = it.title + (it.k != null ? ' <span class="k">' + it.k + '</span>' : '');
          xb.appendChild(a);
        });
        el.appendChild(xb);
      });
    });
    var me = document.createElement('div');
    me.className = 'me';
    me.innerHTML = '<span class="av av-ink" id="meAv"></span><span class="who"><b id="meName"></b><span id="meRole"></span></span>';
    el.appendChild(me);
    if (typeof paintLogos === 'function') paintLogos(el);
    return el;
  }

  /* The one urn. Paints every <span class="logo" data-size="N"> under root. */
  var LOGO = '<svg viewBox="0 0 120 120" fill="none" role="img" aria-label="A church-supper coffee urn with a cup">' +
    '<rect x="34" y="30" width="48" height="56" rx="9" stroke="var(--ink)" stroke-width="5"/>' +
    '<path d="M40 30 a18 10 0 0 1 36 0" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="58" cy="14" r="4.5" fill="var(--tangerine)"/>' +
    '<circle cx="58" cy="64" r="4" fill="var(--sky)"/>' +
    '<path d="M58 68 v10" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M42 86 v9" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M74 86 v9" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M90 88 h18 v6 a7 7 0 0 1 -7 7 h-4 a7 7 0 0 1 -7 -7 Z" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M99 82 c-2 -3 2 -5 0 -9" stroke="var(--tangerine)" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M46 46 h24" stroke="var(--teal)" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M46 54 h16" stroke="var(--lemon)" stroke-width="4" stroke-linecap="round"/></svg>';

  function paintLogos(root){
    (root || document).querySelectorAll('.logo').forEach(function(el){
      var size = el.getAttribute('data-size') || '150';
      el.innerHTML = LOGO;
      var svg = el.firstChild;
      if (svg){ svg.setAttribute('width', size); svg.setAttribute('height', size); svg.style.display = 'inline-block'; }
    });
  }

  /* the potluck ladder: 101 fork, 201 casserole, 301 lunch counter */
  function lvlsvg(inner){ return '<svg viewBox="0 0 80 120" fill="none" aria-hidden="true">' + inner + '</svg>'; }
  var LEVELS = {
    1: lvlsvg(
      '<path d="M40 114 V56" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M30 22 v20 a10 10 0 0 0 20 0 V22" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M40 22 v20" stroke="var(--ink)" stroke-width="4" stroke-linecap="round"/>' +
      '<rect x="34" y="66" width="12" height="18" rx="6" fill="var(--teal)"/>'),
    2: lvlsvg(
      '<ellipse cx="40" cy="84" rx="28" ry="12" fill="var(--tangerine)" stroke="var(--ink)" stroke-width="4"/>' +
      '<path d="M14 78 a26 16 0 0 1 52 0" fill="var(--lemon)" stroke="var(--ink)" stroke-width="4"/>' +
      '<circle cx="40" cy="58" r="5" fill="var(--ink)"/>' +
      '<path d="M30 44 c-3 -5 3 -8 0 -13" stroke="var(--teal)" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M50 44 c-3 -5 3 -8 0 -13" stroke="var(--sky)" stroke-width="4" stroke-linecap="round"/>'),
    3: lvlsvg(
      '<rect x="14" y="56" width="52" height="42" rx="7" fill="var(--berry)" stroke="var(--ink)" stroke-width="4"/>' +
      '<path d="M14 66 h-7" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M66 66 h7" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M12 56 h56" stroke="var(--ink)" stroke-width="5" stroke-linecap="round"/>' +
      '<circle cx="40" cy="47" r="5" fill="var(--ink)"/>' +
      '<path d="M28 36 c-3 -5 3 -8 0 -14" stroke="var(--teal)" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M40 32 c-3 -6 3 -9 0 -16" stroke="var(--tangerine)" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M52 36 c-3 -5 3 -8 0 -14" stroke="var(--lemon)" stroke-width="4" stroke-linecap="round"/>')
  };
  function paintLevels(root, w, h){
    (root || document).querySelectorAll('.lvlicon').forEach(function(el){
      el.innerHTML = LEVELS[el.getAttribute('data-level') || '1'] || '';
      var svg = el.firstChild;
      if (svg){ svg.setAttribute('width', String(w || 64)); svg.setAttribute('height', String(h || 88)); }
    });
  }

  /* the traffic beacon: one first-party, cookieless ping per page load so the
     back office can see where people go. Sends the path, the referrer, the ?ref=
     tag, a device class, and the language; nothing that identifies a person.
     Honors Do Not Track / Global Privacy Control and stays quiet on localhost. */
  (function beacon(){
    try {
      if (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
      if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl) return;
      var q = new URLSearchParams(location.search);
      var w = window.innerWidth || 0;
      var dev = w < 700 ? 'phone' : (w < 1100 && ('ontouchstart' in window) ? 'tablet' : 'desktop');
      var payload = JSON.stringify({
        page: location.pathname,
        ref: document.referrer || '',
        src: q.get('ref') || q.get('utm_source') || '',
        dev: dev,
        lang: (navigator.language || '').slice(0, 8)
      });
      var url = API_BASE + '/hits';
      if (navigator.sendBeacon) navigator.sendBeacon(url, payload);
      else fetch(url, {method: 'POST', body: payload, headers: {'Content-Type': 'text/plain'}, keepalive: true}).catch(function(){});
    } catch(e){}
  })();

  return {
    API_BASE: API_BASE,
    SYNC_URL: API_BASE + '/notes',
    SITE_HOSTS: SITE_HOSTS,
    DECKS: DECKS,
    CITY_POINTS: CITY_POINTS,
    LOGO: LOGO,
    deckHref: deckHref,
    buildDeckPane: buildDeckPane,
    buildSideNav: buildSideNav,
    paintLogos: paintLogos,
    paintLevels: paintLevels
  };
})();
