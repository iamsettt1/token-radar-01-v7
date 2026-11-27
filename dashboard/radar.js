// Launch Radar — the board page. Renders window.RADAR (the rows, written by main.ts beside
// this page as ../data.js) and window.RADAR_MODEL (the fitted model's evidence, written by
// main.ts into this folder as evidence.js) with no network: KPI evidence tiles, the full
// protocol accounting, self-check chips recomputed in this page, the out-of-sample evidence
// tables, a sortable/filterable ranked board whose farm verdicts re-price live under the
// scenario controls, an expandable farm plan per row, and a detail view per protocol.
//
// Deep links (hash routing, combinable, e.g. #q=lend&cat=Lending or #p=some-slug):
//   #p=<slug>    open that protocol's detail view
//   #q=<text>    set the search box (matches name, category and chains)
//   #cat=<name>  set the category filter
//   #w=1         watchlist segment only
// Sorting is a click on a column header and is deliberately not part of the link.

const DATA = window.RADAR;
const M = window.RADAR_MODEL;
const rows = DATA.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const $ = (id) => document.getElementById(id);

const money = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const moneyFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const money0 = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const pct = (x) => (x === null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`);
const pctClass = (x) => (x === null ? 'flat' : x > 0.5 ? 'up' : x < -0.5 ? 'down' : 'flat');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ageText = (y) => (y >= 1 ? `${y.toFixed(1)} yr` : `${Math.max(1, Math.round(y * 365.25))} d`);
const chainCell = (chains) => (chains.length <= 1 ? (chains[0] ?? '—') : `${chains[0]} +${chains.length - 1}`);

// FNV-1a, the same hash main.ts prints in its summary: the chips below recompute it here.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- scenario & per-row economics

const scen = { depMode: 'pct', dropShare: M.scenario.drop_share, horizon: M.scenario.horizon_weeks, tier: '', seg: '' };
const DEFAULTS = { ...scen };

function rowMinutes(r) {
  const weekly = r.plan.find((s) => s.when.startsWith('Weekly'));
  const weeklyTotal = weekly ? weekly.minutes : 0;
  return { fixed: r.plan.reduce((s, x) => s + x.minutes, 0) - weeklyTotal, perWeek: weeklyTotal / M.scenario.horizon_weeks };
}

// The same arithmetic main.ts prices with — deposit rule, pro-rata drop, the plan's own fees
// and hours — recomputed here so the scenario controls re-price every row in the page.
function econ(r) {
  const deposit = scen.depMode === 'pct' ? r.deposit_usd : Number(scen.depMode);
  const drop = (r.implied_value_usd * scen.dropShare * deposit) / Math.max(1, r.tvl_usd);
  const mm = rowMinutes(r);
  const hours = (mm.fixed + mm.perWeek * scen.horizon) / 60;
  const net = drop - r.fees_usd;
  const perHour = net / Math.max(0.1, hours);
  const label = net < 0 ? 'SKIP' : perHour >= M.scenario.wage_line ? 'FARM' : 'THIN';
  return { deposit, drop, fees: r.fees_usd, hours, net, perHour, label };
}

const perHourText = (x) => `$${x >= 100 ? Math.round(x) : x.toFixed(2)}`;
function verdictClause(r, e) {
  const w = scen.horizon;
  if (e.label === 'FARM')
    return `the expected drop on a ${moneyFull(e.deposit)} plan is ${money(e.drop)} over ${w} weeks; after $${e.fees} of fees it nets ${money(e.net)}, about ${perHourText(e.perHour)} an hour of work — above the $${M.scenario.wage_line}/h line.`;
  if (e.label === 'THIN')
    return `the expected drop on a ${moneyFull(e.deposit)} plan is ${money(e.drop)}; after $${e.fees} of fees it nets ${money(e.net)}, about ${perHourText(e.perHour)} an hour — the plan pays for itself but does not beat the $${M.scenario.wage_line}/h line.`;
  return `the expected drop on a ${moneyFull(e.deposit)} plan is ${money(e.drop)}, which does not cover the plan's $${e.fees} of fees (net ${money(e.net)}): at this size and these odds, farming it loses money.`;
}
const vClass = (label) => (label === 'FARM' ? 'v-farm' : label === 'THIN' ? 'v-warm' : 'v-watch');

// ---------------------------------------------------------------- header: KPIs, accounting, chips, evidence

