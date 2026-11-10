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
  const SUPABASE_URL = 'https://ryrbydoazzahmwzdvfxv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_7W6YEkn06YbfiILq7K8FDQ_JZMNlfJ7'; // public "publishable" key; row-level security protects the data
  const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  /* ---------- state ---------- */
  const LEVERS = {
    sac: [['eat', 'Eating out less', 150], ['out', 'Going out less', 50], ['subs', 'Cancel unused subscriptions', 30], ['coffee', 'Coffee at home', 60],
      ['cook', 'Cook / meal prep more', 100], ['impulse', 'Fewer impulse buys', 75], ['plan', 'Cheaper phone / internet plan', 25]],
    ext: [['gig', 'Side gig', 400], ['ot', 'Overtime / extra shifts', 200], ['sell', 'Sell unused items', 100], ['free', 'Freelance work', 300], ['rent', 'Rent out a room / parking', 500]],
  };
  const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
  const blank = () => ({
    onboarded: false, income: 0, bills: [], assets: [], tx: [],
    pay: { freq: 'semi', day1: 1, day2: 15, anchor: null },      // when income arrives: half on the 1st, half on the 15th
    payV: 2,
    startBalance: 0, balanceDate: todayStr(), balanceSetAt: 0,     // cash on hand, and when it was entered
    budget: 0,                                                     // planned everyday (non-bill) spending per month
    lowLimit: 0,                                                   // warn when the projected balance drops below this
    goal: null,                                                    // { amount, date|null, created, base }
    levers: {
      sac: LEVERS.sac.map(([id, name, amount]) => ({ id, name, amount, on: false })),
      ext: LEVERS.ext.map(([id, name, amount]) => ({ id, name, amount, on: false })),
    },
  });
  let S = blank();
  let view = 'loading';
  let editing = false; // setup screens reached from the menu
  let user = null, recovering = false;
  let syncState = 'idle', lastSeen = null, saveTimer = null, dirty = false;
  let authMode = 'signin', authMsg = '', authBusy = false, authEmail = '';

  const cacheKey = () => `${KEY}.${user ? user.id : 'anon'}`;
  function readLocal(key) {
    try { const raw = localStorage.getItem(key); return raw ? Object.assign(blank(), JSON.parse(raw)) : null; }
    catch (e) { return null; }
  }
  const hasData = (d) => d && (d.onboarded || d.income || d.bills.length || d.assets.length || d.tx.length);

  /* Every change is cached locally, then saved to the signed-in account a moment later. */
  function save() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
    if (!sb || !user) return;
    dirty = true; setSync('saving');
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 500);
  }
  async function flush() {
    if (!sb || !user || !dirty) return;
    const stamp = new Date().toISOString();
    dirty = false;
    const { error } = await sb.from('finance_data').upsert({ user_id: user.id, data: S, updated_at: stamp });
    if (error) { dirty = true; setSync('offline'); return; }
    lastSeen = stamp;
    if (!dirty) setSync('saved');
  }
  const SYNC_LABEL = { idle: '', saving: '⏳ Saving…', saved: '✅ Synced', offline: '⚠️ Offline – will retry' };
  function setSync(st) { syncState = st; const el = $('#syncTag'); if (el) el.textContent = SYNC_LABEL[st]; }

  async function loadCloud() {
    const { data, error } = await sb.from('finance_data').select('data,updated_at').eq('user_id', user.id).maybeSingle();
    if (error) { // offline: fall back to this device's cached copy
      S = readLocal(cacheKey()) || blank(); setSync('offline'); dirty = hasData(S);
    } else if (data) {
      S = Object.assign(blank(), data.data); lastSeen = data.updated_at; setSync('saved');
      if (!data.data.balanceDate) save(); // older data: pin the starting-balance date so it doesn't drift
      if (data.data.payV !== 2) { S.pay = { freq: 'semi', day1: 1, day2: 15, anchor: null }; S.payV = 2; save(); } // one-time move to 1st + 15th paydays
    } else { // brand-new account: adopt data already on this device (from before accounts existed)
      const local = readLocal(cacheKey()) || readLocal(KEY);
      S = local || blank();
      if (hasData(S)) { dirty = true; await flush(); }
    }
    try { localStorage.setItem(cacheKey(), JSON.stringify(S)); } catch (e) { /* ignore */ }
    editing = false;
    view = recovering ? 'newpass' : (S.onboarded ? 'home' : 'income');
  }

  /* Pick up changes made on another device. */
  async function pull() {
    if (!sb || !user) return;
    if (dirty) return flush();
    if (view !== 'home' || !$('#sheet').classList.contains('hidden') || $('#drawer').classList.contains('open')) return;
    const { data, error } = await sb.from('finance_data').select('data,updated_at').eq('user_id', user.id).maybeSingle();
    if (error || !data || !lastSeen || Date.parse(data.updated_at) === Date.parse(lastSeen)) return;
    S = Object.assign(blank(), data.data); lastSeen = data.updated_at;
    try { localStorage.setItem(cacheKey(), JSON.stringify(S)); } catch (e) { /* ignore */ }
    setSync('saved'); render();
  }

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
    const remaining = S.budget > 0 ? S.budget * (1 - frac) : baseline !== null ? Math.max(0, baseline * (1 - frac)) : (spent / frac) * (1 - frac);
    const projectedVar = spent + remaining;
    const planned = S.income - bills;
    return {
      now, key, dim, frac, cats, bills, spent, planned,
      leftNow: planned - spent,
      projectedVar,
      endBalance: planned - projectedVar,
      usedHistory: prior.length > 0, usedBudget: S.budget > 0,
      daysLeft: dim - now.getDate(),
      perDay: Math.max(0, (planned - spent) / Math.max(1, dim - now.getDate())),
    };
  }

  /* ---------- paydays, due dates & the day-by-day balance ---------- */
  const today0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dnum = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  const dimOf = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const clampDay = (day, d) => Math.min(day, dimOf(d)); // a bill due on the 31st falls on the last day of shorter months
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const short$ = (v) => (v < 0 ? '-' : '') + '$' + mini(Math.abs(v));

  /* Income landing on a given day, from the pay schedule. */
  function incomeOn(d) {
    const p = S.pay || {}, inc = S.income || 0, day = d.getDate();
    if (!inc) return 0;
    if (p.freq === 'weekly' || p.freq === 'biweekly') {
      if (!p.anchor) return 0;
      const step = p.freq === 'weekly' ? 7 : 14, diff = dnum(d) - dnum(parseD(p.anchor));
      return ((diff % step) + step) % step === 0 ? (inc * 12) / (p.freq === 'weekly' ? 52 : 26) : 0;
    }
    if (p.freq === 'semi') return day === clampDay(p.day1 || 1, d) || day === clampDay(p.day2 || 15, d) ? inc / 2 : 0;
    return day === clampDay(p.day1 || 1, d) ? inc : 0;
  }
  const billsOn = (d) => S.bills.filter((b) => clampDay(b.dueDay || 1, d) === d.getDate());
  const leverMonthly = () => sum(S.levers.sac.filter((x) => x.on), (x) => x.amount) + sum(S.levers.ext.filter((x) => x.on), (x) => x.amount);

  /* End-of-day balance for every day from the starting-balance date to `end`.
     Past days use ONLY what really happened (paydays, bills on their due dates, spending you logged).
     Future days also subtract the planned everyday budget, spread evenly; with `withLevers`, the selected
     sacrifices and extra income are added on top. */
  function balances(end, withLevers) {
    const out = {};
    if (!S.balanceDate) return out;
    const byDay = {};
    S.tx.forEach((t) => { (byDay[t.date] = byDay[t.date] || []).push(t); });
    const t0 = today0(), lev = withLevers ? leverMonthly() : 0;
    let bal = S.startBalance || 0;
    for (let d = parseD(S.balanceDate); d <= end; d = addDays(d, 1)) {
      const k = ymd(d), first = k === S.balanceDate;
      if (!first) bal += incomeOn(d) - sum(billsOn(d), (b) => b.amount);
      // on the day the balance was entered, only count spending logged after it was entered
      bal -= sum((byDay[k] || []).filter((t) => !first || (t.created || 0) > (S.balanceSetAt || 0)), (t) => t.amount);
      if (d > t0) bal += (lev - (S.budget || 0)) / dimOf(d);
      out[k] = bal;
    }
    return out;
  }
  function currentBalance() {
    const t = today0(), b = balances(t, false)[ymd(t)];
    return b === undefined ? S.startBalance || 0 : b;
  }

  /* This month so far: what was really spent vs. what the plan said by today. */
  function planVsActual() {
    const t0 = today0(), key = mkey(t0), day = t0.getDate(), dim = dimOf(t0), tk = ymd(t0);
    const billsDue = sum(S.bills.filter((b) => clampDay(b.dueDay || 1, t0) <= day), (b) => b.amount);
    const logged = sum(S.tx.filter((t) => t.date.slice(0, 7) === key && t.date <= tk), (t) => t.amount);
    const budgetByNow = ((S.budget || 0) * day) / dim;
    return { day, dim, billsDue, logged, budgetByNow, actual: billsDue + logged, planned: billsDue + budgetByNow, diff: logged - budgetByNow };
  }

  /* When is the savings goal met? Walks the daily balance forward (up to 10 years). */
  function goalStatus() {
    const g = S.goal;
    if (!g || !(g.amount > 0)) return null;
    const t0 = today0(), end = addDays(t0, 3660), lev = leverMonthly();
    const plainSeries = balances(end, false), boostSeries = lev ? balances(end, true) : plainSeries;
    const reach = (series) => {
      for (let d = t0; d <= end; d = addDays(d, 1)) if (series[ymd(d)] - g.base >= g.amount - 0.005) return d;
      return null;
    };
    const now = plainSeries[ymd(t0)];
    const saved = (now === undefined ? S.startBalance || 0 : now) - g.base;
    const out = {
      g, lev, saved, pct: Math.max(0, Math.min(1, saved / g.amount)),
      plain: reach(plainSeries), boosted: reach(boostSeries), gain: 0,
      monthlyNet: S.income - billsTotal() - (S.budget || 0),
    };
    if (out.boosted) out.gain = boostSeries[ymd(out.boosted)] - plainSeries[ymd(out.boosted)];
    if (g.date && boostSeries[g.date] !== undefined) {
      out.onDate = boostSeries[g.date] - g.base;
      out.short = g.amount - out.onDate;
      out.needPerMonth = out.short > 0 ? out.short / Math.max(1, (dnum(parseD(g.date)) - dnum(t0)) / 30.44) : 0;
    }
    return out;
  }

  /* ---------- charts (inline SVG) ---------- */
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
    if (view === 'loading') return (app.innerHTML = '<div class="setup"><div class="lead"><h2>Loading…</h2></div></div>');
    if (view === 'auth') return renderAuth();
    if (view === 'newpass') return renderNewPass();
    if (view === 'home') return renderHome();
    return renderSetup();
  }

  /* ----- sign in / create account ----- */
  function renderAuth() {
    const up = authMode === 'signup';
    app.innerHTML = `
      <header class="topbar"><h1>Money Tracker</h1></header>
      <div class="setup">
        <div class="lead"><h2>${up ? 'Create your account' : 'Welcome back'}</h2>
          <p>${up ? 'Your information is saved to your account and syncs on every device.' : 'Sign in to see your finances on any device.'}</p></div>
        <form class="card form" id="authForm" novalidate>
          <div><label for="em">Email</label><input id="em" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(authEmail)}"></div>
          <div><label for="pw">Password</label><input id="pw" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" placeholder="${up ? 'At least 6 characters' : 'Your password'}"></div>
          ${authMsg ? `<div class="note" role="alert">${esc(authMsg)}</div>` : ''}
          <button class="btn" type="submit" ${authBusy ? 'disabled' : ''}>${authBusy ? 'Please wait…' : up ? 'Create account' : 'Sign in'}</button>
        </form>
        <button class="link" id="swap">${up ? 'I already have an account — sign in' : 'New here? Create an account'}</button>
        ${up ? '' : '<button class="link" id="forgot">Forgot password?</button>'}
      </div>`;
    const em = $('#em'), pw = $('#pw');
    em.addEventListener('input', () => { authEmail = em.value; });
    $('#swap').onclick = () => { authMode = up ? 'signin' : 'signup'; authMsg = ''; renderAuth(); };
    const forgot = $('#forgot');
    if (forgot) forgot.onclick = async () => {
      if (!em.value.trim()) { authMsg = 'Type your email above first, then tap “Forgot password?”.'; return renderAuth(); }
      const { error } = await sb.auth.resetPasswordForEmail(em.value.trim(), { redirectTo: location.origin + location.pathname });
      authMsg = error ? error.message : 'Check your email for a link to reset your password.'; renderAuth();
    };
    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = em.value.trim(), password = pw.value;
      if (!email || !password) { authMsg = 'Enter your email and password.'; return renderAuth(); }
      if (!sb) { authMsg = 'Could not load the sign-in service. Check your connection and reload.'; return renderAuth(); }
      authBusy = true; authMsg = ''; renderAuth();
      const res = up
        ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
        : await sb.auth.signInWithPassword({ email, password });
      authBusy = false;
      if (res.error) { authMsg = res.error.message; return renderAuth(); }
      if (res.data.session) return onSession(res.data.session);
      authMode = 'signin'; authMsg = 'Account created. Check your email and tap the confirmation link, then sign in.'; renderAuth();
    });
    (em.value ? pw : em).focus();
  }

  function renderNewPass() {
    app.innerHTML = `<header class="topbar"><h1>New password</h1></header>
      <div class="setup"><form class="card form" id="npForm" novalidate>
        <div><label for="np">Choose a new password</label><input id="np" type="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
        ${authMsg ? `<div class="note" role="alert">${esc(authMsg)}</div>` : ''}
        <button class="btn" type="submit">Save password</button></form></div>`;
    $('#npForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: $('#np').value });
      if (error) { authMsg = error.message; return renderNewPass(); }
      recovering = false; authMsg = ''; view = S.onboarded ? 'home' : 'income'; render(); toast('Password updated');
    });
  }

  async function onSession(session) {
    user = session.user; authMsg = '';
    await loadCloud(); render();
  }

  async function signOut() {
    try { localStorage.removeItem(cacheKey()); } catch (e) { /* ignore */ }
    clearTimeout(saveTimer); dirty = false;
    await sb.auth.signOut();
    user = null; S = blank(); lastSeen = null; authMode = 'signin'; authMsg = ''; view = 'auth'; render();
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
    const p = S.pay || {}, f = p.freq || 'semi';
    const dayOpts = (sel) => Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${ord(i + 1)}</option>`).join('');
    const freqs = [['semi', 'Twice a month (income split in half)'], ['monthly', 'Once a month'], ['biweekly', 'Every two weeks'], ['weekly', 'Every week']];
    return `
      <div class="lead"><h2>${editing ? 'Income, payday &amp; balance' : 'Let’s set up your money'}</h2>
        <p>${editing ? 'These numbers drive the calendar and your goal date.' : 'First, your household income and when it arrives.'}</p></div>
      <div class="card form">
        <div><label for="inc">Monthly income (after tax)</label>
          <div class="money"><span>$</span><input id="inc" inputmode="decimal" placeholder="0.00" value="${S.income || ''}" autocomplete="off"></div></div>
        <div><label for="pf">How often are you paid?</label>
          <select id="pf">${freqs.map(([k, l]) => `<option value="${k}"${k === f ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div id="pgDay1"><label for="pd1" id="pd1l">Payday (day of the month)</label><select id="pd1">${dayOpts(p.day1 || 1)}</select></div>
        <div id="pgDay2"><label for="pd2">Second payday</label><select id="pd2">${dayOpts(p.day2 || 15)}</select></div>
        <div id="pgAnchor"><label for="pa">Date of any one of your paydays</label><input id="pa" type="date" value="${p.anchor || ''}"></div>
      </div>
      <div class="card form">
        <div><label for="cash">Money you have right now (bank + cash)</label>
          <div class="money"><span>$</span><input id="cash" inputmode="decimal" placeholder="0.00" value="${S.balanceSetAt ? currentBalance().toFixed(2) : ''}" autocomplete="off"></div>
          <div class="muted sm hint">${S.balanceSetAt ? 'This is today’s balance by the app’s math. Change it if your bank says something different.' : 'The calendar counts forward from this number.'}</div></div>
        <div><label for="bud">Everyday spending budget per month (optional)</label>
          <div class="money"><span>$</span><input id="bud" inputmode="decimal" placeholder="0.00" value="${S.budget || ''}" autocomplete="off"></div>
          <div class="muted sm hint">What you plan to spend on things that aren’t bills. It is only ever used for “planned” numbers — never counted as actual spending.</div></div>
      </div>
      <button class="btn" id="next">${editing ? 'Save' : 'Next'}</button>
      ${editing ? '' : '<button class="link" id="demo">or try it with sample data</button>'}
      <p class="muted sm" style="text-align:center;margin:0">version 6</p>`;
  }

  function billsStep() {
    return `
      <div class="lead"><h2>Monthly recurring bills</h2><p>Add each bill — rent, groceries, gas and so on. Tap <b>+</b> after each one.</p></div>
      <div class="card formcard">
        <h2>New bill</h2><button class="plus" id="addBill" aria-label="Add bill">+</button>
        <div class="form">
          <div><label for="bd">When is expense/bill due?</label><input id="bd" type="date">
            <div class="muted sm hint">Pick its next due date — it repeats on that day every month.</div></div>
          <div><label for="bn">Name</label><input id="bn" placeholder="e.g. Apartment rent" autocomplete="off"></div>
          <div><label for="bc">Category</label><select id="bc">${catOpts('rent')}</select></div>
          <div><label for="ba">Monthly cost</label><div class="money"><span>$</span><input id="ba" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>
        </div>
      </div>
      <div class="card"><h2>Your bills</h2>${
        S.bills.length
          ? S.bills.map((b) => `<div class="row"><div class="badge" style="background:${CATS[b.category].color}22">${CATS[b.category].icon}</div>
              <div class="grow"><div class="t">${esc(b.name)}</div><div class="s">${CATS[b.category].label} · due
                <select class="inline-due" data-due="${b.id}" aria-label="Due day for ${esc(b.name)}"><option value="">not set</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${b.dueDay === i + 1 ? ' selected' : ''}>${ord(i + 1)}</option>`).join('')}</select></div></div>
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
      const inc = $('#inc'), pf = $('#pf');
      const showPay = () => {
        const f = pf.value, byDate = f === 'weekly' || f === 'biweekly';
        $('#pgDay1').classList.toggle('hidden', byDate);
        $('#pgDay2').classList.toggle('hidden', f !== 'semi');
        $('#pgAnchor').classList.toggle('hidden', !byDate);
        $('#pd1l').textContent = f === 'semi' ? 'First payday' : 'Payday (day of the month)';
      };
      pf.onchange = showPay; showPay();
      const next = () => {
        const v = num(inc.value), f = pf.value, cashRaw = $('#cash').value.trim(), bud = num($('#bud').value);
        if (!(v > 0)) { inc.focus(); return toast('Enter your monthly income'); }
        if ((f === 'weekly' || f === 'biweekly') && !$('#pa').value) { $('#pa').focus(); return toast('Pick the date of one of your paydays'); }
        if (cashRaw !== '' && isNaN(num(cashRaw))) { $('#cash').focus(); return toast('Enter the money you have as a number'); }
        const before = currentBalance();
        S.income = v;
        S.pay = { freq: f, day1: +$('#pd1').value, day2: +$('#pd2').value, anchor: $('#pa').value || null };
        S.budget = bud > 0 ? bud : 0;
        if (cashRaw !== '') {
          const c = num(cashRaw);
          if (!S.balanceSetAt || Math.abs(c - before) > 0.005) {
            if (S.goal) S.goal.base += c - before; // correcting the balance is not "saving"
            S.startBalance = c; S.balanceDate = todayStr(); S.balanceSetAt = Date.now();
          }
        }
        save();
        editing ? finishEdit() : go('bills');
      };
      $('#next').onclick = next;
      ['#inc', '#cash', '#bud'].forEach((q) => onEnter($(q), next));
      const demo = $('#demo'); if (demo) demo.onclick = () => { loadDemo(); finishSetup(); };
    }

    if (view === 'bills') {
      const add = () => {
        const name = $('#bn').value.trim(), amount = num($('#ba').value);
        if (!name) { $('#bn').focus(); return toast('Give the bill a name'); }
        if (!(amount > 0)) { $('#ba').focus(); return toast('Enter the monthly cost'); }
        const due = $('#bd').value;
        S.bills.push({ id: uid(), name, category: $('#bc').value, amount, dueDay: due ? parseD(due).getDate() : null }); save();
        const cat = $('#bc').value; render(); $('#bc').value = cat; $('#bn').focus();
      };
      $('#addBill').onclick = add;
      app.querySelectorAll('[data-due]').forEach((sel) => (sel.onchange = () => {
        const b = S.bills.find((x) => x.id === sel.dataset.due); if (b) { b.dueDay = sel.value ? +sel.value : null; save(); }
      }));
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
  function summaryCard() {
    const P = planVsActual(), t0 = today0();
    const mon = t0.toLocaleString('en-US', { month: 'short' });
    const verdict = !S.budget
      ? 'Add an everyday-spending budget (menu → Income, payday &amp; balance) to compare your logged spending against a plan.'
      : Math.abs(P.diff) < 0.005 ? 'Right on plan so far.'
      : P.diff > 0 ? `⚠️ <b>${fmt(P.diff)} over</b> plan so far this month.` : `✅ <b>${fmt(-P.diff)} under</b> plan so far this month.`;
    return `<div class="cols">
      <div><div class="mo">Actually spent</div><div class="sum-num neg">${fmt(P.actual)}</div>
        <div class="kv"><div><span>Bills paid</span><span>${fmt(P.billsDue)}</span></div>
        <div><span>Spending you logged</span><span>${fmt(P.logged)}</span></div></div></div>
      <div><div class="mo">Planned by ${mon} ${P.day}</div><div class="sum-num">${fmt(P.planned)}</div>
        <div class="kv"><div><span>Bills due</span><span>${fmt(P.billsDue)}</span></div>
        <div><span>Everyday budget</span><span>${fmt(P.budgetByNow)}</span></div></div></div>
    </div><div class="note">${verdict}</div>`;
  }

  function paramsCard() {
    const G = goalStatus();
    if (!G) return '<div class="empty">No goal yet — tap to set one, e.g. “Save $5,000”.</div>';
    const g = G.g, levers = [...S.levers.sac, ...S.levers.ext].filter((x) => x.on);
    return `<div class="big">Save <b>${fmt0(g.amount)}</b>${g.date ? ` by <b>${fmtDate(parseD(g.date))}</b>` : ''}</div>
      <div class="bar tall"><i style="width:${Math.max(2, G.pct * 100)}%;background:var(--green)"></i></div>
      <div class="muted sm" style="text-align:center;margin-top:4px">${fmt(Math.max(0, G.saved))} saved so far (${Math.round(G.pct * 100)}%)</div>
      ${goalVerdict(G)}
      ${levers.length ? `<div class="chips" style="margin-top:10px">${levers.map((x) => `<span class="chip on">${esc(x.name)} +${fmt0(x.amount)}</span>`).join('')}</div>` : ''}`;
  }

  /* The answer the Parameters section exists for: when are the conditions met? */
  function goalVerdict(G) {
    const g = G.g, lines = [];
    if (G.saved >= g.amount - 0.005) return '<div class="note">🎉 <b>Goal reached!</b></div>';
    const when = (d) => (d ? `<b>${fmtDate(d)}</b>` : '<b>not within 10 years</b>');
    if (G.lev) {
      lines.push(`With your selected changes (+${fmt0(G.lev)}/mo) you reach it on ${when(G.boosted)}.`);
      if (G.boosted && G.plain && ymd(G.boosted) === ymd(G.plain)) lines.push(`That’s the same day as without them (your balance jumps on paydays), but you’d have about ${fmt0(G.gain)} more by then.`);
      else lines.push(`Without them: ${when(G.plain)}.`);
    } else {
      lines.push(`At your current plan you reach it on ${when(G.plain)}.`);
    }
    if (!G.boosted && G.monthlyNet + G.lev <= 0) lines.push(`Your plan spends ${fmt0(-(G.monthlyNet + G.lev))} more than it brings in each month, so the balance never grows.`);
    if (g.date) {
      if (G.onDate === undefined) lines.push('The target date is outside the range that can be projected.');
      else if (G.short <= 0.005) lines.push(`✅ On track: about ${fmt0(G.onDate)} saved by ${fmtDate(parseD(g.date))}.`);
      else lines.push(`⚠️ On ${fmtDate(parseD(g.date))} you’d be <b>${fmt0(G.short)} short</b> — about ${fmt0(G.needPerMonth)} more per month would close the gap.`);
    }
    return `<div class="note">${lines.join('<br>')}</div>`;
  }

  /* ----- calendar ----- */
  let calMonth = null;
  function drawCalendar() {
    const host = $('#calCard'); if (!host) return;
    if (!calMonth) calMonth = new Date(today0().getFullYear(), today0().getMonth(), 1);
    const dim = dimOf(calMonth), lead = calMonth.getDay(), tk = ymd(today0());
    const bal = balances(new Date(calMonth.getFullYear(), calMonth.getMonth(), dim), false);
    let cells = '<i></i>'.repeat(lead);
    for (let day = 1; day <= dim; day++) {
      const d = new Date(calMonth.getFullYear(), calMonth.getMonth(), day), k = ymd(d);
      const hasTx = S.tx.some((t) => t.date === k), b = bal[k];
      cells += `<button class="cal-d${k === tk ? ' today' : ''}" data-day="${k}" aria-label="${fmtDate(d)}">
        <span class="n">${day}</span>
        <span class="dots">${incomeOn(d) ? '<i class="g"></i>' : ''}${billsOn(d).length ? '<i class="r"></i>' : ''}${hasTx ? '<i class="b"></i>' : ''}</span>
        ${b !== undefined ? `<span class="bal${b < (S.lowLimit || 0) ? ' neg' : ''}">${short$(b)}</span>` : ''}</button>`;
    }
    host.innerHTML = `<h2>Calendar</h2>
      <div class="cal-head"><button class="cal-nav" id="calPrev" aria-label="Previous month">‹</button><b>${monthName(calMonth)}</b><button class="cal-nav" id="calNext" aria-label="Next month">›</button></div>
      <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span class="cal-dow">${x}</span>`).join('')}${cells}</div>
      <div class="legend"><span><i class="g"></i>Payday</span><span><i class="r"></i>Bill due</span><span><i class="b"></i>Spending logged</span></div>
      <div class="muted sm" style="text-align:center;margin-top:6px">The number on each day is the money you’d have at the end of it. Tap a day to see its bills or log what you spent.</div>`;
    $('#calPrev').onclick = () => { calMonth = shiftMonth(calMonth, -1); drawCalendar(); };
    $('#calNext').onclick = () => { calMonth = shiftMonth(calMonth, 1); drawCalendar(); };
    host.querySelectorAll('[data-day]').forEach((el) => (el.onclick = () => openDay(el.dataset.day)));
  }

  function openDay(k) {
    const d = parseD(k), t0 = today0(), future = d > t0;
    const bal = balances(d, false)[k], inc = incomeOn(d), bills = billsOn(d);
    const tx = S.tx.filter((t) => t.date === k);
    const perDay = future && S.budget ? S.budget / dimOf(d) : 0;
    const body = `
      <div class="card"><h2>${future ? 'Projected balance' : 'Balance'} at end of day</h2>
        ${bal === undefined
          ? `<div class="empty">This day is before your starting balance was entered (${prettyDate(S.balanceDate)}), so there is no balance for it.</div>`
          : `<div class="hero-num ${bal < (S.lowLimit || 0) ? 'neg' : 'pos'}">${fmt(bal)}</div>
             ${perDay ? `<div class="muted sm" style="text-align:center">Includes your planned everyday budget (${fmt(perDay)} a day) for the days between now and then.</div>` : ''}`}
      </div>
      <div class="card"><h2>${future ? 'Scheduled' : 'What happened'}</h2>
        ${inc ? `<div class="row"><div class="badge" style="background:#dcf5e6">💵</div><div class="grow"><div class="t">Payday</div><div class="s">Income</div></div><div class="amt pos">+${fmt(inc)}</div></div>` : ''}
        ${bills.map((b) => `<div class="row"><div class="badge" style="background:${CATS[b.category].color}22">${CATS[b.category].icon}</div>
          <div class="grow"><div class="t">${esc(b.name)}</div><div class="s">Bill due${b.dueDay ? '' : ' (no due date set — assumed 1st)'}</div></div><div class="amt neg">${fmt(-b.amount)}</div></div>`).join('')}
        ${tx.map((t) => `<div class="row"><div class="badge" style="background:${CATS[t.category].color}22">${CATS[t.category].icon}</div>
          <div class="grow"><div class="t">${esc(t.name)}</div><div class="s">${future ? 'Planned one-off' : 'Spent'} · ${CATS[t.category].label}</div></div>
          <div class="amt neg">${fmt(-t.amount)}</div><button class="del" data-del-tx="${t.id}" aria-label="Delete">✕</button></div>`).join('')}
        ${!inc && !bills.length && !tx.length ? '<div class="empty">Nothing on this day</div>' : ''}
        ${tx.length ? `<div class="total"><span>${future ? 'Planned' : 'Spent'} this day</span><span class="neg">${fmt(sum(tx, (t) => t.amount))}</span></div>` : ''}
      </div>
      <div class="card formcard"><h2>${future ? 'Plan a one-off expense' : 'Log what you spent'}</h2>
        <div class="form">
          <div><label for="dn">On what?</label><input id="dn" placeholder="e.g. Lunch" autocomplete="off"></div>
          <div><label for="dc">Category</label><select id="dc">${catOpts('dining')}</select></div>
          <div><label for="da">How much?</label><div class="money"><span>$</span><input id="da" inputmode="decimal" placeholder="0.00" autocomplete="off"></div></div>
          <button class="btn" id="dAdd">${future ? 'Add planned expense' : 'Add spending'}</button>
        </div></div>
      <div class="card"><h2>Add from a picture</h2>
        <div class="muted sm" style="text-align:center;margin-bottom:10px">Take or choose a photo of a receipt, or a screenshot of your bank transactions. AI reads who was paid, how much and when, and you confirm before anything is added.</div>
        <input type="file" id="dPic" accept="image/*" class="hidden">
        <button class="btn ghost pic" id="dPicBtn">📷 Add a picture</button></div>`;
    openSheet(d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), body, (sh) => {
      const add = () => {
        const amount = num($('#da', sh).value), category = $('#dc', sh).value;
        if (!(amount > 0)) { $('#da', sh).focus(); return toast('Enter an amount'); }
        S.tx.push({ id: uid(), name: $('#dn', sh).value.trim() || CATS[category].label, category, amount, date: k, created: Date.now() });
        save(); openDay(k); toast('Added');
      };
      $('#dAdd', sh).onclick = add;
      $('#dPicBtn', sh).onclick = () => $('#dPic', sh).click();
      $('#dPic', sh).onchange = (e) => { const f = e.target.files[0]; if (f) scanPicture(f, k); };
      ['#dn', '#da'].forEach((q) => onEnter($(q, sh), add));
      sh.querySelectorAll('[data-del-tx]').forEach((b) => (b.onclick = () => { S.tx = S.tx.filter((x) => x.id !== b.dataset.delTx); save(); openDay(k); }));
    });
  }

  /* ----- read transactions from a picture (AI, through the read-transactions server function) ----- */
  function shrinkImage(file, maxEdge = 2576) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
      img.src = url;
    });
  }
  const SCAN_ERRORS = {
    not_configured: 'The picture reader isn’t switched on yet: it needs an Anthropic API key added to the Supabase project (Edge Functions → Secrets → ANTHROPIC_API_KEY).',
    bad_key: 'The Anthropic API key saved in Supabase was rejected. Check that it is correct and has credit.',
    daily_limit: 'You’ve reached today’s limit for reading pictures. Try again tomorrow, or type the expenses in.',
    busy: 'The AI service is busy right now. Wait a minute and try again.',
    image_too_large: 'That picture is too large to send. Try a tighter crop.',
    declined: 'The AI declined to read that picture.',
    too_many: 'There were too many transactions in that picture to read at once. Try a picture with fewer rows.',
    unreadable: 'The AI’s answer couldn’t be understood. Try again, or use a clearer picture.',
    not_signed_in: 'Your sign-in has expired. Sign out and back in, then try again.',
  };
  let scanRun = 0;
  async function scanPicture(file, k) {
    const run = ++scanRun;
    openSheet('Reading your picture…', '<div class="card"><div class="empty">🔎 Looking for payments in your picture.<br>This can take up to a minute — keep this open.</div></div>');
    $('#sx').onclick = () => { scanRun++; openDay(k); };
    const fail = (msg) => { if (run === scanRun) openSheet('Couldn’t read the picture', `<div class="card"><p>${esc(msg)}</p></div><button class="btn" id="scBack">Back to the day</button>`, (sh) => { $('#scBack', sh).onclick = () => openDay(k); $('#sx').onclick = () => openDay(k); }); };
    let image;
    try { image = await shrinkImage(file); } catch (e) { return fail('That file couldn’t be opened as a picture.'); }
    let res;
    try { res = await sb.functions.invoke('read-transactions', { body: { image, media_type: 'image/jpeg', day: k, today: todayStr() } }); }
    catch (e) { return fail('Couldn’t reach the picture reader. Check your connection and try again.'); }
    if (res.error) {
      let code = '';
      try { code = (await res.error.context.json()).error; } catch (e) { /* no JSON body */ }
      return fail(SCAN_ERRORS[code] || 'Something went wrong reading the picture. Please try again.');
    }
    if (run !== scanRun) return; // cancelled while waiting
    reviewScan(k, (res.data && res.data.transactions) || []);
  }

  /* Nothing is added until the person confirms: every row can be unticked or corrected first. */
  function reviewScan(k, found) {
    const back = (sh) => { $('#sx').onclick = () => openDay(k); const b = $('#scBack', sh); if (b) b.onclick = () => openDay(k); };
    if (!found.length) {
      return openSheet('Nothing found', '<div class="card"><div class="empty">No payments could be read from that picture. Try a clearer or closer photo.</div></div><button class="btn" id="scBack">Back to the day</button>', back);
    }
    const exists = (t) => S.tx.some((x) => x.date === t.date && Math.abs(x.amount - t.amount) < 0.005 && x.name.toLowerCase() === t.merchant.toLowerCase());
    const items = found.map((t) => { const it = { merchant: t.merchant, amount: t.amount, date: t.date || k, category: CATS[t.category] ? t.category : 'other', dated: !!t.date }; it.dup = exists(it); return it; });
    const body = `
      <div class="card"><h2>Found ${items.length} payment${items.length > 1 ? 's' : ''}</h2>
        <div class="muted sm" style="text-align:center">Check each one, fix anything the AI misread, then add them. Payments go on the date shown.</div>
        ${items.map((t, i) => `<div class="scan" data-i="${i}">
          <label class="scan-top"><input type="checkbox" data-f="on"${t.dup ? '' : ' checked'}><input data-f="merchant" value="${esc(t.merchant)}" aria-label="Paid to" autocomplete="off"></label>
          <div class="scan-row"><div class="money"><span>$</span><input data-f="amount" inputmode="decimal" value="${t.amount.toFixed(2)}" aria-label="Amount"></div>
            <input data-f="date" type="date" value="${t.date}" aria-label="Date"></div>
          <select data-f="category" aria-label="Category">${catOpts(t.category)}</select>
          ${t.dup ? '<div class="muted sm">Already on your calendar — left unticked.</div>' : t.dated ? '' : '<div class="muted sm">No date in the picture — using the day you opened.</div>'}
        </div>`).join('')}</div>
      <button class="btn" id="scAdd">Add to calendar</button><button class="btn ghost" id="scBack">Cancel</button>`;
    openSheet('Check what was found', body, (sh) => {
      back(sh);
      $('#scAdd', sh).onclick = () => {
        const add = [];
        for (const row of sh.querySelectorAll('.scan')) {
          const f = (n) => $(`[data-f="${n}"]`, row);
          if (!f('on').checked) continue;
          const amount = num(f('amount').value), date = f('date').value, category = f('category').value;
          if (!(amount > 0)) { f('amount').focus(); return toast('Fix the amount, or untick that row'); }
          if (!date) { f('date').focus(); return toast('Pick a date, or untick that row'); }
          add.push({ id: uid(), name: f('merchant').value.trim() || CATS[category].label, category, amount, date, created: Date.now() });
        }
        if (!add.length) return toast('Nothing ticked');
        S.tx.push(...add); save();
        const other = add.filter((t) => t.date !== k).length;
        openDay(k);
        toast(`Added ${add.length} expense${add.length > 1 ? 's' : ''}${other ? ` (${other} on other days)` : ''}`);
      };
    });
  }

  /* ----- parameters: goal, sacrifices, extra income ----- */
  const paramOpen = { sac: false, ext: false };
  function openParams() {
    const g = S.goal;
    const leverList = (kind) => S.levers[kind].map((x) => `<label class="lever"><input type="checkbox" data-lev="${kind}:${x.id}"${x.on ? ' checked' : ''}>
        <span class="grow">${esc(x.name)}</span><span class="muted">+$</span><input class="mini-amt" inputmode="decimal" data-amt="${kind}:${x.id}" value="${x.amount}" aria-label="Monthly amount for ${esc(x.name)}"><span class="muted sm">/mo</span></label>`).join('') +
      `<div class="lever add"><input class="grow" data-new-name="${kind}" placeholder="Add your own…" autocomplete="off"><span class="muted">+$</span><input class="mini-amt" inputmode="decimal" data-new-amt="${kind}" placeholder="0"><button class="chip" data-new="${kind}">Add</button></div>`;
    const body = `
      <div class="card form"><h2 style="text-align:left">Your parameter</h2>
        <div><label for="gt">What do you want to achieve?</label>
          <select id="gt"><option value="save"${g && !g.date ? ' selected' : ''}>Save an amount</option><option value="date"${g && g.date ? ' selected' : ''}>Save an amount by a date</option></select></div>
        <div><label for="ga">How much?</label><div class="money"><span>$</span><input id="ga" inputmode="decimal" placeholder="5000" value="${g ? g.amount : ''}" autocomplete="off"></div>
          <div class="chips" style="margin-top:8px">${[1000, 2500, 5000, 10000].map((v) => `<button class="chip" data-quick="${v}">Save ${fmt0(v)}</button>`).join('')}</div></div>
        <div id="gdWrap"><label for="gd">By what date?</label><input id="gd" type="date" value="${g && g.date ? g.date : ''}"></div>
        <div><label for="gl">Warn me if my balance would drop below (optional)</label><div class="money"><span>$</span><input id="gl" inputmode="decimal" placeholder="0" value="${S.lowLimit || ''}" autocomplete="off"></div>
          <div class="muted sm hint">Days under this amount show in red on the calendar.</div></div>
        <button class="btn" id="gSave">${g ? 'Update' : 'Set goal'}</button>
        ${g ? '<button class="btn ghost" id="gClear">Remove goal</button>' : ''}
      </div>
      <div id="goalResult"></div>
      <details class="drop" data-kind="sac"${paramOpen.sac || S.levers.sac.some((x) => x.on) ? ' open' : ''}><summary>Sacrifices <span class="muted sm">(optional)</span></summary>
        <div class="muted sm">Ways to spend less. Tick the ones you’d commit to — each adds to what you save every month.</div>${leverList('sac')}</details>
      <details class="drop" data-kind="ext"${paramOpen.ext || S.levers.ext.some((x) => x.on) ? ' open' : ''}><summary>Extra income <span class="muted sm">(optional)</span></summary>
        <div class="muted sm">Things that could add to your monthly income.</div>${leverList('ext')}</details>`;
    openSheet('Parameters', body, (sh) => {
      const find = (ref) => { const [kind, id] = ref.split(':'); return S.levers[kind].find((x) => x.id === id); };
      const result = () => {
        const G = goalStatus();
        $('#goalResult', sh).innerHTML = G
          ? `<div class="card"><h2>When you’ll get there</h2><div class="bar tall"><i style="width:${Math.max(2, G.pct * 100)}%;background:var(--green)"></i></div>
              <div class="muted sm" style="text-align:center;margin-top:4px">${fmt(Math.max(0, G.saved))} of ${fmt0(G.g.amount)} saved since ${prettyDate(G.g.created)}</div>${goalVerdict(G)}
              <div class="muted sm" style="margin-top:8px">Worked out day by day from your paydays, each bill’s due date, your everyday budget and what you’ve actually logged.</div></div>`
          : '<div class="card"><div class="empty">Set an amount above to see when you’ll reach it.</div></div>';
      };
      const gt = $('#gt', sh), showDate = () => $('#gdWrap', sh).classList.toggle('hidden', gt.value !== 'date');
      gt.onchange = showDate; showDate(); result();
      sh.querySelectorAll('[data-quick]').forEach((b) => (b.onclick = () => { $('#ga', sh).value = b.dataset.quick; }));
      const saveGoal = () => {
        const amount = num($('#ga', sh).value), byDate = gt.value === 'date', date = $('#gd', sh).value, low = num($('#gl', sh).value);
        if (!(amount > 0)) { $('#ga', sh).focus(); return toast('Enter how much you want to save'); }
        if (byDate && !date) { $('#gd', sh).focus(); return toast('Pick the date'); }
        if (byDate && date <= todayStr()) { $('#gd', sh).focus(); return toast('Pick a date in the future'); }
        S.lowLimit = low > 0 ? low : 0;
        S.goal = { amount, date: byDate ? date : null, created: S.goal ? S.goal.created : todayStr(), base: S.goal ? S.goal.base : currentBalance() };
        save(); openParams(); toast('Goal saved');
      };
      $('#gSave', sh).onclick = saveGoal;
      ['#ga', '#gl'].forEach((q) => onEnter($(q, sh), saveGoal));
      const clear = $('#gClear', sh); if (clear) clear.onclick = () => { S.goal = null; save(); openParams(); };
      sh.querySelectorAll('details.drop').forEach((el) => el.addEventListener('toggle', () => { paramOpen[el.dataset.kind] = el.open; }));
      sh.querySelectorAll('[data-lev]').forEach((c) => (c.onchange = () => { find(c.dataset.lev).on = c.checked; save(); result(); }));
      sh.querySelectorAll('[data-amt]').forEach((i) => (i.oninput = () => { const v = num(i.value); find(i.dataset.amt).amount = v > 0 ? v : 0; save(); result(); }));
      sh.querySelectorAll('[data-new]').forEach((b) => (b.onclick = () => {
        const kind = b.dataset.new, name = $(`[data-new-name="${kind}"]`, sh).value.trim(), amount = num($(`[data-new-amt="${kind}"]`, sh).value);
        if (!name) return toast('Give it a name');
        if (!(amount > 0)) return toast('Enter a monthly amount');
        S.levers[kind].push({ id: uid(), name, amount, on: true }); paramOpen[kind] = true; save(); openParams();
      }));
    });
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
        <section class="card tap full" data-open="summary"><h2>Summary — ${monthName(now)} so far</h2>
          ${summaryCard()}</section>

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

        <section class="card tap wide" data-open="params"><h2>Parameters</h2>${paramsCard()}</section>

        <section class="card full" id="calCard"></section>

        <section class="card tap full" data-open="tx"><h2>Transactions</h2>
          ${recent.length ? recent.map(txRow).join('') : '<div class="empty">No transactions yet — tap + to log spending</div>'}</section>
      </div>
      <button class="fab" id="fab" aria-label="Add transaction">+</button>`;

    $('#burger').onclick = openDrawer;
    $('#refresh').onclick = async () => { await pull(); render(); toast('Updated'); };
    $('#fab').onclick = openTxForm;
    app.querySelectorAll('[data-open]').forEach((el) => (el.onclick = () => openDetail(el.dataset.open)));
    drawCalendar();
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
      <div class="head"><b>Money Tracker</b><span>${esc(user ? user.email : '')}</span><br><span id="syncTag">${SYNC_LABEL[syncState]}</span></div>
      <button class="item" data-go="home">🏠 Home</button><hr>
      <button class="item" data-go="income">💵 Income, payday &amp; balance</button>
      <button class="item" data-go="bills">🧾 Add / edit monthly bills</button>
      <button class="item" data-go="assets">🏡 Add property &amp; assets</button>
      <button class="item" data-go="params">🎯 Parameters &amp; goal</button>
      <button class="item" data-go="tx">➕ Log a transaction</button>
      <button class="item" data-go="alltx">📜 All transactions</button><hr>
      <button class="item" data-go="reset">🗑️ Reset all data</button>
      <button class="item" data-go="signout">🚪 Sign out</button>`;
    $('#drawer').classList.add('open'); $('#scrim').classList.remove('hidden');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawer').querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => {
      const g = b.dataset.go; closeDrawer();
      if (g === 'home') return;
      if (g === 'tx') return openTxForm();
      if (g === 'params') return openParams();
      if (g === 'alltx') return openDetail('tx');
      if (g === 'reset') return confirmReset();
      if (g === 'signout') return signOut();
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
  function closeSheet() { const y = window.scrollY; $('#sheet').classList.add('hidden'); render(); window.scrollTo(0, y); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#sheet').classList.contains('hidden')) closeSheet(); else closeDrawer(); } });

  function openDetail(which) {
    if (which === 'params') return openParams();
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
          <div class="note">${I.usedBudget ? 'The projection uses your everyday-spending budget for the rest of the month.' : I.usedHistory ? 'The projection uses your average spending from previous months.' : 'The projection assumes you keep spending at your current daily pace. It gets smarter after your first full month.'}
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
        S.tx.push({ id: uid(), name, category: $('#tc', sh).value, amount, date, created: Date.now() }); save();
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
    ].map(([name, category, amount], i) => ({ id: uid(), name, category, amount, dueDay: [1, 5, 12, 18, 20, 22, 25, 28][i] }));
    S.pay = { freq: 'semi', day1: 1, day2: 15, anchor: null };
    S.startBalance = 3200; S.balanceDate = todayStr(); S.balanceSetAt = 1;
    S.budget = 900;
    S.goal = { amount: 5000, date: null, created: todayStr(), base: 3200 };
    S.levers.sac[0].on = true;
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
  async function boot() {
    render();
    if (!sb) { view = 'auth'; authMsg = 'Could not load the sign-in service. Check your connection and reload.'; return render(); }
    sb.auth.onAuthStateChange((ev) => {
      if (ev === 'PASSWORD_RECOVERY') { recovering = true; setTimeout(() => { if (user) { view = 'newpass'; render(); } }, 0); }
    });
    const { data } = await sb.auth.getSession();
    if (data.session) await onSession(data.session); else { view = 'auth'; render(); }
    setInterval(pull, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
  }
  boot();
})();
