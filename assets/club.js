/* The gated-page runtime: gate, shared notes, rail/keyboard nav, member nav pane,
   toasts, and the window.AIHC bridge for page scripts. One copy for every gated page.
   Load order: <script>window.AIHC_PAGE={deck:'<id>'}</script> -> config.js -> club.js (last).
   DECK_ID strings key server-side note storage; never change them. */
(function(){
  'use strict';
  var CFG = window.AIHC_CONFIG || {};
  var PAGE = window.AIHC_PAGE || {};
  var DECK_ID = PAGE.deck || 'deck';
  var SYNC_URL = CFG.SYNC_URL || '';
  var LS_USER = 'aihc_viewer_v1';
  var LS_NOTES = 'aihc_notes_' + DECK_ID;
  var POLL_MS = 25000;

  /* the chassis chrome used to be pasted into every page; now it's injected once here */
  document.body.insertAdjacentHTML('beforeend',
    '<nav class="rail" aria-label="Slides"></nav>' +
    '<div class="hint">&uarr; &darr; to navigate</div>' +
    '<button class="deckbtn" id="deckBtn" aria-label="Menu" hidden>&#9776;</button>' +
    '<nav class="deckpane" id="deckPane" aria-label="The club"></nav>' +
    '<button class="notesbtn" id="notesBtn" aria-label="Toggle notes pane" hidden>&#128172; Notes <span id="noteCount">0</span></button>' +
    '<div class="clickhint" id="clickHint" hidden>Click anywhere on a slide to leave a note</div>' +
    '<aside class="sidepane" id="pane" aria-label="Notes">' +
      '<header><h3>Notes</h3><span class="sync" id="syncStatus">this device only</span><span class="who" id="whoami"></span></header>' +
      '<div class="list" id="noteList"></div>' +
      '<footer id="paneFooter">' +
        '<button class="btn" id="copyBtn">Copy notes</button>' +
        '<button class="btn" id="dlBtn">Download</button>' +
        '<button class="btn ghost" id="importBtn">Paste in notes</button>' +
      '</footer>' +
    '</aside>' +
    '<div class="toast" id="toast" role="status"></div>');

  function $(id){ return document.getElementById(id); }
  function esc(s){ var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg){
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 3200);
  }

  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var currentSlideId = slides.length ? slides[0].id : '';

  /* ---------- gate v2: personal keys ----------
     one opaque credential: a member's invite token, or the admin word.
     the server's POST /member validates either and returns {ok, name, role}. */
  var GATE_MODE = PAGE.gate === 'member' ? 'member' : 'admin';
  var LS_SESSION = 'aihc_member_v1';
  var session = null; /* {token, name, role} */
  try { session = JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch(e){}
  if (session && !session.token) session = null;

  var viewer = null; /* {name}: kept for page-script compat; mirrors the session */

  function validateCred(token, name, onDone){
    fetch((CFG.API_BASE || '') + '/member', {
      method: 'POST', headers: {'Content-Type': 'text/plain'},
      body: JSON.stringify({token: token, name: name || ''})
    }).then(function(r){ return r.json(); })
      .then(function(d){ onDone(d && d.ok ? d : null); })
      .catch(function(){ onDone(null, true); });
  }
  function saveSession(token, d){
    session = { token: token, name: d.name, role: d.role };
    viewer = { name: d.name };
    try {
      localStorage.setItem(LS_SESSION, JSON.stringify(session));
      localStorage.setItem(LS_USER, JSON.stringify(viewer));
    } catch(e){}
  }
  function clearSession(){
    session = null; viewer = null;
    try { localStorage.removeItem(LS_SESSION); localStorage.removeItem(LS_USER); } catch(e){}
  }

  function lock(){
    document.body.classList.add('locked');
    document.body.classList.remove('pane-open');
    document.body.classList.remove('deck-open');
    $('gate').style.display = 'grid';
    $('notesBtn').hidden = true; $('clickHint').hidden = true; $('deckBtn').hidden = true;
    if ($('gPass')) $('gPass').placeholder = GATE_MODE === 'member' ? 'Invite code, from your email' : 'The admin word';
    try {
      var pf = JSON.parse(localStorage.getItem('aihc_prefill_v1') || 'null');
      if (pf && pf.name && !$('gName').value) $('gName').value = pf.name;
    } catch(e){}
    setTimeout(function(){ $('gName').focus(); }, 50);
  }
  function unlock(first){
    document.body.classList.remove('locked');
    $('gate').style.display = 'none';
    $('notesBtn').hidden = false; $('clickHint').hidden = false; $('deckBtn').hidden = false;
    $('whoami').innerHTML = 'Signed in as ' + esc(viewer.name) + ' &middot; <button id="switchBtn" type="button">not you?</button>';
    $('noteCount').textContent = String(notes.length);
    var sb = $('switchBtn');
    if (sb) sb.addEventListener('click', function(){ clearSession(); lock(); });
    if (window.innerWidth >= 1100) document.body.classList.add('pane-open');
    if (first) toast('Hey ' + viewer.name + '! Welcome in.');
    startSync();
  }
  function gateFail(msg){
    $('gErr').textContent = msg;
    var c = $('gateCard'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
  }
  function tryLogin(){
    var name = $('gName').value.trim();
    var pass = $('gPass').value.trim();
    if (!pass){
      gateFail(GATE_MODE === 'member'
        ? 'Paste the invite code from your email.'
        : 'The admin word goes here.');
      return;
    }
    $('gErr').textContent = '';
    validateCred(pass, name, function(d, netFail){
      if (netFail){ gateFail('Could not reach the club. Try again in a minute.'); return; }
      if (!d){
        gateFail(GATE_MODE === 'member'
          ? 'That code did not open the door. Invites come by email after your first meetup.'
          : 'That is not the word.');
        return;
      }
      /* the burned legacy word just walked in: rotation becomes the door */
      if (d.mustRotate){ showRotate(pass, d); return; }
      saveSession(pass, d);
      unlock(true);
    });
  }
  function wireGate(){
    $('gGo').addEventListener('click', tryLogin);
    $('gPass').addEventListener('keydown', function(ev){ if (ev.key === 'Enter') tryLogin(); });
    $('gName').addEventListener('keydown', function(ev){ if (ev.key === 'Enter') $('gPass').focus(); });
  }
  wireGate();

  /* the old admin word is public in git history; when it opens the door, the gate
     turns into a pick-a-new-word step. "later" lets them through on the old word. */
  function showRotate(oldWord, d){
    var card = $('gateCard');
    var original = card.innerHTML;
    card.innerHTML =
      '<span class="logo" data-size="90" aria-hidden="true"></span>' +
      '<h2>Pick a new admin word</h2>' +
      '<p>The old word shipped in public code, so it retires today. Choose a fresh one &mdash; it changes for every admin, so tell the other founder.</p>' +
      '<input id="rw1" type="password" placeholder="A new admin word (8+ characters)" autocomplete="new-password" aria-label="New admin word">' +
      '<input id="rw2" type="password" placeholder="Same word again" autocomplete="new-password" aria-label="New admin word, again">' +
      '<p class="err" id="rwErr" role="alert"></p>' +
      '<button id="rwGo">Lock it in</button>' +
      '<p><button id="rwLater" type="button" style="background:none;border:none;color:inherit;opacity:.65;cursor:pointer;font:inherit;text-decoration:underline">Not now &mdash; ask me next time</button></p>';
    if (CFG.paintLogos) CFG.paintLogos(card);
    function done(word, rotated){
      card.innerHTML = original;
      wireGate();
      if (CFG.paintLogos) CFG.paintLogos(card);
      saveSession(word, d);
      unlock(true);
      if (rotated) toast('New word set. It is the only key now — pass it along.');
    }
    function fail(msg){
      $('rwErr').textContent = msg;
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    }
    $('rwGo').addEventListener('click', function(){
      var w1 = $('rw1').value.trim(), w2 = $('rw2').value.trim();
      if (w1.length < 8){ fail('Eight characters at least.'); return; }
      if (w1 !== w2){ fail('Those two do not match.'); return; }
      fetch((CFG.API_BASE || '') + '/admin-secret', {
        method: 'POST', headers: {'Content-Type': 'text/plain'},
        body: JSON.stringify({secret: oldWord, next: w1})
      }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(res){
          if (res.ok && res.j && res.j.ok) done(w1, true);
          else fail((res.j && res.j.error) || 'That did not take. Try again.');
        })
        .catch(function(){ fail('Could not reach the club. Try again in a minute.'); });
    });
    $('rw1').addEventListener('keydown', function(ev){ if (ev.key === 'Enter') $('rw2').focus(); });
    $('rw2').addEventListener('keydown', function(ev){ if (ev.key === 'Enter') $('rwGo').click(); });
    $('rwLater').addEventListener('click', function(){ done(oldWord, false); });
    setTimeout(function(){ $('rw1').focus(); }, 50);
  }

  /* bridge for page-specific scripts: everything credential-ish reads live off the session */
  window.AIHC = {
    deck: DECK_ID, sync: SYNC_URL, toast: toast,
    viewer: function(){ return viewer; },
    cred: function(){ return session ? session.token : ''; },
    role: function(){ return session ? session.role : ''; },
    /* the console's admin-word panel swaps the stored credential in place so a
       rotation does not log the rotator out */
    setCred: function(token){
      if (session) saveSession(String(token), { name: session.name, role: session.role });
    }
  };
  try {
    Object.defineProperty(window.AIHC, 'secret', { get: function(){ return session ? session.token : ''; } });
  } catch(e){ window.AIHC.secret = ''; }

  /* ---------- notes store ---------- */
  var notes = [];
  try { notes = JSON.parse(localStorage.getItem(LS_NOTES) || '[]'); } catch(e){ notes = []; }
  function persist(){
    localStorage.setItem(LS_NOTES, JSON.stringify(notes));
    $('noteCount').textContent = String(notes.length);
    renderPins(); renderList();
  }
  function slideIndex(id){
    for (var i = 0; i < slides.length; i++){ if (slides[i].id === id) return i; }
    return 999;
  }
  function sortNotes(){
    notes.sort(function(a, b){
      var d = slideIndex(a.slide) - slideIndex(b.slide);
      return d !== 0 ? d : (a.y - b.y);
    });
  }

  /* ---------- sync ---------- */
  var syncOk = false, syncStarted = false, everSynced = false;
  function setSync(ok){
    syncOk = ok;
    if (ok) everSynced = true;
    var el = $('syncStatus');
    if (!SYNC_URL || (!ok && !everSynced)){ el.textContent = 'this device only'; el.classList.remove('on'); return; }
    el.textContent = ok ? 'shared' : 'reconnecting…';
    el.classList.toggle('on', ok);
  }
  var pendingDeletes = [];
  function serverPush(payload, onOk){
    if (!SYNC_URL) return;
    fetch(SYNC_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain'},
      body: JSON.stringify(Object.assign({secret: session ? session.token : '', deck: DECK_ID}, payload))
    }).then(function(r){ return r.json(); })
      .then(function(d){
        if (!d || d.error) throw new Error('rejected');
        setSync(true);
        if (onOk) onOk();
      })
      .catch(function(){ setSync(false); });
  }
  function markSynced(note){
    return function(){
      note.synced = true;
      localStorage.setItem(LS_NOTES, JSON.stringify(notes));
    };
  }
  function retryDelete(id){
    serverPush({action: 'delete', id: id}, function(){
      pendingDeletes = pendingDeletes.filter(function(x){ return x !== id; });
    });
  }
  function serverFetch(){
    if (!SYNC_URL) return;
    fetch(SYNC_URL + '?secret=' + encodeURIComponent(session ? session.token : '') + '&deck=' + encodeURIComponent(DECK_ID))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d || !d.notes) throw new Error('bad payload');
        var server = d.notes.map(function(n){
          return {id: String(n.id), slide: String(n.slide), x: Number(n.x), y: Number(n.y),
                  name: String(n.name), text: String(n.text), ts: String(n.ts), synced: true};
        });
        // deletions we haven't managed to tell the server about yet
        server = server.filter(function(n){ return pendingDeletes.indexOf(n.id) === -1; });
        pendingDeletes.forEach(retryDelete);
        // local notes the server doesn't have yet get pushed again
        var serverIds = {};
        server.forEach(function(n){ serverIds[n.id] = true; });
        var pending = notes.filter(function(n){ return !n.synced && !serverIds[n.id]; });
        pending.forEach(function(n){ serverPush({action: 'add', note: n}, markSynced(n)); });
        notes = server.concat(pending);
        sortNotes(); persist(); setSync(true);
      })
      .catch(function(){ setSync(false); });
  }
  function startSync(){
    if (syncStarted) return;
    syncStarted = true;
    setSync(false);
    if (!SYNC_URL) return;
    serverFetch();
    setTimeout(function(){ if (!everSynced) serverFetch(); }, 4000);
    setInterval(function(){
      if (document.visibilityState === 'visible' && viewer) serverFetch();
    }, POLL_MS);
  }

  function addNote(n){
    n.synced = false;
    notes.push(n);
    sortNotes(); persist();
    serverPush({action: 'add', note: n}, markSynced(n));
  }
  function deleteNote(id){
    notes = notes.filter(function(m){ return m.id !== id; });
    persist();
    if (SYNC_URL){
      pendingDeletes.push(id);
      retryDelete(id);
    }
  }

  /* ---------- pins ---------- */
  function renderPins(){
    document.querySelectorAll('.pin').forEach(function(p){ p.remove(); });
    notes.forEach(function(n, idx){
      var slide = document.getElementById(n.slide);
      if (!slide) return;
      var pin = document.createElement('button');
      pin.className = 'pin';
      pin.style.left = n.x + '%';
      pin.style.top = n.y + '%';
      pin.textContent = String(idx + 1);
      pin.setAttribute('data-note', n.id);
      pin.setAttribute('aria-label', 'Note ' + (idx + 1) + ' by ' + n.name);
      pin.addEventListener('click', function(ev){
        ev.stopPropagation();
        openView(n, ev.clientX, ev.clientY);
      });
      slide.appendChild(pin);
    });
  }

  /* ---------- popovers ---------- */
  var pop = null;
  function closePop(){ if (pop){ pop.remove(); pop = null; } }
  function placePop(x, y){
    var w = Math.min(320, window.innerWidth - 24);
    var left = Math.min(Math.max(12, x - w / 2), window.innerWidth - w - 12);
    var top = Math.min(y + 14, window.innerHeight - 220);
    pop.style.left = left + 'px';
    pop.style.top = Math.max(12, top) + 'px';
  }
  function openCompose(slideId, xPct, yPct, cx, cy){
    closePop();
    pop = document.createElement('div');
    pop.className = 'popover';
    pop.innerHTML =
      '<span class="who">Leave a note as ' + esc(viewer.name) + '</span>' +
      '<textarea placeholder="What are you thinking?"></textarea>' +
      '<div class="row"><button class="btn ghost" data-act="cancel">Cancel</button>' +
      '<button class="btn" data-act="save">Pin it</button></div>';
    document.body.appendChild(pop);
    placePop(cx, cy);
    var ta = pop.querySelector('textarea');
    ta.focus();
    pop.addEventListener('click', function(ev){
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'cancel') closePop();
      if (act === 'save'){
        var text = ta.value.trim();
        if (!text){ ta.focus(); return; }
        addNote({
          id: 'n' + Math.random().toString(36).slice(2, 10),
          slide: slideId, x: Math.round(xPct * 10) / 10, y: Math.round(yPct * 10) / 10,
          name: viewer.name, text: text, ts: new Date().toISOString()
        });
        closePop();
        toast(SYNC_URL ? 'Pinned and shared.' : 'Pinned. Saved on this device; use Copy notes to send it along.');
      }
    });
  }
  function openView(n, cx, cy){
    closePop();
    pop = document.createElement('div');
    pop.className = 'popover';
    var when = (n.ts || '').replace('T', ' ').slice(0, 16);
    pop.innerHTML =
      '<span class="who">' + esc(n.name) + ' <span class="when">' + esc(when) + '</span></span>' +
      '<p class="body">' + esc(n.text) + '</p>' +
      '<div class="row"><button class="btn warn" data-act="del">Delete</button>' +
      '<button class="btn ghost" data-act="close">Close</button></div>';
    document.body.appendChild(pop);
    placePop(cx, cy);
    pop.addEventListener('click', function(ev){
      var act = ev.target.getAttribute && ev.target.getAttribute('data-act');
      if (act === 'close') closePop();
      if (act === 'del'){ deleteNote(n.id); closePop(); }
    });
  }

  /* click anywhere on a slide to comment */
  slides.forEach(function(slide){
    slide.addEventListener('click', function(ev){
      if (!viewer) return;
      if (ev.target.closest('a, button, input, textarea, label, .pin, .popover, .sidepane')) return;
      if (pop){ closePop(); return; }
      var r = slide.getBoundingClientRect();
      var xPct = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
      var yPct = Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100));
      openCompose(slide.id, xPct, yPct, ev.clientX, ev.clientY);
    });
  });
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'Escape'){
      closePop();
      document.body.classList.remove('deck-open');
      if (window.innerWidth < 1100) document.body.classList.remove('pane-open');
    }
  });

  /* ---------- side pane ---------- */
  function slideTitle(id){
    var s = document.getElementById(id);
    return s ? (s.getAttribute('data-title') || id) : id;
  }
  function jumpToNote(n){
    var slide = document.getElementById(n.slide);
    if (!slide) return;
    if (window.innerWidth < 1100) document.body.classList.remove('pane-open');
    slide.scrollIntoView();
    setTimeout(function(){
      var pin = document.querySelector('.pin[data-note="' + n.id + '"]');
      if (!pin) return;
      pin.classList.remove('pulse'); void pin.offsetWidth; pin.classList.add('pulse');
      var r = pin.getBoundingClientRect();
      openView(n, r.left + r.width / 2, r.bottom + 4);
      setTimeout(function(){ pin.classList.remove('pulse'); }, 2400);
    }, 550);
  }
  function renderList(){
    var list = $('noteList');
    if (!notes.length){
      list.innerHTML = '<div class="empty">No notes yet. Click anywhere on a slide to leave the first one.</div>';
      return;
    }
    list.innerHTML = '';
    var byIdx = {};
    notes.forEach(function(n, idx){
      if (!byIdx[n.slide]) byIdx[n.slide] = [];
      byIdx[n.slide].push({n: n, idx: idx});
    });
    slides.forEach(function(s, si){
      var items = byIdx[s.id];
      if (!items) return;
      var g = document.createElement('div');
      g.className = 'group' + (s.id === currentSlideId ? ' current' : '');
      g.setAttribute('data-slide', s.id);
      var h = document.createElement('div');
      h.className = 'ghead';
      h.textContent = (si + 1) + ' · ' + (s.getAttribute('data-title') || s.id);
      g.appendChild(h);
      items.forEach(function(it){
        var d = document.createElement('div');
        d.className = 'note';
        d.innerHTML =
          '<span class="meta"><span class="n">#' + (it.idx + 1) + '</span><span>' + esc(it.n.name) + '</span></span>' +
          '<span class="txt">' + esc(it.n.text) + '</span>' +
          '<button class="del" type="button">remove</button>';
        d.addEventListener('click', function(ev){
          if (ev.target.classList.contains('del')){ deleteNote(it.n.id); return; }
          jumpToNote(it.n);
        });
        var hoverT = null;
        d.addEventListener('mouseenter', function(){
          hoverT = setTimeout(function(){
            var slide = document.getElementById(it.n.slide);
            if (slide) slide.scrollIntoView({behavior: 'smooth'});
            var pin = document.querySelector('.pin[data-note="' + it.n.id + '"]');
            if (pin) pin.classList.add('bounce');
          }, 120);
        });
        d.addEventListener('mouseleave', function(){
          clearTimeout(hoverT);
          document.querySelectorAll('.pin.bounce').forEach(function(p){ p.classList.remove('bounce'); });
        });
        g.appendChild(d);
      });
      list.appendChild(g);
    });
  }
  function paneFollow(){
    var list = $('noteList');
    list.querySelectorAll('.group').forEach(function(g){
      g.classList.toggle('current', g.getAttribute('data-slide') === currentSlideId);
    });
    var cur = list.querySelector('.group.current');
    if (cur && document.body.classList.contains('pane-open')){
      cur.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }
  }
  $('notesBtn').addEventListener('click', function(){
    document.body.classList.toggle('pane-open');
    if (document.body.classList.contains('pane-open')){ renderList(); paneFollow(); }
  });

  /* ---------- export / import ---------- */
  function exportText(){
    var lines = notes.map(function(n, i){
      return '#' + (i + 1) + ' [' + slideTitle(n.slide) + '] ' + n.name + ': ' + n.text;
    });
    return lines.join('\n') + '\n\n---\naihc-notes-json: ' + JSON.stringify(notes);
  }
  $('copyBtn').addEventListener('click', function(){
    if (!notes.length){ toast('Nothing to copy yet.'); return; }
    var txt = exportText();
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){
        toast('Copied. Paste it into a text or email.');
      }, function(){ toast('Could not copy. Try the Download button.'); });
    } else { toast('Could not copy. Try the Download button.'); }
  });
  $('dlBtn').addEventListener('click', function(){
    if (!notes.length){ toast('Nothing to download yet.'); return; }
    if (window.claude && window.claude.downloads && window.claude.downloads.save){
      window.claude.downloads.save({ filename: 'aihc-' + DECK_ID + '-notes.txt', data: exportText() })
        .then(function(){ toast('Saved.'); })
        .catch(function(){ toast('Download was cancelled.'); });
    } else {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([exportText()], {type: 'text/plain'}));
      a.download = 'aihc-' + DECK_ID + '-notes.txt';
      document.body.appendChild(a); a.click(); a.remove();
    }
  });
  $('importBtn').addEventListener('click', function(){
    var footer = $('paneFooter');
    if (footer.querySelector('.importbox')) return;
    var ta = document.createElement('textarea');
    ta.className = 'importbox';
    ta.placeholder = 'Paste copied notes here, then click Add.';
    var add = document.createElement('button');
    add.className = 'btn'; add.textContent = 'Add';
    add.addEventListener('click', function(){
      var m = ta.value.match(/aihc-notes-json:\s*(\[.*\])\s*$/s) || ta.value.match(/(\[.*\])/s);
      if (!m){ toast('Could not find notes in that paste.'); return; }
      try {
        var incoming = JSON.parse(m[1]);
        var have = {};
        notes.forEach(function(n){ have[n.id] = true; });
        var added = 0;
        incoming.forEach(function(n){
          if (n && n.id && !have[n.id]){
            n.synced = false;
            notes.push(n); added++;
            serverPush({action: 'add', note: n}, markSynced(n));
          }
        });
        sortNotes(); persist();
        toast(added + ' note' + (added === 1 ? '' : 's') + ' added.');
        ta.remove(); add.remove();
      } catch(e){ toast('That did not look like notes. Copy them again.'); }
    });
    footer.appendChild(ta); footer.appendChild(add);
    ta.focus();
  });

  /* ---------- rail + keyboard nav ---------- */
  var rail = document.querySelector('.rail');
  slides.forEach(function(s, i){
    var b = document.createElement('button');
    b.setAttribute('aria-label', 'Slide ' + (i + 1) + ': ' + (s.getAttribute('data-title') || ''));
    b.addEventListener('click', function(){ s.scrollIntoView(); });
    rail.appendChild(b);
  });
  var ticks = rail.querySelectorAll('button');
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting){
        var i = slides.indexOf(e.target);
        currentSlideId = e.target.id;
        ticks.forEach(function(t, j){ t.classList.toggle('on', j === i); });
        paneFollow();
      }
    });
  }, {threshold: 0.6});
  slides.forEach(function(s){ io.observe(s); });

  function current(){
    var y = window.scrollY + window.innerHeight / 2;
    for (var i = slides.length - 1; i >= 0; i--){
      if (slides[i].offsetTop < y) return i;
    }
    return 0;
  }
  document.addEventListener('keydown', function(ev){
    var tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (document.body.classList.contains('locked')) return;
    if (ev.key === 'ArrowDown' || ev.key === 'PageDown' || ev.key === ' '){
      ev.preventDefault();
      slides[Math.min(current() + 1, slides.length - 1)].scrollIntoView();
    } else if (ev.key === 'ArrowUp' || ev.key === 'PageUp'){
      ev.preventDefault();
      slides[Math.max(current() - 1, 0)].scrollIntoView();
    }
  });

  /* ---------- deck switcher (nav data + renderer live in config.js) ---------- */
  CFG.buildDeckPane($('deckPane'), DECK_ID);
  $('deckBtn').addEventListener('click', function(){
    document.body.classList.toggle('deck-open');
  });

  /* ---------- art: the coffee urn and the potluck ladder ---------- */
  /* the urn logo itself lives in config.js */
  CFG.paintLogos(document);
  CFG.paintLevels(document, 64, 88);

  /* ---------- boot: invite links, stored keys, or the gate ---------- */
  sortNotes();
  (function boot(){
    var params = new URLSearchParams(location.search);
    var inv = (params.get('invite') || '').trim();
    if (inv){
      /* the token never stays in the URL or history */
      try { history.replaceState(null, '', location.pathname + location.hash); } catch(e){}
      validateCred(inv, '', function(d, netFail){
        if (d){ saveSession(inv, d); unlock(true); }
        else {
          lock();
          gateFail(netFail
            ? 'Could not reach the club. Try your invite link again in a minute.'
            : 'That invite did not open the door. Reply to your invite email for a fresh one.');
        }
      });
      return;
    }
    if (session && session.token){
      /* optimistic unlock; revalidate behind the scenes and re-lock if the key was retired */
      viewer = { name: session.name };
      unlock(false);
      validateCred(session.token, session.name, function(d, netFail){
        if (!d && !netFail){ clearSession(); lock(); gateFail('Your key was retired. Ask for a fresh invite.'); }
        else if (d){ saveSession(session.token, d); } /* picks up renames and promotions */
      });
      return;
    }
    lock();
  })();
  renderPins(); renderList();
})();