function renderKpis() {
  const k = M.kpis;
  const tiles = [
    ['Out-of-sample miss, walk-forward', `×${k.wf_miss.toFixed(2)}`, `vs ×${k.flat_wf_miss.toFixed(2)} for a flat multiple · leave-one-out ×${k.loo_miss.toFixed(2)} · four tests printed below`],
    ['Is the printed range honest?', `${k.wf50}% · ${k.wf80}%`, 'of later-listed caps fall inside P25–P75 · P10–P90 (stated 50% · 80%)'],
    ['Token odds vs base rate, Brier', `${k.odds_wf_brier.toFixed(3)}`, `walk-forward, vs ${k.odds_base_wf.toFixed(3)} for the base rate · halves ${k.odds_h12_brier.toFixed(3)} · ${k.odds_h21_brier.toFixed(3)} · 10-fold ${k.odds_fold_brier.toFixed(3)}`],
    ['Terms that survived the four tests', `${k.value_kept} of ${k.value_terms} · ${k.odds_kept} of ${k.odds_terms}`, 'value model · odds model — a term needs three of four; the rest are shown below, not used'],
    ['Worth farming, this scenario', `<span id="kpi-farm">${k.farm} FARM</span>`, `<span id="kpi-farm-sub">${k.thin} thin, ${k.skip} skip — net of fees against the $${M.scenario.wage_line}/h line</span>`],
    ['Watchlist ranked', `${k.watchlist} / ${k.watchlist}`, `plus ${k.ranked - k.watchlist} more pre-token protocols the radar ranks below it`],
  ];
  $('kpis').innerHTML = tiles
    .map(([t, big, sub]) => `<div class="kpi"><p class="kpi-t">${t}</p><p class="kpi-big">${big}</p><p class="kpi-sub">${sub}</p></div>`)
    .join('');
  $('snapmeta').textContent = `DefiLlama snapshot ${M.as_of} · model ${M.name}, refitted by the program on the sealed snapshot`;
  $('asof').textContent = M.as_of;
  renderFreshness();
}

// The freshness strip: the sealed snapshot's own facts (date, protocol count,
// checksum — recomputed from the model evidence, never hand-typed twice) and
// the product's published refresh schedule: a re-scan and re-price every
// Monday 00:00 UTC, with a live countdown to the next one. The countdown is a
// schedule readout, not a data claim — the data stays sealed at M.as_of.
function nextRefresh(from) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0));
  const add = (8 - d.getUTCDay()) % 7 || 7; // days to the next Monday (never today)
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

function renderFreshness() {
  const sealed = $('fresh-sealed');
  if (sealed) sealed.textContent = `Snapshot sealed: ${M.as_of} · ${M.chips.ledger} protocols · checksum ${M.chips.checksum}`;
  const tick = () => {
    const now = new Date();
    const next = nextRefresh(now);
    const dateText = next.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const ms = next - now;
    const days = Math.floor(ms / 86400000);
    const hrs = Math.floor((ms % 86400000) / 3600000);
    const min = Math.floor((ms % 3600000) / 60000);
    const nextEl = $('fresh-next');
    if (nextEl) nextEl.innerHTML = `Next scheduled refresh: ${dateText} 00:00 UTC · <b id="fresh-cd">T-minus ${days}d ${hrs}h ${min}m</b>`;
  };
  tick();
  setInterval(tick, 60000);
}

const GROUP_COLORS = {
  'ranked-watchlist': '#3dff9e', 'ranked-early': '#2bb673', 'ranked-off-list': '#1d7a50',
  'token-priced': '#5b8dd9', 'token-recorded': '#3c5a80', 'out-exchange': '#8a6d3b',
  'out-bridge': '#7a5a1d', 'out-staking': '#5f4b8b', 'out-derivative': '#54677f',
};

function renderAccounting() {
  const total = M.accounting.reduce((s, a) => s + a.count, 0);
  const ranked = M.accounting.filter((a) => a.group.startsWith('ranked')).reduce((s, a) => s + a.count, 0);
  const token = M.accounting.filter((a) => a.group.startsWith('token')).reduce((s, a) => s + a.count, 0);
  $('acct-note').textContent = `all ${total} snapshot protocols in exactly one group: ${ranked} ranked as pre-token, ${token} already record a token, ${total - ranked - token} left out by the house list's own rules`;
  $('acct-bar').innerHTML = M.accounting
    .filter((a) => a.count > 0)
    .map((a) => `<span style="width:${(a.count / total) * 100}%;background:${GROUP_COLORS[a.group]}" title="${esc(a.label)}: ${a.count}"></span>`)
    .join('');
  $('acct-legend').innerHTML = M.accounting
    .map((a) => `<span class="acct-item"><i style="background:${GROUP_COLORS[a.group]}"></i>${esc(a.label)} <b>${a.count}</b></span>`)
    .join('');
}

