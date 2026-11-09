/* Money Tracker — single-page, offline-first. All data stays in this browser (localStorage). */
(function () {
  'use strict';

  /* ---------- constants ---------- */
  const CATS = {
    rent:      { label: 'Rent / Mortgage', icon: '🏠', color: '#c0392b' },
    groceries: { label: 'Groceries',       icon: '🛒', color: '#27ae60' },
    gas:       { label: 'Gas / Fuel',      icon: '⛽', color: '#e67e22' },
    utilities: { label: 'Utilities',       icon: '💡', color: '#f1c40f' },
    insurance: { label: 'Insurance',       icon: '🛡️', color: '#2980b9' },
    phone:     { label: 'Phone / Internet',icon: '📱', color: '#8e44ad' },
    subs:      { label: 'Subscriptions',   icon: '📺', color: '#16a085' },
    transport: { label: 'Car / Transit',   icon: '🚗', color: '#34495e' },
    dining:    { label: 'Dining out',      icon: '🍽️', color: '#d35400' },
    health:    { label: 'Health',          icon: '💊', color: '#e84393' },
    debt:      { label: 'Debt payments',   icon: '💳', color: '#7f8c8d' },
    fun:       { label: 'Entertainment',   icon: '🎬', color: '#6c5ce7' },
    savings:   { label: 'Savings',         icon: '🐷', color: '#00b894' },
    other:     { label: 'Other',           icon: '📦', color: '#95a5a6' },
  };
  const ASSET_TYPES = {
    property: { label: 'Home / Property', icon: '🏡', debt: false },
    vehicle:  { label: 'Vehicle',         icon: '🚙', debt: false },
    cash:     { label: 'Bank / Savings',  icon: '🏦', debt: false },
    invest:   { label: 'Investments',     icon: '📈', debt: false },
    retire:   { label: 'Retirement',      icon: '🌴', debt: false },
    other:    { label: 'Other asset',     icon: '💎', debt: false },
    mortgage: { label: 'Mortgage owed',   icon: '🏚️', debt: true },
    loan:     { label: 'Loan owed',       icon: '📄', debt: true },
    card:     { label: 'Credit card owed',icon: '💳', debt: true },
  };
  const KEY = 'moneytracker.v1';

  /* ---------- state ---------- */
  const blank = () => ({ onboarded: false, income: 0, bills: [], assets: [], tx: [] });
  let S = load();
  let view = S.onboarded ? 'home' : 'income';
  let editing = false; // setup screens reached from the menu

  function load() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return blank(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, dec = 2) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const fmt0 = (n) => fmt(n, 0);
  const cls = (n) => (n < 0 ? 'neg' : 'pos');
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const mkey = (d) => ymd(d).slice(0, 7);
  const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const monthName = (d) => d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const prettyDate = (s) => { const d = parseD(s); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`; };
  const num = (v) => { const n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : NaN; };
  const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const catOpts = (sel) => Object.entries(CATS).map(([k, c]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${c.icon} ${c.label}</option>`).join('');
  const mini = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : Math.round(n));

  // Run fn when Enter is pressed. (Never return false from a key handler: that blocks typing.)
  function onEnter(el, fn) { el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(); }); }

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
  }

  /* ---------- calculations ---------- */
  const billsTotal = () => sum(S.bills, (b) => b.amount);
  const assetsTotal = () => sum(S.assets.filter((a) => !ASSET_TYPES[a.type].debt), (a) => a.value);
  const debtsTotal = () => sum(S.assets.filter((a) => ASSET_TYPES[a.type].debt), (a) => a.value);
  const netWorth = () => assetsTotal() - debtsTotal();
  const txIn = (key) => S.tx.filter((t) => t.date.slice(0, 7) === key);
  const varSpent = (key) => sum(txIn(key), (t) => t.amount);
  const monthExpenses = (key) => billsTotal() + varSpent(key);
  const shiftMonth = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

  function catTotals(key) {
    const out = {};
    S.bills.forEach((b) => { out[b.category] = (out[b.category] || 0) + b.amount; });
    txIn(key).forEach((t) => { out[t.category] = (out[t.category] || 0) + t.amount; });
    return out;
  }

  /* Insights: what you spend most on, what's outside your normal range, and the expected month-end balance. */
  function insights() {
    const now = new Date();
    const key = mkey(now);
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const frac = now.getDate() / dim;

    // prior months that have logged spending (up to the last 3)
    const prior = [];
    for (let i = 1; i <= 3; i++) {
      const k = mkey(shiftMonth(now, -i));
      if (txIn(k).length) prior.push(k);
    }
    // typical monthly *variable* spend per category, averaged over prior months
    const typical = {};
    prior.forEach((k) => txIn(k).forEach((t) => { typical[t.category] = (typical[t.category] || 0) + t.amount / prior.length; }));

    const totals = catTotals(key);
    const spentVar = {};
    txIn(key).forEach((t) => { spentVar[t.category] = (spentVar[t.category] || 0) + t.amount; });
    const grand = sum(Object.values(totals), (x) => x) || 1;

    const cats = Object.keys(totals).map((c) => {
      const billPart = sum(S.bills.filter((b) => b.category === c), (b) => b.amount);
      const v = spentVar[c] || 0;
      const norm = typical[c];
      let status = 'new', pct = 0, expected = null;
      if (norm !== undefined) {
        expected = norm * frac;
        pct = expected > 0 ? (v - expected) / expected : 0;
        // outside normal range = >20% above (or below) what you'd normally have spent by now, and at least $20 off
        if (v - expected > 20 && pct > 0.2) status = 'over';
        else if (expected - v > 20 && pct < -0.2) status = 'under';
        else status = 'ok';
      }
      return { key: c, total: totals[c], billPart, variable: v, typicalMonth: norm, expected, status, pct, share: totals[c] / grand };
    }).sort((a, b) => b.total - a.total);

    const bills = billsTotal();
    const spent = varSpent(key);
    const baseline = prior.length ? sum(Object.values(typical), (x) => x) : null;
    const remaining = baseline !== null ? Math.max(0, baseline * (1 - frac)) : (spent / frac) * (1 - frac);
    const projectedVar = spent + remaining;
    const planned = S.income - bills;
    return {
      now, key, dim, frac, cats, bills, spent, planned,
      leftNow: planned - spent,
      projectedVar,
      endBalance: planned - projectedVar,
      usedHistory: prior.length > 0,
      daysLeft: dim - now.getDate(),
      perDay: Math.max(0, (planned - spent) / Math.max(1, dim - now.getDate())),
    };
  }

  /* ---------- charts (inline SVG) ---------- */
  function donut(income, expenses) {
    const total = Math.max(income, expenses, 1);
    const r = 24, c = 2 * Math.PI * r;
    const e = Math.min(expenses / total, 1) * c;
    return `<svg viewBox="0 0 64 64"><g transform="rotate(-90 32 32)" fill="none" stroke-width="14">
      <circle cx="32" cy="32" r="${r}" stroke="#4caf50"/>
      <circle cx="32" cy="32" r="${r}" stroke="#f44336" stroke-dasharray="${e} ${c}"/></g></svg>`;
  }

  function barChart7() {
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
    const vals = days.map((d) => sum(S.tx.filter((t) => t.date === ymd(d)), (t) => t.amount));
    const max = Math.max(...vals, 1);
    const W = 340, H = 190, base = 160, bw = 34, gap = (W - bw * 7) / 8;
    let g = '';
    vals.forEach((v, i) => {
      const x = gap + i * (bw + gap), h = (v / max) * 120, y = base - Math.max(h, v > 0 ? 3 : 0);
      g += `<rect x="${x}" y="${y}" width="${bw}" height="${base - y}" rx="7" fill="#f44336"/>`;
      g += `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${v.toFixed(2)}$</text>`;
      g += `<text x="${x + bw / 2}" y="${base + 20}" text-anchor="middle">${String(days[i].getMonth() + 1).padStart(2, '0')}/${String(days[i].getDate()).padStart(2, '0')}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}"><line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#333"/>${g}</svg>`;
  }

  function projectionChart() {
    const monthly = S.income - monthExpenses(mkey(new Date()));
    const base = netWorth();
    const pts = [];
    const now = new Date();
    for (let i = 0; i <= 6; i++) pts.push({ label: i === 0 ? 'Now' : shiftMonth(now, i).toLocaleString('en-US', { month: 'short' }), v: base + monthly * i });
    const vs = pts.map((p) => p.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1) { hi += 500; lo -= 500; }
    const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    const W = 340, H = 190, L = 44, R = 10, T = 10, B = 170;
    const x = (i) => L + (i * (W - L - R)) / 6;
    const y = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(6)},${B} L${x(0)},${B} Z`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#0001"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v < 0 ? '-' : ''}${mini(Math.abs(v))}</text>`;
    }
    const labels = pts.map((p, i) => (i % 2 === 0 ? `<text x="${x(i)}" y="${H - 2}" text-anchor="middle">${p.label}</text>` : '')).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}<path d="${area}" fill="#bbdefb" opacity=".8"/><path d="${line}" fill="none" stroke="#1f2933" stroke-width="2.2"/>${labels}</svg>`;
  }

  /* ---------- rendering ---------- */
  const app = $('#app');
  const ICONS = {
    menu: '<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    sync: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18.5 2v4h-4M5.5 22v-4h4"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  function render() {
    closeDrawer();
    window.scrollTo(0, 0);
    if (view === 'home') return renderHome();
    return renderSetup();
  }

  /* ----- setup flow ----- */
  const STEPS = ['income', 'bills', 'assets'];

  function stepDots() {
    const i = STEPS.indexOf(view);
    return `<div class="steps">${STEPS.map((_, n) => `<i class="${n <= i ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  function renderSetup() {
    const titles = { income: 'Welcome', bills: 'Monthly bills', assets: 'Assets & property' };
    const back = editing || view !== 'income';
    app.innerHTML = `
      <header class="topbar">
        ${back ? `<button class="icon-btn" id="back" aria-label="Back">${ICONS.back}</button>` : ''}
        <h1>${titles[view]}</h1>
      </header>
      <div class="setup">${editing ? '' : stepDots()}${{ income: incomeStep, bills: billsStep, assets: assetsStep }[view]()}</div>`;
    bindSetup();
  }

  function incomeStep() {
    return `
      <div class="lead"><h2>Let’s set up your money</h2><p>First, what’s your household’s total monthly income (after tax)?</p></div>
      <div class="card"><label for="inc">Monthly income</label>
        <div class="money"><span>$</span><input id="inc" inputmode="decimal" placeholder="0.00" value="${S.income || ''}" autocomplete="off"></div></div>
      <button class="btn" id="next">${editing ? 'Save' : 'Next'}</button>
      ${editing ? '' : '<button class="link" id="demo">or try it with sample data</button>'}
      <p class="muted sm" style="text-align:center;margin:0">version 3</p>`;
  }

  function billsStep() {
    return `
      <div class="lead"><h2>Monthly recurring bills</h2><p>Add each bill — rent, groceries, gas and so on. Tap <b>+</b> after each one.</p></div>
      <div class="card formcard">
        <h2>New bill</h2><button class="plus" id="addBill" aria-label="Add bill">+</button>
        <div class="form">
          <div><label for="bn">Name</label><input id="bn" placeholder="e.g. Apartment rent" autocomplete="off"></div>
          <div><label for="bc">Category</label><select id="bc">${catOpts('rent')}</select></div>
          <div><label for="ba">Monthly cost</label><div class="money"><span>$</span><input id="ba" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>
        </div>
      </div>
      <div class="card"><h2>Your bills</h2>${
        S.bills.length
          ? S.bills.map((b) => `<div class="row"><div class="badge" style="background:${CATS[b.category].color}22">${CATS[b.category].icon}</div>
              <div class="grow"><div class="t">${esc(b.name)}</div><div class="s">${CATS[b.category].label}</div></div>
              <div class="amt">${fmt(b.amount)}</div><button class="del" data-del-bill="${b.id}" aria-label="Remove">✕</button></div>`).join('') +
            `<div class="total"><span>Total / month</span><span class="neg">${fmt(billsTotal())}</span></div>`
          : '<div class="empty">No bills yet</div>'}</div>
      <button class="btn" id="next">${editing ? 'Done' : 'Next'}</button>`;
  }

  function assetsStep() {
    const typeOpts = Object.entries(ASSET_TYPES).map(([k, t]) => `<option value="${k}">${t.icon} ${t.label}</option>`).join('');
    return `
      <div class="lead"><h2>Property &amp; assets</h2><p>Add what you own (and owe) so we can show your net worth.</p></div>
      <div class="card formcard">
        <h2>New asset</h2><button class="plus" id="addAsset" aria-label="Add asset">+</button>
        <div class="form">
          <div><label for="an">Name</label><input id="an" placeholder="e.g. Family home" autocomplete="off"></div>
          <div><label for="at">Type</label><select id="at">${typeOpts}</select></div>
          <div><label for="av">Current value / balance</label><div class="money"><span>$</span><input id="av" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>
        </div>
      </div>
      <div class="card"><h2>Your assets</h2>${
        S.assets.length
          ? S.assets.map(assetRow).join('') +
            `<div class="total"><span>Net worth</span><span class="${cls(netWorth())}">${fmt(netWorth())}</span></div>`
          : '<div class="empty">Nothing added yet — you can skip this</div>'}</div>
      <button class="btn" id="next">${editing ? 'Done' : 'Finish'}</button>`;
  }

  function assetRow(a, withDel = true) {
    const t = ASSET_TYPES[a.type];
    return `<div class="row"><div class="badge" style="background:#1b9aaa22">${t.icon}</div>
      <div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${t.label}</div></div>
      <div class="amt ${t.debt ? 'neg' : 'pos'}">${t.debt ? '-' : ''}${fmt(a.value)}</div>
      ${withDel ? `<button class="del" data-del-asset="${a.id}" aria-label="Remove">✕</button>` : ''}</div>`;
  }

  function bindSetup() {
    const go = (v) => { view = v; render(); };
    const back = $('#back');
    if (back) back.onclick = () => (editing ? finishEdit() : go(STEPS[STEPS.indexOf(view) - 1]));

    if (view === 'income') {
      const inc = $('#inc');
      const next = () => {
        const v = num(inc.value);
        if (!(v > 0)) { inc.focus(); return toast('Enter your monthly income'); }
        S.income = v; save();
        editing ? finishEdit() : go('bills');
      };
      $('#next').onclick = next;
      onEnter(inc, next);
      const demo = $('#demo'); if (demo) demo.onclick = () => { loadDemo(); finishSetup(); };
    }

    if (view === 'bills') {
      const add = () => {
        const name = $('#bn').value.trim(), amount = num($('#ba').value);
        if (!name) { $('#bn').focus(); return toast('Give the bill a name'); }
        if (!(amount > 0)) { $('#ba').focus(); return toast('Enter the monthly cost'); }
        S.bills.push({ id: uid(), name, category: $('#bc').value, amount }); save();
        const cat = $('#bc').value; render(); $('#bc').value = cat; $('#bn').focus();
      };
      $('#addBill').onclick = add;
      ['#bn', '#ba'].forEach((s) => onEnter($(s), add));
      app.querySelectorAll('[data-del-bill]').forEach((b) => (b.onclick = () => { S.bills = S.bills.filter((x) => x.id !== b.dataset.delBill); save(); render(); }));
      $('#next').onclick = () => (editing ? finishEdit() : go('assets'));
    }

    if (view === 'assets') {
      const add = () => {
        const name = $('#an').value.trim(), value = num($('#av').value);
        if (!name) { $('#an').focus(); return toast('Give it a name'); }
        if (!(value >= 0)) { $('#av').focus(); return toast('Enter the value'); }
        S.assets.push({ id: uid(), name, type: $('#at').value, value }); save(); render(); $('#an').focus();
      };
      $('#addAsset').onclick = add;
      ['#an', '#av'].forEach((s) => onEnter($(s), add));
      app.querySelectorAll('[data-del-asset]').forEach((b) => (b.onclick = () => { S.assets = S.assets.filter((x) => x.id !== b.dataset.delAsset); save(); render(); }));
      $('#next').onclick = () => (editing ? finishEdit() : finishSetup());
    }
  }

  function finishSetup() { S.onboarded = true; save(); editing = false; view = 'home'; render(); }
  function finishEdit() { editing = false; view = 'home'; render(); }

  /* ----- home hub ----- */
  function summaryCol(d) {
    const key = mkey(d), inc = S.income, exp = monthExpenses(key), tot = inc - exp;
    return `<div><div class="mo">${monthName(d)}</div><div class="sumrow">${donut(inc, exp)}
      <div class="kv"><div><span>Income:</span><span class="pos">${fmt(inc)}</span></div>
      <div><span>Expenses:</span><span class="neg">${fmt(-exp)}</span></div>
      <div><span>Total:</span><span class="${cls(tot)}">${fmt(tot)}</span></div></div></div></div>`;
  }

  function renderHome() {
    const I = insights();
    const now = new Date();
    const top = I.cats.slice(0, 3);
    const recent = [...S.tx].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 4);
    const over = I.cats.filter((c) => c.status === 'over');

    app.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" id="burger" aria-label="Menu">${ICONS.menu}</button>
        <h1>Overview</h1>
        <button class="icon-btn" id="refresh" aria-label="Refresh">${ICONS.sync}</button>
      </header>
      <div class="wrap">
        <section class="card tap" data-open="summary"><h2>Summary</h2>
          <div class="cols">${summaryCol(now)}${summaryCol(shiftMonth(now, -1))}</div></section>

        <section class="card tap" data-open="endmonth"><h2>End of month</h2>
          <div class="muted sm" style="text-align:center">You should have about</div>
          <div class="hero-num ${cls(I.endBalance)}">${fmt(I.endBalance)}</div>
          <div class="muted sm" style="text-align:center">left on ${monthName(now).split(' ')[0]} ${I.dim} · income ${fmt0(S.income)} − bills ${fmt0(I.bills)} − spending</div></section>

        <section class="card tap" data-open="top"><h2>Where your money goes</h2>
          ${top.length ? top.map((c) => `<div style="margin:10px 0 4px"><div style="display:flex;justify-content:space-between;gap:8px">
            <span>${CATS[c.key].icon} ${CATS[c.key].label} ${pill(c)}</span><b>${fmt0(c.total)}</b></div>
            <div class="bar"><i style="width:${Math.max(3, c.share * 100)}%;background:${CATS[c.key].color}"></i></div></div>`).join('') : '<div class="empty">Add bills to see this</div>'}
          ${over.length ? `<div class="note">⚠️ <b>${over.map((c) => CATS[c.key].label).join(', ')}</b> ${over.length > 1 ? 'are' : 'is'} outside your normal range this month. Tap for details.</div>` : ''}</section>

        <section class="card tap" data-open="assets"><h2>Assets</h2>
          ${S.assets.length ? S.assets.slice(0, 3).map((a) => {
            const t = ASSET_TYPES[a.type];
            return `<div class="row"><div class="grow"><div class="t">${esc(a.name)}</div><div class="s">${t.label}</div></div>
              <div class="amt ${t.debt ? 'neg' : 'pos'}">${t.debt ? '-' : ''}${fmt(a.value)}</div></div>`;
          }).join('') : '<div class="empty">No assets added — tap to add</div>'}</section>

        <section class="card tap" data-open="week"><h2>Spending - Last 7 days</h2>${barChart7()}</section>

        <section class="card tap" data-open="networth"><h2>Net worth</h2>
          <div class="big">Net worth: <b class="${cls(netWorth())}">${fmt(netWorth())}</b><br>
          Debts: <b class="${debtsTotal() ? 'neg' : 'pos'}">${debtsTotal() ? '-' : ''}${fmt(debtsTotal())}</b></div>
          ${projectionChart()}<div class="muted sm" style="text-align:center;margin-top:8px">Projected next 6 months at your current savings pace</div></section>

        <section class="card tap" data-open="tx"><h2>Transactions</h2>
          ${recent.length ? recent.map(txRow).join('') : '<div class="empty">No transactions yet — tap + to log spending</div>'}</section>
      </div>
      <button class="fab" id="fab" aria-label="Add transaction">+</button>`;

    $('#burger').onclick = openDrawer;
    $('#refresh').onclick = () => { render(); toast('Updated'); };
    $('#fab').onclick = openTxForm;
    app.querySelectorAll('[data-open]').forEach((el) => (el.onclick = () => openDetail(el.dataset.open)));
  }

  function pill(c) {
    if (c.status === 'over') return '<span class="pill over">Above normal</span>';
    if (c.status === 'under') return '<span class="pill ok">Below normal</span>';
    if (c.status === 'ok') return '<span class="pill ok">Normal</span>';
    return '';
  }

  function txRow(t) {
    const c = CATS[t.category];
    return `<div class="row"><div class="badge" style="background:${c.color}22">${c.icon}</div>
      <div class="grow"><div class="t">${esc(t.name)}</div><div class="s">${c.label}</div></div>
      <div style="text-align:right"><div class="amt">${fmt(-t.amount)}</div><div class="s">${prettyDate(t.date)}</div></div></div>`;
  }

  /* ----- drawer ----- */
  function openDrawer() {
    $('#drawer').innerHTML = `
      <div class="head"><b>Money Tracker</b><span>Net worth ${fmt0(netWorth())}</span></div>
      <button class="item" data-go="home">🏠 Home</button><hr>
      <button class="item" data-go="income">💵 Monthly income</button>
      <button class="item" data-go="bills">🧾 Add / edit monthly bills</button>
      <button class="item" data-go="assets">🏡 Add property &amp; assets</button>
      <button class="item" data-go="tx">➕ Log a transaction</button>
      <button class="item" data-go="alltx">📜 All transactions</button><hr>
      <button class="item" data-go="reset">🗑️ Reset all data</button>`;
    $('#drawer').classList.add('open'); $('#scrim').classList.remove('hidden');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawer').querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => {
      const g = b.dataset.go; closeDrawer();
      if (g === 'home') return;
      if (g === 'tx') return openTxForm();
      if (g === 'alltx') return openDetail('tx');
      if (g === 'reset') return confirmReset();
      editing = true; view = g; render();
    }));
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open'); $('#scrim').classList.add('hidden'); $('#drawer').setAttribute('aria-hidden', 'true');
  }
  $('#scrim').onclick = closeDrawer;

  /* ----- sheets ----- */
  function openSheet(title, html, onBind) {
    const sh = $('#sheet');
    sh.innerHTML = `<header class="topbar"><button class="icon-btn" id="sx" aria-label="Close">${ICONS.close}</button><h1>${esc(title)}</h1></header><div class="body">${html}</div>`;
    sh.classList.remove('hidden');
    $('#sx').onclick = closeSheet;
    if (onBind) onBind(sh);
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); render(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#sheet').classList.contains('hidden')) closeSheet(); else closeDrawer(); } });

  function openDetail(which) {
    const I = insights();
    if (which === 'summary' || which === 'top') {
      const over = I.cats.filter((c) => c.status === 'over');
      const body = `
        <div class="card"><h2>Biggest spending — ${monthName(I.now)}</h2>
          ${I.cats.map((c) => {
            let sub = `${Math.round(c.share * 100)}% of expenses`;
            if (c.billPart) sub += ` · bills ${fmt0(c.billPart)}`;
            let range = '';
            if (c.typicalMonth !== undefined) {
              range = `<div class="s">Spent so far ${fmt0(c.variable)} · normal by now ≈ ${fmt0(c.expected)} (usually ${fmt0(c.typicalMonth)}/mo)</div>`;
            } else if (c.variable) {
              range = `<div class="s">Logged so far ${fmt0(c.variable)} · building your normal range…</div>`;
            }
            return `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
              <span style="font-size:17px">${CATS[c.key].icon} ${CATS[c.key].label} ${pill(c)}</span><b>${fmt(c.total)}</b></div>
              <div class="bar"><i style="width:${Math.max(3, c.share * 100)}%;background:${CATS[c.key].color}"></i></div>
              <div class="s" style="margin-top:4px">${sub}</div>${range}</div>`;
          }).join('')}</div>
        <div class="card"><h2>Outside your normal range</h2>
          ${over.length ? over.map((c) => `<div class="row"><div class="badge" style="background:#fde4e1">${CATS[c.key].icon}</div>
            <div class="grow"><div class="t">${CATS[c.key].label}</div><div class="s">${fmt0(c.variable - c.expected)} more than usual by this point in the month (+${Math.round(c.pct * 100)}%)</div></div>
            <span class="pill over">Above</span></div>`).join('')
            : `<div class="empty">${I.usedHistory ? '✅ Everything is within your normal range.' : 'Log spending for a full month and we’ll learn what’s normal for each category.'}</div>`}</div>`;
      return openSheet('Where your money goes', body);
    }

    if (which === 'endmonth') {
      const body = `
        <div class="card"><h2>What you should have at month end</h2>
          <div class="hero-num ${cls(I.endBalance)}">${fmt(I.endBalance)}</div>
          <div class="row"><div class="grow">Household income</div><div class="amt pos">${fmt(S.income)}</div></div>
          <div class="row"><div class="grow">Monthly bills</div><div class="amt neg">${fmt(-I.bills)}</div></div>
          <div class="row"><div class="grow"><div>Other spending (projected)</div><div class="s">${fmt0(I.spent)} spent so far + ${fmt0(I.projectedVar - I.spent)} expected for the rest of the month</div></div><div class="amt neg">${fmt(-I.projectedVar)}</div></div>
          <div class="total"><span>Left at end of month</span><span class="${cls(I.endBalance)}">${fmt(I.endBalance)}</span></div></div>
        <div class="card"><h2>Right now</h2>
          <div class="row"><div class="grow">Income − bills</div><div class="amt ${cls(I.planned)}">${fmt(I.planned)}</div></div>
          <div class="row"><div class="grow">Spent this month (non-bill)</div><div class="amt neg">${fmt(-I.spent)}</div></div>
          <div class="row"><div class="grow">Available to spend</div><div class="amt ${cls(I.leftNow)}">${fmt(I.leftNow)}</div></div>
          <div class="row"><div class="grow"><div>Safe daily spending</div><div class="s">${I.daysLeft} days left in the month</div></div><div class="amt">${fmt(I.perDay)}</div></div>
          <div class="note">${I.usedHistory ? 'The projection uses your average spending from previous months.' : 'The projection assumes you keep spending at your current daily pace. It gets smarter after your first full month.'}
          ${I.endBalance < 0 ? ' <b>You are on track to spend more than you earn this month.</b>' : ''}</div></div>`;
      return openSheet('End of month', body);
    }

    if (which === 'assets' || which === 'networth') {
      const body = `
        <div class="card"><h2>Net worth</h2><div class="hero-num ${cls(netWorth())}">${fmt(netWorth())}</div>
          <div class="row"><div class="grow">Total assets</div><div class="amt pos">${fmt(assetsTotal())}</div></div>
          <div class="row"><div class="grow">Total debts</div><div class="amt neg">${fmt(-debtsTotal())}</div></div></div>
        <div class="card"><h2>Your assets &amp; debts</h2>${S.assets.length ? S.assets.map((a) => assetRow(a)).join('') : '<div class="empty">Nothing added yet</div>'}</div>
        <button class="btn" id="addMore">Add property / asset</button>
        <div class="card"><h2>Projection</h2>${projectionChart()}<div class="note">Based on saving ${fmt0(S.income - monthExpenses(I.key))} per month at the current pace.</div></div>`;
      return openSheet('Net worth', body, (sh) => {
        sh.querySelectorAll('[data-del-asset]').forEach((b) => (b.onclick = () => { S.assets = S.assets.filter((x) => x.id !== b.dataset.delAsset); save(); openDetail(which); }));
        $('#addMore', sh).onclick = () => { $('#sheet').classList.add('hidden'); editing = true; view = 'assets'; render(); };
      });
    }

    if (which === 'week') {
      const rows = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const items = S.tx.filter((t) => t.date === ymd(d));
        rows.push(`<div class="row"><div class="grow"><div class="t">${d.toLocaleString('en-US', { weekday: 'long' })}</div>
          <div class="s">${items.length ? items.map((t) => esc(t.name)).join(', ') : 'No spending'}</div></div>
          <div class="amt">${fmt(sum(items, (t) => t.amount))}</div></div>`);
      }
      return openSheet('Last 7 days', `<div class="card">${rows.join('')}</div>`);
    }

    if (which === 'tx') {
      const all = [...S.tx].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      return openSheet('Transactions', `<div class="card">${all.length ? all.map((t) => txRow(t).replace('</div></div></div>', `</div></div><button class="del" data-del-tx="${t.id}" aria-label="Delete">✕</button></div>`)).join('') : '<div class="empty">Nothing yet</div>'}</div>
        <button class="btn" id="addTx">Log a transaction</button>`, (sh) => {
        sh.querySelectorAll('[data-del-tx]').forEach((b) => (b.onclick = () => { S.tx = S.tx.filter((x) => x.id !== b.dataset.delTx); save(); openDetail('tx'); }));
        $('#addTx', sh).onclick = openTxForm;
      });
    }
  }

  function openTxForm() {
    closeDrawer();
    openSheet('New transaction', `
      <div class="card"><div class="form">
        <div><label for="tn">What was it?</label><input id="tn" placeholder="e.g. Coffee" autocomplete="off"></div>
        <div><label for="tc">Category</label><select id="tc">${catOpts('dining')}</select></div>
        <div><label for="ta">Amount</label><div class="money"><span>$</span><input id="ta" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>
        <div><label for="td">Date</label><input id="td" type="date" value="${ymd(new Date())}"></div>
      </div></div><button class="btn" id="saveTx">Save transaction</button>`, (sh) => {
      const saveTx = () => {
        const name = $('#tn', sh).value.trim() || CATS[$('#tc', sh).value].label, amount = num($('#ta', sh).value), date = $('#td', sh).value;
        if (!(amount > 0)) { $('#ta', sh).focus(); return toast('Enter an amount'); }
        if (!date) return toast('Pick a date');
        S.tx.push({ id: uid(), name, category: $('#tc', sh).value, amount, date }); save();
        closeSheet(); toast('Saved');
      };
      $('#saveTx', sh).onclick = saveTx;
      onEnter($('#ta', sh), saveTx);
      $('#tn', sh).focus();
    });
  }

  function confirmReset() {
    openSheet('Reset all data', `<div class="card"><p>This permanently deletes your income, bills, assets and transactions from this device.</p></div>
      <button class="btn danger" id="doReset">Delete everything</button><button class="btn ghost" id="noReset">Cancel</button>`, (sh) => {
      $('#noReset', sh).onclick = closeSheet;
      $('#doReset', sh).onclick = () => { S = blank(); save(); editing = false; view = 'income'; $('#sheet').classList.add('hidden'); render(); };
    });
  }

  /* ----- sample data (so the hub can be previewed) ----- */
  function loadDemo() {
    S = blank();
    S.income = 4800;
    S.bills = [
      ['Apartment rent', 'rent', 1450], ['Groceries budget', 'groceries', 520], ['Gas', 'gas', 160], ['Electric & water', 'utilities', 140],
      ['Car insurance', 'insurance', 118], ['Phone + internet', 'phone', 125], ['Streaming', 'subs', 32], ['Credit card payment', 'debt', 250],
    ].map(([name, category, amount]) => ({ id: uid(), name, category, amount }));
    S.assets = [
      ['Family home', 'property', 310000], ['Honda Accord', 'vehicle', 14500], ['Savings account', 'cash', 12800],
      ['401(k)', 'retire', 41200], ['Mortgage', 'mortgage', 224000], ['Visa card', 'card', 1800],
    ].map(([name, type, value]) => ({ id: uid(), name, type, value }));
    let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const base = { groceries: [45, 18], dining: [24, 12], gas: [38, 6], fun: [30, 15], health: [40, 20] };
    const now = new Date();
    for (let back = 1; back <= 3; back++) {
      const m = shiftMonth(now, -back);
      Object.entries(base).forEach(([cat, [avg, spread]]) => {
        for (let i = 0; i < 4; i++) {
          S.tx.push({ id: uid(), name: CATS[cat].label, category: cat, amount: Math.round(avg + (rnd() - 0.5) * 2 * spread), date: ymd(new Date(m.getFullYear(), m.getMonth(), 3 + i * 7)) });
        }
      });
    }
    const todayN = now.getDate();
    for (let i = 0; i < Math.min(todayN, 12); i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), Math.max(1, todayN - i));
      const cat = i % 3 === 0 ? 'dining' : i % 3 === 1 ? 'groceries' : 'gas';
      const boost = cat === 'dining' ? 2.6 : 1;
      S.tx.push({ id: uid(), name: cat === 'dining' ? ['Tacos', 'Sushi night', 'Brunch', 'Pizza'][i % 4] : CATS[cat].label, category: cat, amount: Math.round((base[cat][0] + rnd() * 10) * boost), date: ymd(d) });
    }
    save();
  }

  /* ---------- start ---------- */
  render();
})();
