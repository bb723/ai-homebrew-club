/* The studio P&L calculator. Loaded only by deck/model.html (the #modelPane guard
   keeps it inert anywhere else). */
(function(){
  'use strict';
  function $(id){ return document.getElementById(id); }
  (function(){
    if (!$('modelPane')) return;
    var LS_MODEL = 'aihc_model_v1';
    var BASE = {fee:12000, sub:1000, conv:85, churn:12, fdeCost:150000, perMo:1.2, f27:0, f28:1.5, f29:3.5, founders:10, accel:false, lic:false, ops:true};
    var PRESETS = {
      base: BASE,
      cons: {fee:10000, sub:800, conv:70, churn:20, fdeCost:150000, perMo:0.8, f27:0, f28:1, f29:2, founders:6, accel:false, lic:false, ops:true},
      stretch: {fee:15000, sub:1400, conv:90, churn:8, fdeCost:150000, perMo:1.75, f27:0, f28:2, f29:4, founders:10, accel:false, lic:true, ops:true}
    };
    var ids = {fee:'dFee', sub:'dSub', conv:'dConv', churn:'dChurn', fdeCost:'dFdeCost', perMo:'dPerMo', f27:'dF27', f28:'dF28', f29:'dF29', founders:'dFounders'};
    var togs = {accel:'tAccel', lic:'tLic', ops:'tOps'};
    var m;
    try { m = JSON.parse(localStorage.getItem(LS_MODEL) || 'null'); } catch(e){ m = null; }
    if (!m || typeof m.fee !== 'number') m = JSON.parse(JSON.stringify(BASE));

    function fmtMoney(v){
      var neg = v < 0 ? '&minus;' : ''; v = Math.abs(v);
      if (v >= 995000) return neg + '$' + (v/1000000).toFixed(2).replace(/\.?0+$/,'') + 'M';
      return neg + '$' + Math.round(v/1000) + 'K';
    }
    function calc(){
      var founder = [m.founders, Math.round(m.founders*0.8), Math.round(m.founders*0.6)];
      var fde = m.accel ? [m.f27 + 0.5, m.f28 + 1, m.f29 + 1] : [m.f27, m.f28, m.f29];
      var other = [10000, 30000, 40000 + (m.lic ? 150000 : 0)];
      var opex = [44000, 43000, 50000 + (m.ops ? 70000 : 0)];
      var book = 0, out = [];
      for (var i = 0; i < 3; i++){
        var installs = Math.round(founder[i] + fde[i]*12*m.perMo);
        var instRev = installs*m.fee;
        var newSubs = Math.round(installs*(m.conv/100));
        var churned = Math.round(book*(m.churn/100));
        var bookEnd = Math.max(0, book + newSubs - churned);
        var subRev = ((book + bookEnd)/2)*m.sub*12;
        var rev = instRev + subRev + other[i];
        var cost = fde[i]*m.fdeCost + opex[i];
        out.push({fde:fde[i], installs:installs, instRev:instRev, subRev:subRev, other:other[i], rev:rev, cost:cost, margin:rev-cost, subs:bookEnd, arr:bookEnd*m.sub*12});
        book = bookEnd;
      }
      return out;
    }
    function markPreset(p){
      Array.prototype.forEach.call(document.querySelectorAll('#mPresets button'), function(b){
        b.classList.toggle('on', b.getAttribute('data-p') === p);
      });
    }
    function detectPreset(){
      var cur = JSON.stringify(m), hit = null;
      Object.keys(PRESETS).forEach(function(p){ if (JSON.stringify(PRESETS[p]) === cur) hit = p; });
      markPreset(hit);
    }
    function render(){
      Object.keys(ids).forEach(function(k){ var el = $(ids[k]); if (el) el.value = m[k]; });
      Object.keys(togs).forEach(function(k){ var el = $(togs[k]); if (el) el.checked = !!m[k]; });
      $('vFee').innerHTML = fmtMoney(m.fee);
      $('vSub').textContent = '$' + m.sub + '/mo';
      $('vConv').textContent = m.conv + '%';
      $('vChurn').textContent = m.churn + '%/yr';
      $('vFdeCost').innerHTML = fmtMoney(m.fdeCost) + '/yr';
      $('vPerMo').textContent = m.perMo.toFixed(2).replace(/0$/,'') + '/mo';
      $('vFounders').textContent = m.founders + " in '27";
      $('vF27').textContent = m.f27; $('vF28').textContent = m.f28; $('vF29').textContent = m.f29;
      var r = calc();
      var payback = Math.ceil(m.fdeCost / m.fee);
      $('mTiles').innerHTML =
        '<div class="mtile"><span class="n">' + payback + '</span><span class="l">installs pay back one FDE year</span></div>' +
        '<div class="mtile"><span class="n">' + fmtMoney(r[2].arr) + '</span><span class="l">ARR exiting &rsquo;29</span></div>' +
        '<div class="mtile"><span class="n">' + fmtMoney(r[2].margin) + '</span><span class="l">&rsquo;29 margin, pre&#8209;founder pay</span></div>';
      function row(lab, f, cls){
        return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + lab + '</td>' +
          r.map(function(y){ return '<td>' + f(y) + '</td>'; }).join('') + '</tr>';
      }
      $('mTable').innerHTML =
        '<thead><tr><th></th><th>&rsquo;27</th><th>&rsquo;28</th><th>&rsquo;29</th></tr></thead><tbody>' +
        row('FDEs (avg)', function(y){ return y.fde; }) +
        row('Installs', function(y){ return Math.round(y.installs); }) +
        row('Install rev', function(y){ return fmtMoney(y.instRev); }) +
        row('Subscriptions', function(y){ return fmtMoney(y.subRev); }) +
        row('Other', function(y){ return fmtMoney(y.other); }) +
        row('Revenue', function(y){ return fmtMoney(y.rev); }, 'tot') +
        row('Costs', function(y){ return fmtMoney(y.cost); }) +
        row('Margin', function(y){ return fmtMoney(y.margin); }, 'tot') +
        row('Subscribers (exit)', function(y){ return Math.round(y.subs); }) +
        row('ARR (exit)', function(y){ return fmtMoney(y.arr); }, 'arr') +
        '</tbody>';
    }
    function persistM(){ try { localStorage.setItem(LS_MODEL, JSON.stringify(m)); } catch(e){} }
    Object.keys(ids).forEach(function(k){
      var el = $(ids[k]); if (!el) return;
      el.addEventListener('input', function(){ m[k] = parseFloat(el.value); markPreset(null); persistM(); render(); });
    });
    Object.keys(togs).forEach(function(k){
      var el = $(togs[k]); if (!el) return;
      el.addEventListener('change', function(){ m[k] = el.checked; markPreset(null); persistM(); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#mPresets button'), function(b){
      b.addEventListener('click', function(){
        m = JSON.parse(JSON.stringify(PRESETS[b.getAttribute('data-p')]));
        markPreset(b.getAttribute('data-p')); persistM(); render();
      });
    });
    $('mReset').addEventListener('click', function(){
      m = JSON.parse(JSON.stringify(BASE)); markPreset('base'); persistM(); render();
    });
    render(); detectPreset();
  })();
})();