function renderChips() {
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const sequential = byRank.every((r, i) => r.rank === i + 1);
  const neverRises = byRank.every((r, i) => i === 0 || r.implied_value_usd < byRank[i - 1].implied_value_usd);
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const checksum = fnv1a(byRank.map((r) => `${r.slug}:${r.rank}:${r.implied_value_usd}`).join('|'));
  const covered = rows.filter((r) => r.watchlist).length;
  const chip = (ok, text) => `<span class="chip${ok ? '' : ' bad'}">${ok ? '✓' : '✗'} ${text}</span>`;
  $('chips').innerHTML = [
    chip(rows.length === M.chips.rows, `this table = board.json: ${rows.length} of ${M.chips.rows} rows recomputed here`),
    chip(sequential && neverRises, `ranks 1–${rows.length} in order, values never rise`),
    chip(totalImplied === M.chips.total_implied, `totals equal: ${moneyFull(totalImplied)}`),
    chip(checksum === M.chips.checksum, `checksum ${checksum} = main.ts`),
    chip(covered === M.chips.watchlist_ranked, `watchlist ${covered}/${M.kpis.watchlist} ranked`),
    chip(M.accounting.reduce((s, a) => s + a.count, 0) === M.chips.ledger, `ledger ${M.chips.ledger}/${M.chips.ledger}`),
  ].join('');
}

// The evidence strip: the dense board's face carries the deck's proof — the
// whole ledger in one line, the self-checks recomputed here, the four tests.
function renderEvStrip() {
  const el = $('evstrip');
  if (!el) return;
  const sum = (f) => M.accounting.filter(f).reduce((s, a) => s + a.count, 0);
  const total = sum(() => true);
  const token = sum((a) => a.group.startsWith('token'));
  const ranked = sum((a) => a.group.startsWith('ranked'));
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const inOrder = byRank.every((r, i) => r.rank === i + 1 && (i === 0 || r.implied_value_usd < byRank[i - 1].implied_value_usd));
  const totImp = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const cks = fnv1a(byRank.map((r) => `${r.slug}:${r.rank}:${r.implied_value_usd}`).join('|'));
  const wl = rows.filter((r) => r.watchlist).length;
  const mark = (ok) => (ok ? '✓' : '✗');
  const v = M.value_final;
  const o = M.odds_final;
  const k = M.kpis;
  el.innerHTML =
    `<div><b>Ledger</b> — ${total} protocols, one group each: ${token} already record a token · ${total - token} pre-token → ${total - token - ranked} set aside → <b>${ranked} ranked</b> · verdicts FARM ${k.farm} / THIN ${k.thin} / SKIP ${k.skip}</div>` +
    `<div><b>Recomputed in this page</b> — ${mark(inOrder)} ranks 1–${rows.length} in order, values never rise · ${mark(cks === M.chips.checksum)} checksum ${cks} = main.ts · ${mark(totImp === M.chips.total_implied)} implied total ${moneyFull(totImp)} · ${mark(wl === M.chips.watchlist_ranked)} watchlist ${wl}/${k.watchlist} ranked</div>` +
    `<div><b>Held out, four ways</b> — value miss ×${v.h12.miss.toFixed(2)} / ×${v.h21.miss.toFixed(2)} / ×${v.loo.miss.toFixed(2)} / ×${v.wf.miss.toFixed(2)} (halves both ways · leave-one-out · walk-forward) · token-odds Brier ${o.h12.toFixed(3)} / ${o.h21.toFixed(3)} / ${o.fold.toFixed(3)} / ${o.wf.toFixed(3)}</div>`;
}

