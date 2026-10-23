/* The public-page runtime: paints the urn, exposes tiny shared helpers, and
   injects the member hamburger for devices that have already passed the gate.
   Load order: config.js -> site.js -> the page's own script. */
(function(){
  'use strict';
  var CFG = window.AIHC_CONFIG || {};

  function $(id){ return document.getElementById(id); }
  function esc(s){ var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function fmtTime(t){
    if (!/^\d{1,2}:\d{2}$/.test(t || '')) return '';
    var parts = t.split(':');
    var h = parseInt(parts[0], 10);
    var ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + parts[1] + ' ' + ap;
  }
  /* 60 -> 'one hour', 120 -> 'two hours', 90 -> '90 minutes': a meetup's length, for copy */
  function lengthPhrase(m){
    m = parseInt(m, 10) || 60;
    return m === 60 ? 'one hour' : m === 120 ? 'two hours' : m === 180 ? 'three hours' : m + ' minutes';
  }
  window.AIHC_UI = { $: $, esc: esc, fmtTime: fmtTime, lengthPhrase: lengthPhrase };

  CFG.paintLogos(document);
  CFG.paintLevels(document, 60, 84);

  /* arrival: on pages that choreograph nothing themselves, the parts of each section rise once as
     they enter, staggered in reading order. Everything is painted first; this only adds the arrival. */
  document.documentElement.classList.add('js');
  (function(){
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var own = !!document.querySelector('[data-reveal]');   /* a page that choreographs itself is left alone */
    var io = ('IntersectionObserver' in window && !reduce) ? new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if (en.isIntersecting){ en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }) : null;
    var seen = 0;
    function watch(el){ if (io) io.observe(el); else el.classList.add('is-in'); }
    function tag(root){
      if (own) return;
      var parts = root.querySelectorAll('h2, h3, .body, .lede, .hand, .callsheet .row, .index-card, .field, .fine, .infoc .r, .evc .r, .later .p, .past .p, .fact, .qr, img, .seats, .evx, .town, .rcp, .btn-lg, .btn-primary');
      var i = 0;
      Array.prototype.forEach.call(parts, function(el){
        if (seen >= 80 || el.hasAttribute('data-reveal') || el.closest('[data-reveal]') || el.closest('header, footer')) return;
        el.setAttribute('data-reveal', ''); el.style.setProperty('--i', String(i % 6)); i++; seen++;
        watch(el);
      });
    }
    var main = document.querySelector('main') || document.body;
    if (own) Array.prototype.forEach.call(document.querySelectorAll('[data-reveal]'), watch);
    else {
      tag(main);
      if ('MutationObserver' in window){
        var pending = null;
        new MutationObserver(function(){ clearTimeout(pending); pending = setTimeout(function(){ tag(main); }, 60); })
          .observe(main, { childList: true, subtree: true });
      }
    }
  })();

  /* the masthead's small-screen menu button */
  var menuBtn = document.querySelector('.masthead .menu');
  if (menuBtn) menuBtn.addEventListener('click', function(){ document.body.classList.toggle('nav-open'); });

  /* one toast for the public pages (copy buttons, share) */
  var toastEl = null, toastTimer = null;
  function toast(msg){
    if (!toastEl){ toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  }
  window.AIHC_UI.toast = toast;

  /* members-only nav: only for devices that have already passed the gate.
     The public pages link the clubhouse door; the pitches stay off the menu for guests. */
  var viewer = null, session = null;
  try { viewer = JSON.parse(localStorage.getItem('aihc_viewer_v1') || 'null'); } catch(e){}
  try { session = JSON.parse(localStorage.getItem('aihc_member_v1') || 'null'); } catch(e){}
  if (!viewer || !viewer.name) return;

  var PAGE_IDS = {'': 'home', 'index.html': 'home', 'waterville.html': 'waterville', 'portland.html': 'portland', 'events.html': 'events',
                  'recipes.html': 'recipes', 'chat.html': 'chat', 'feed.html': 'feed', 'members.html': 'members'};
  var file = location.pathname.split('/').pop();
  var current = PAGE_IDS.hasOwnProperty(file) ? PAGE_IDS[file] : null;

  var btn = document.createElement('button');
  btn.className = 'deckbtn'; btn.type = 'button';
  btn.innerHTML = 'The club'; btn.setAttribute('aria-label', 'Club menu');
  var pane = document.createElement('nav');
  pane.className = 'deckpane'; pane.id = 'deckPane'; pane.setAttribute('aria-label', 'The club');
  CFG.buildDeckPane(pane, current, session ? session.role : '');
  document.body.appendChild(btn);
  document.body.appendChild(pane);
  btn.addEventListener('click', function(){ document.body.classList.toggle('deck-open'); });
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'Escape') document.body.classList.remove('deck-open');
  });
})();
