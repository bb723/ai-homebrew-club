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
  window.AIHC_UI = { $: $, esc: esc, fmtTime: fmtTime };

  CFG.paintLogos(document);
  CFG.paintLevels(document, 60, 84);

  /* members-only nav: only for devices that have already passed the gate.
     The public pages link the clubhouse door; the pitches stay off the menu for guests. */
  var viewer = null;
  try { viewer = JSON.parse(localStorage.getItem('aihc_viewer_v1') || 'null'); } catch(e){}
  if (!viewer || !viewer.name) return;

  var PAGE_IDS = {'': 'home', 'index.html': 'home', 'waterville.html': 'waterville',
                  'recipes.html': 'recipes', 'chat.html': 'chat', 'feed.html': 'feed'};
  var file = location.pathname.split('/').pop();
  var current = PAGE_IDS.hasOwnProperty(file) ? PAGE_IDS[file] : null;

  var btn = document.createElement('button');
  btn.className = 'deckbtn'; btn.type = 'button';
  btn.innerHTML = '&#9776;'; btn.setAttribute('aria-label', 'Menu');
  var pane = document.createElement('nav');
  pane.className = 'deckpane'; pane.id = 'deckPane'; pane.setAttribute('aria-label', 'The club');
  CFG.buildDeckPane(pane, current);
  document.body.appendChild(btn);
  document.body.appendChild(pane);
  btn.addEventListener('click', function(){ document.body.classList.toggle('deck-open'); });
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'Escape') document.body.classList.remove('deck-open');
  });
})();