function renderEvidence() {
  $('ev-vn').textContent = M.value_fit_n;
  $('ev-on').textContent = M.odds_sample_n;
  const vChip = (v) => (v === 'kept' ? '<span class="keep">kept</span>' : v.includes('noise-level') ? '<span class="ctrl">noise-level gain, not admitted</span>' : v.startsWith('must') ? '<span class="ctrl">must not help</span>' : '<span class="drop">tested, not kept</span>');
  const vCell = (t) => `×${t.miss.toFixed(2)} · ${t.within2}%`;
  $('ev-value').innerHTML = M.value_stages
    .map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${vCell(s.tests.h12)}</td><td class="num">${vCell(s.tests.h21)}</td><td class="num">${vCell(s.tests.loo)}</td><td class="num">${vCell(s.tests.wf)}</td><td>${s.verdict === 'baseline' ? '<span class="drop">baseline</span>' : vChip(s.verdict)}</td></tr>`)
    .join('');
  $('ev-odds').innerHTML = M.odds_stages
    .map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.tests.h12.toFixed(3)}</td><td class="num">${s.tests.h21.toFixed(3)}</td><td class="num">${s.tests.fold.toFixed(3)}</td><td class="num">${s.tests.wf.toFixed(3)}</td><td>${s.verdict === 'baseline' ? '<span class="drop">baseline</span>' : vChip(s.verdict)}</td></tr>`)
    .join('');
  const h = M.honesty;
  $('ev-range').innerHTML = [
    ['inside P25–P75, stated 50%', '50%', `${h.loo50}%`, `${h.wf50}%`],
    ['inside P10–P90, stated 80%', '80%', `${h.loo80}%`, `${h.wf80}%`],
  ]
    .map((r) => `<tr><td>${r[0]}</td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td></tr>`)
    .join('');
  const coef = M.coefficients.map((c) => `${esc(c.term)} slope ${c.estimate.toFixed(3)} ± ${c.se.toFixed(3)}`).join(' · ');
  $('ev-fit').textContent =
    `Fitted on ${M.value_fit_n} priced comparables (walk-forward split at ${M.value_wf_cutoff}) and ${M.odds_sample_n} dated protocols (split at ${M.odds_wf_cutoff}). ` +
    (coef ? `Coefficients ± bootstrap s.e. (100 refits): ${coef}. ` : '') +
    `The range on each row is the value model's own leave-one-out residual band.`;
  $('reading').textContent = M.reading;
}

// ---------------------------------------------------------------- state from the hash

function readHash() {
  const out = { p: '', q: '', cat: '', w: false, dense: false };
  for (const part of location.hash.replace(/^#/, '').split('&')) {
    const [k, v] = part.split('=');
    if (v === undefined) continue;
    const val = decodeURIComponent(v);
    if (k === 'p') out.p = val;
    else if (k === 'q') out.q = val;
    else if (k === 'cat') out.cat = val;
    else if (k === 'w') out.w = val === '1';
    else if (k === 'dense') out.dense = val === '1';
  }
  return out;
}

// Dense board view (#dense=1): the ranked board alone on one tall frame — slim
// header, no evidence deck, compact rows — so a single view carries the whole
// watchlist and the ranked field beyond it. With #w=1 it shows the watchlist
// only: the filtered dense view.
const DENSE = readHash().dense;
if (DENSE) document.body.classList.add('dense');

function writeHash() {
  const parts = [];
  const q = $('q').value.trim();
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  if ($('cat').value) parts.push(`cat=${encodeURIComponent($('cat').value)}`);
  if (scen.seg === 'watchlist') parts.push('w=1');
  if (selected) parts.push(`p=${encodeURIComponent(selected)}`);
  if (DENSE) parts.push('dense=1');
  const next = `#${parts.join('&')}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

let sort = { key: 'rank', dir: 1 };
let selected = '';
let expanded = '';

function visible() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('cat').value;
  const chain = $('chain').value;
  let list = rows.filter(
    (r) =>
      (!scen.tier || econ(r).label === scen.tier) &&
      (!scen.seg || r.segment === scen.seg) &&
      (!cat || (r.category ?? '') === cat) &&
      (!chain || r.chains.includes(chain)) &&
      (!q || `${r.name} ${r.category ?? ''} ${r.chains.join(' ')}`.toLowerCase().includes(q)),
  );
  const k = sort.key;
  const val = (r) => (k === 'per_hour_usd' ? econ(r).perHour : r[k]);
  list.sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av === null || bv === null) return av === bv ? a.rank - b.rank : av === null ? 1 : -1;
    const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return (c !== 0 ? c : a.rank - b.rank) * sort.dir;
  });
  return list;
}

// ---------------------------------------------------------------- the board

function renderTabs() {
  const counts = { '': rows.length, FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) counts[econ(r).label]++;
  $('tabs').innerHTML = ['', 'FARM', 'THIN', 'SKIP']
    .map((t) => `<button type="button" role="tab" class="tab${scen.tier === t ? ' on' : ''}" data-tier="${t}">${t === '' ? 'All' : t} <b>${counts[t]}</b></button>`)
    .join('');
  const farmEl = $('kpi-farm');
  if (farmEl) {
    farmEl.textContent = `${counts.FARM} FARM`;
    $('kpi-farm-sub').textContent = `${counts.THIN} thin, ${counts.SKIP} skip — net of fees against the $${M.scenario.wage_line}/h line`;
  }
}

function planRow(r, e) {
  const steps = r.plan
    .map((s, i) => {
      let when = s.when;
      let minutes = s.minutes;
      if (s.when.startsWith('Weekly')) {
        when = `Weekly ×${scen.horizon}`;
        minutes = Math.round(rowMinutes(r).perWeek * scen.horizon);
      } else if (i === r.plan.length - 2) when = `Day ${scen.horizon * 7 - 14}`;
      else if (i === r.plan.length - 1) when = `Day ${scen.horizon * 7}`;
      return `<tr><td class="when">${esc(when)}</td><td>${esc(s.text)}</td><td class="num">${s.cost > 0 ? `$${s.cost.toFixed(2)}` : '—'}</td><td class="num">${minutes >= 60 ? `${(minutes / 60).toFixed(1)} h` : `${minutes} min`}</td></tr>`;
    })
    .join('');
  return `<tr class="planrow"><td colspan="11">
    <table class="plantable"><thead><tr><th>When</th><th>Step</th><th class="num">Cost</th><th class="num">Time</th></tr></thead><tbody>${steps}</tbody></table>
    <p class="plantotal">Expected drop ${money(e.drop)} (implied ${money(r.implied_value_usd)} × ${scen.dropShare * 100}% drop share × ${moneyFull(e.deposit)} of ${money(r.tvl_usd)} TVL) − fees $${e.fees} = <b>${money(e.net)} net</b> · ${e.hours.toFixed(1)} h of work · ${perHourText(e.perHour)}/h → <b>${e.label}</b> over ${scen.horizon} weeks.</p>
  </td></tr>`;
}

// The dense board: rows in rank order, compact single-line cells, section
// dividers at the watchlist line. With #w=1 the dense view is the watchlist
// alone — the same table under the segment filter.
function renderDenseBoard() {
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const watchOnly = readHash().w;
  const divider = (text, sub) => `<tr class="divider"><td colspan="11">${text} <span>${sub}</span></td></tr>`;
  const rowHtml = (r) => {
    const e = econ(r);
    const badges = [
      r.watchlist ? '<span class="wl">Watchlist</span>' : r.segment === 'off-list' ? '<span class="seg">Off-list</span>' : '<span class="seg">Early</span>',
      r.parent_name ? `<span class="seg parent">Parent-linked</span>` : '',
    ].join('');
    return `<tr data-slug="${esc(r.slug)}">
      <td class="rank">${r.rank}</td>
      <td class="name">${esc(r.name)} ${badges}<span class="sub2">${esc(r.category ?? '—')} · ${esc(chainCell(r.chains))}</span></td>
      <td class="num money">${money(r.tvl_usd)}</td>
      <td class="num"><span class="${pctClass(r.change_7d)}">${pct(r.change_7d)}</span></td>
      <td class="num">${ageText(r.age_years)}</td>
      <td class="num odds"><span class="obar"><i style="width:${r.odds_pct}%"></i></span>${r.odds_pct.toFixed(0)}%</td>
      <td class="num money">${money(r.value_if_launches_usd)}</td>
      <td class="num val">${money(r.implied_value_usd)}</td>
      <td><span class="tag ${vClass(e.label)}">${e.label}</span></td>
      <td class="num money">${perHourText(e.perHour)}</td>
      <td class="num">${r.plan.length} steps</td>
    </tr>`;
  };
  let html = '';
  let shown = 0;
  // The watchlist is a segment of its own — its 40 protocols sit anywhere in
  // the ranking (tonight: ranks 1 to 69) — so the dense board sections by
  // segment, not by rank band: the whole watchlist first, in rank order,
  // then the next forty ranked protocols beyond it.
  const wl = byRank.filter((r) => r.watchlist);
  if (watchOnly) {
    html += divider(`The watchlist — all ${wl.length}, in rank order`, '· filtered view: segment = watchlist, every other ranked protocol hidden');
    html += wl.map(rowHtml).join('');
    shown = wl.length;
  } else {
    const beyond = byRank.filter((r) => !r.watchlist).slice(0, 40);
    html += divider(`The watchlist — all ${wl.length}, in rank order`, '· every protocol on the house watchlist, priced and verdicted');
    html += wl.map(rowHtml).join('');
    html += divider(`Beyond the watchlist — ${beyond.length} more ranked protocols`, '· priced and verdicted below the line — the board does not stop at the watchlist');
    html += beyond.map(rowHtml).join('');
    shown = wl.length + beyond.length;
  }
  $('rows').innerHTML = html;
  const tvl = byRank.reduce((s, r) => s + r.tvl_usd, 0);
  const implied = byRank.reduce((s, r) => s + r.implied_value_usd, 0);
  $('count').textContent = `Dense board — ${shown} of ${rows.length} ranked protocols on one frame · ${money(tvl)} TVL · ${money(implied)} implied across all ${rows.length}`;
  document.querySelector('.foot').textContent =
    `Dense board view — ${shown} of ${rows.length} ranked protocols on one frame; the live page carries all ${rows.length} with filters, expandable farm plans and a detail view per protocol. Snapshot as of ${M.as_of} · values are this radar's own claim, derived only from the snapshot's figures — not a prediction that a token will be issued.`;
  renderTabs();
}

function renderBoard() {
  if (DENSE) return renderDenseBoard();
  const list = visible();
  const tvl = list.reduce((s, r) => s + r.tvl_usd, 0);
  const implied = list.reduce((s, r) => s + r.implied_value_usd, 0);
  $('count').textContent = `${list.length} of ${rows.length} rows · ${money(tvl)} TVL · ${money(implied)} implied`;
  $('rows').innerHTML = list
    .map((r) => {
      const e = econ(r);
      const badges = [
        r.watchlist ? '<span class="wl">Watchlist</span>' : r.segment === 'off-list' ? '<span class="seg">Off-list</span>' : '<span class="seg">Early</span>',
        r.parent_name ? `<span class="seg parent">Parent-linked</span>` : '',
      ].join('');
      const head = `<tr data-slug="${esc(r.slug)}"${r.slug === selected ? ' class="sel"' : ''}>
        <td class="rank">${r.rank}<div class="rrange">${r.rank_range[0]}–${r.rank_range[1]}</div></td>
        <td class="name">${esc(r.name)} ${badges}
          <div class="sub2">${esc(r.category ?? '—')} · ${esc(chainCell(r.chains))}</div>
        </td>
        <td class="num money">${money(r.tvl_usd)}</td>
        <td class="num"><span class="${pctClass(r.change_7d)}">${pct(r.change_7d)}</span></td>
        <td class="num">${ageText(r.age_years)}</td>
        <td class="num odds"><span class="obar"><i style="width:${r.odds_pct}%"></i></span>${r.odds_pct.toFixed(0)}%</td>
        <td class="num money">${money(r.value_if_launches_usd)}<div class="rrange">${money0(r.value_range_usd[0])}–${money0(r.value_range_usd[1])}</div></td>
        <td class="num val">${money(r.implied_value_usd)}</td>
        <td><span class="tag ${vClass(e.label)}">${e.label}</span><div class="rrange">${e.net >= 0 ? '+' : '−'}${money(Math.abs(e.net))} net</div></td>
        <td class="num money">${perHourText(e.perHour)}</td>
        <td><button class="farm" data-farm="${esc(r.slug)}">${r.plan.length} steps ${expanded === r.slug ? '▴' : '▾'}</button></td>
      </tr>`;
      return expanded === r.slug ? head + planRow(r, e) : head;
    })
    .join('');
  document.querySelectorAll('thead th[data-key]').forEach((th) => {
    th.classList.toggle('sorted', th.dataset.key === sort.key);
    th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.key === sort.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  });
  renderTabs();
}

// ---------------------------------------------------------------- the detail view

function whyLines(r, e) {
  const lines = [];
  lines.push(
    `Value if it launches <b>${money(r.value_if_launches_usd)}</b> — its TVL of <b>${money(r.tvl_usd)}</b> read through the fitted size curve and family effect. The model's own out-of-sample miss is ×${M.kpis.wf_miss.toFixed(2)} walk-forward, and its printed range is <b>${money(r.value_range_usd[0])}–${money(r.value_range_usd[1])}</b>.`,
  );
  lines.push(
    `Token odds <b>${r.odds_pct.toFixed(0)}%</b> — of the <b>${r.odds_den}</b> protocols like it (same category, TVL within a factor of three), <b>${r.odds_num}</b> already record a token; the fitted odds model prices its next 24 months at the figure shown${r.age_known ? '' : ' (no listing date is recorded, so it is read at the dated protocols’ median age)'}.`,
  );
  lines.push(
    `Implied value is the product: <b>${money(r.value_if_launches_usd)} × ${r.odds_pct.toFixed(0)}% = ${money(r.implied_value_usd)}</b>. Across 100 bootstrap refits of both models, its rank lands between <b>#${r.rank_range[0]}</b> and <b>#${r.rank_range[1]}</b> nine times in ten; it prints at #${r.rank}.`,
  );
  if (r.parent_name) {
    lines.push(
      `Parent-linked: <b>${esc(r.parent_name)}</b> already trades at ×${r.parent_multiple.toFixed(2)} of its TVL — the anchor a launch of this arm would be priced against.`,
    );
  }
  return lines;
}

function renderDetail(slug) {
  selected = slug;
  const box = $('detail');
  const r = bySlug.get(slug);
  if (!r) {
    box.innerHTML = '<p class="detail-empty">Select any row to see its figures, its verdict, its farm plan, and why the model ranks it there.</p>';
    renderBoard();
    return;
  }
  const e = econ(r);
  const segLabel = r.segment === 'watchlist' ? 'Watchlist' : r.segment === 'early' ? 'Early, at or above the floor' : 'Off-list, below the floor';
  box.innerHTML = `
    <p class="kicker">Rank ${r.rank} of ${rows.length} · ${segLabel}</p>
    <h2>${esc(r.name)}</h2>
    <p class="sub">${esc(r.category ?? 'Uncategorised')} · ${esc(r.chains.slice(0, 4).join(', '))}${r.chains.length > 4 ? ` +${r.chains.length - 4} more chains` : ''}</p>
    <dl class="figs">
      <div><dt>Implied value</dt><dd>${money(r.implied_value_usd)}</dd></div>
      <div><dt>If it launches</dt><dd>${money(r.value_if_launches_usd)}</dd></div>
      <div><dt>Printed range</dt><dd class="small">${money(r.value_range_usd[0])}–${money(r.value_range_usd[1])}</dd></div>
      <div><dt>Token odds, 24 mo</dt><dd>${r.odds_pct.toFixed(0)}%</dd></div>
      <div><dt>TVL</dt><dd>${money(r.tvl_usd)}</dd></div>
      <div><dt>No-token age</dt><dd>${ageText(r.age_years)}</dd></div>
      <div><dt>7-day change</dt><dd>${pct(r.change_7d)}</dd></div>
      <div><dt>Plan deposit</dt><dd>${moneyFull(e.deposit)}</dd></div>
    </dl>
    <div class="verdict ${vClass(e.label)}"><span class="vlabel">${e.label}</span>${esc(verdictClause(r, e))}</div>
    <h3>Farm plan — ${moneyFull(e.deposit)}, ${scen.horizon} weeks</h3>
    <ol class="dplan">
      ${r.plan
        .map((s, i) => {
          let when = s.when;
          let minutes = s.minutes;
          if (s.when.startsWith('Weekly')) {
            when = `Weekly ×${scen.horizon}`;
            minutes = Math.round(rowMinutes(r).perWeek * scen.horizon);
          } else if (i === r.plan.length - 2) when = `Day ${scen.horizon * 7 - 14}`;
          else if (i === r.plan.length - 1) when = `Day ${scen.horizon * 7}`;
          return `<li><p class="dp-head"><span class="when">${esc(when)}</span><span class="dp-meta">${s.cost > 0 ? `$${s.cost.toFixed(2)}` : 'no cost'} · ${minutes >= 60 ? `${(minutes / 60).toFixed(1)} h` : `${minutes} min`}</span></p><p class="dp-text">${esc(s.text)}</p></li>`;
        })
        .join('')}
    </ol>
    <p class="plantotal">Sizing, printed so it can be checked: expected drop ${money(e.drop)} (implied ${money(r.implied_value_usd)} × ${scen.dropShare * 100}% drop share × ${moneyFull(e.deposit)} of ${money(r.tvl_usd)} TVL) − fees $${e.fees} = <b>${money(e.net)} net</b> · ${e.hours.toFixed(1)} h of work · ${perHourText(e.perHour)}/h → <b>${e.label}</b> over ${scen.horizon} weeks.</p>
    <p class="odds">Launch record: <b>${r.odds_num} of ${r.odds_den}</b> protocols like this one — same category, TVL within a factor of three — already record a token.</p>
    <h3>Why the model ranks it here</h3>
    <ul class="why">${whyLines(r, e).map((l) => `<li>${l}</li>`).join('')}</ul>`;
  renderBoard();
}

// ---------------------------------------------------------------- exports

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportCsv() {
  const head = 'rank,name,category,tvl_usd,change_7d,age_years,odds_pct,value_if_launches_usd,implied_value_usd,verdict,net_usd,per_hour_usd';
  const lines = visible().map((r) => {
    const e = econ(r);
    return [r.rank, `"${r.name.replace(/"/g, '""')}"`, `"${(r.category ?? '').replace(/"/g, '""')}"`, r.tvl_usd, r.change_7d ?? '', r.age_years, r.odds_pct, r.value_if_launches_usd, r.implied_value_usd, e.label, e.net.toFixed(2), e.perHour.toFixed(2)].join(',');
  });
  download('launch-radar-board.csv', [head, ...lines].join('\n'), 'text/csv');
}

function exportJson() {
  download('launch-radar-board.json', JSON.stringify(visible(), null, 2), 'application/json');
}

// ---------------------------------------------------------------- wiring

function syncFromHash() {
  const h = readHash();
  $('q').value = h.q;
  $('cat').value = h.cat;
  scen.seg = h.w ? 'watchlist' : $('seg').value;
  if (h.w) $('seg').value = 'watchlist';
  renderDetail(h.p && bySlug.has(h.p) ? h.p : '');
}

function refresh() {
  writeHash();
  renderBoard();
  if (selected) renderDetail(selected);
}

function init() {
  const cats = [...new Set(rows.map((r) => r.category).filter((c) => c !== null))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
  $('dropbtns').innerHTML = [
    [0.035, '3.5%'],
    [0.075, '7.5%'],
    [0.15, '15%'],
  ]
    .map(([d, label]) => `<button type="button" data-drop="${d}" class="${scen.dropShare === d ? 'on' : ''}">${label}</button>`)
    .join('');
  $('horbtns').innerHTML = [13, 26, 52]
    .map((w) => `<button type="button" data-hor="${w}" class="${scen.horizon === w ? 'on' : ''}">${w} wk</button>`)
    .join('');
  renderKpis();
  renderAccounting();
  renderChips();
  renderEvStrip();
  renderEvidence();
  $('q').addEventListener('input', refresh);
  $('cat').addEventListener('change', refresh);
  $('chain').addEventListener('change', refresh);
  $('seg').addEventListener('change', () => {
    scen.seg = $('seg').value;
    refresh();
  });
  $('depmode').addEventListener('change', () => {
    scen.depMode = $('depmode').value;
    refresh();
  });
  $('dropbtns').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-drop]');
    if (!b) return;
    scen.dropShare = Number(b.dataset.drop);
    document.querySelectorAll('#dropbtns button').forEach((x) => x.classList.toggle('on', x === b));
    refresh();
  });
  $('horbtns').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-hor]');
    if (!b) return;
    scen.horizon = Number(b.dataset.hor);
    document.querySelectorAll('#horbtns button').forEach((x) => x.classList.toggle('on', x === b));
    refresh();
  });
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tier]');
    if (!b) return;
    scen.tier = b.dataset.tier;
    renderBoard();
  });
  $('reset').addEventListener('click', () => {
    Object.assign(scen, { ...DEFAULTS });
    $('q').value = '';
    $('cat').value = '';
    $('chain').value = '';
    $('seg').value = '';
    $('depmode').value = 'pct';
    document.querySelectorAll('#dropbtns button').forEach((x) => x.classList.toggle('on', Number(x.dataset.drop) === scen.dropShare));
    document.querySelectorAll('#horbtns button').forEach((x) => x.classList.toggle('on', Number(x.dataset.hor) === scen.horizon));
    refresh();
  });
  $('csv').addEventListener('click', exportCsv);
  $('json').addEventListener('click', exportJson);
  document.querySelectorAll('thead th[data-key]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sort.key === key) sort.dir *= -1;
      else sort = { key, dir: key === 'name' || key === 'category' ? 1 : -1 };
      if (key === 'rank') sort.dir = 1;
      renderBoard();
    });
  });
  $('rows').addEventListener('click', (e) => {
    const farmBtn = e.target.closest('button[data-farm]');
    if (farmBtn) {
      expanded = expanded === farmBtn.dataset.farm ? '' : farmBtn.dataset.farm;
      renderBoard();
      return;
    }
    const tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    renderDetail(tr.dataset.slug);
    writeHash();
  });
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();
  renderBoard();
}

init();
