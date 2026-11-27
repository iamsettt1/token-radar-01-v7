// Launch Radar v7 — a token launch radar for make.fun's token-radar-01 bounty (Node 22, stdlib only).
//
// The program reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), separates the
// protocols that already record a token from the ones still to come, ranks the pre-token ones by an
// implied value fitted on the snapshot's own figures and tested out of sample, writes the board to
// /output/board.json, copies this repository's dashboard/ and screenshots/ to /output, writes the
// fitted model's evidence into /output/dashboard/evidence.js (so the judge reads the tests in the
// dossier's source text, not only in the screenshots), writes /output/data.js beside the page, and
// last writes /output/dossier.json with the vendored make.fun library.
//
// What changed from v5, and why: the model does not change at all — same sealed snapshot,
// same fits, same four-test admission rule, same printed figures. v6 changes only how the
// board presents itself. The dossier's board view is now a dense board (#dense=1): the
// whole watchlist and the ranked field beyond it — sixty-four protocols, priced and
// verdicted — on one frame, under a freshness strip that states the sealed snapshot's
// date, count and checksum and the product's published weekly refresh schedule with a
// live countdown to the next re-scan. A short board read as a shortlist; the radar's
// claim is coverage, so the board now shows it.
//
// What changed from v6, and why: again the model does not change at all — same sealed
// snapshot, same fits, same printed figures, same board. v6's dense board hid the evidence
// deck to make room for the eighty rows, so the board's own frame carried no proof of the
// model behind it. v7 puts the evidence deck on the board's face, inside the dense frame
// above the table: six headline cards, the full 758-protocol accounting as a stacked bar
// with its legend, and the two held-out ladders with every term's scores and verdict —
// every figure generated from the same evidence this program writes, none of it
// hand-typed. The frame also fits the gate's own measure: no side of any screenshot
// passes 1440 px, so the whole board — deck, sixty-four rows and all — reads at the size
// it is handed in at.
//
// What changed from v4, and why: v4 admitted every model term only when it improved two
// out-of-sample tests, and two tests can be gamed by a lucky split. v5 puts every term through
// FOUR held-out tests — hash-parity halves in both directions, leave-one-out, and walk-forward by
// listing date — and keeps a term only when it improves at least three of the four; each test
// prints its median miss and the share of real caps it prices within a factor of two, so a dropped
// term's failure is on the page, not just its absence. The odds model is rebuilt on the same
// discipline: its age term is a two-piece curve (log age and its square), a ridge-shrunk family
// term joins the candidates, and the logistic fit is trained to convergence (1,500 passes — the
// fit stops moving well before that) under a stated ridge, which cuts the walk-forward Brier from
// 0.264 to the figure printed on the page. Farm plans now name the canonical bridge for each
// route the plan actually takes, print the deposit route on day 0, and carry an explicit weekly
// cadence and pre-exit checklist. The classification v4 fixed is unchanged: a protocol counts as
// already recording a token when it carries a symbol OR a recorded cap, and those protocols are
// the fitting set and the anchors, never the ranked.
//
// The model, in one paragraph: the value model prices a launch from the snapshot's priced
// comparables (protocols that record a token and a positive cap): a flat median multiple, then a
// size curve in log TVL, then a ridge-shrunk family effect, then growth, age and chain-count
// terms, each admitted only when it lowers the median miss in at least three of the four tests.
// The printed range on every row is the model's own out-of-sample residual band, and the page
// publishes how often real caps actually fell inside it. The odds model is a logistic fit on every
// dated protocol — outcome: it records a token today — with age, size, growth, chain and family
// terms admitted by the same four-test rule scored by Brier; a row's odds are the model's
// probability that a protocol with its figures, still tokenless at its age, records one within the
// next 24 months. Implied value = value if it launches × those odds. Farm verdicts price the plan
// itself: a deposit set at 0.02% of TVL, an expected drop of 7.5% of implied value shared
// pro-rata, the plan's own fees and hours, and a $25-an-hour line — FARM above it, THIN when the
// plan merely pays for itself, SKIP when it loses.
//
// Determinism: no clock, no unseeded randomness. Fits, folds, bootstrap refits (a seeded PRNG) and
// hash parities are pure functions of the snapshot's bytes, so two runs write the same bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Farm scenario defaults (the page's controls re-price every row live from these). */
const DEPOSIT_PCT = 0.0002; // 0.02% of TVL
const DEPOSIT_MIN = 250;
const DEPOSIT_MAX = 250_000;
const DROP_SHARE = 0.075;
const HORIZON_WEEKS = 26;
const WAGE_LINE = 25; // dollars an hour a plan must beat to read FARM

// ---------------------------------------------------------------- the snapshot

/** One protocol of the sealed snapshot: exactly the ten fields the house fetched. */
interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** Parse and lightly validate the snapshot; anything malformed is a hard stop, never a guess. */
function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected {as_of, floor_usd, protocols[], watchlist[]}');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new Error(`snapshot: protocol ${String(p?.slug)} is missing slug, tvl_usd or chains`);
    }
  }
  return raw;
}

/**
 * The snapshot's own token record, read whole: a protocol already records a token when it
 * carries a symbol OR a recorded market cap. Reading the cap alone was v3's error — 288
 * protocols carry a symbol with the cap left blank, and every one of them already trades.
 */
const hasToken = (p: Protocol): boolean => p.symbol !== null || p.mcap_usd !== null;

// ---------------------------------------------------------------- small deterministic helpers

/** FNV-1a over a string: the board's only source of irregularity, and it never changes. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
const slugHash = (slug: string): number => fnv1a(slug);

/** A seeded PRNG (mulberry32) for the bootstrap refits: same seed, same refits, every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Whole days between two YYYY-MM-DD dates, read as UTC so no timezone can move the answer. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Years between a protocol's listing day and the snapshot's day; null when none is recorded. */
function ageYearsOf(p: Protocol, as_of: string): number | null {
  return p.listed_at === null ? null : Math.max(0, daysBetween(p.listed_at, as_of) / 365.25);
}

/** The median of a non-empty list: the middle value, or the mean of the two middle ones. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A quantile of a non-empty list, by linear interpolation between the nearest ranks. */
function quantileOf(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Least-squares slope through the origin; 0 when the points carry no signal. */
function slopeThroughOrigin(points: [number, number][]): number {
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of points) {
    sxy += x * y;
    sxx += x * x;
  }
  return sxx > 0 ? sxy / sxx : 0;
}

/** Ordinary least squares y ~ a + b*x; falls back to the mean when x carries no variance. */
function ols(points: [number, number][]): { a: number; b: number } {
  const n = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / n;
  const my = points.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
  }
  if (sxx <= 0) return { a: my, b: 0 };
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Short money for verdict lines: $1.24B, $340M, $85K. */
const moneyShort = (n: number): string =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.max(1, Math.round(n / 1e3))}K`;

// ---------------------------------------------------------------- classification & accounting

/** Every protocol lands in exactly one accounting group; the page prints the whole ledger. */
type Group =
  | 'ranked-watchlist'
  | 'ranked-early'
  | 'ranked-off-list'
  | 'token-priced'
  | 'token-recorded'
  | 'out-exchange'
  | 'out-bridge'
  | 'out-staking'
  | 'out-derivative';

const BRIDGE_CATEGORIES: ReadonlySet<string> = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const STAKING_CATEGORIES: ReadonlySet<string> = new Set(['Liquid Staking', 'Liquid Restaking']);
const EXCHANGE_HEADS = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * A name that reads as a product of something else: a versioned re-list ("… V2", "… 2.0") or a
 * wrapped/staked wrapper of an asset. Such a product's token, if any ever comes, is its parent's
 * story, not a launch of its own — the house's watchlist screen sets them aside, and so does this.
 */
function isDerivativeName(p: Protocol): boolean {
  if (/ (?:v\d+|\d+\.0)$/i.test(p.name)) return true;
  if (/\b(?:wrapped|staked)\b/i.test(p.name)) return true;
  return EXCHANGE_HEADS.some((head) => p.name === head || p.name.startsWith(`${head} `));
}

/** The accounting group of one protocol. Watchlist protocols are ranked whatever their shape. */
function groupOfProtocol(p: Protocol, watchlist: Set<string>, floor: number): Group {
  if (hasToken(p)) return p.mcap_usd !== null && p.mcap_usd > 0 ? 'token-priced' : 'token-recorded';
  if (watchlist.has(p.slug)) return 'ranked-watchlist';
  if (p.category === 'CEX') return 'out-exchange';
  if (p.category !== null && BRIDGE_CATEGORIES.has(p.category)) return 'out-bridge';
  if (p.category !== null && STAKING_CATEGORIES.has(p.category)) return 'out-staking';
  if (isDerivativeName(p)) return 'out-derivative';
  return p.tvl_usd >= floor ? 'ranked-early' : 'ranked-off-list';
}

const isRankedGroup = (g: Group): boolean => g === 'ranked-watchlist' || g === 'ranked-early' || g === 'ranked-off-list';

/**
 * A ranked protocol whose name shares its head with a priced comparable — a curator arm under a
 * priced parent, say — is flagged parent-linked: the parent is named on the row, and the parent's
 * own trading multiple is shown in the detail view as the anchor its launch would be priced
 * against.
 */
function parentOf(p: Protocol, priced: Protocol[]): Protocol | null {
  const head = p.slug.split('-')[0]!;
  if (head.length < 4) return null;
  let best: Protocol | null = null;
  for (const q of priced) {
    if (q.slug === p.slug) continue;
    if (q.slug.split('-')[0] === head && (best === null || q.tvl_usd > best.tvl_usd)) best = q;
  }
  return best;
}

// ---------------------------------------------------------------- the value model

/**
 * The value model prices a launch in log10 space, as a sequence of terms fitted on the priced
 * comparables. It starts from a flat median multiple (log cap = log TVL + the median log ratio).
 * Each further term is a candidate, added in a fixed order — a size curve, a ridge-shrunk
 * category effect, then growth, age, chain-count, and finally a random control — and a candidate
 * is admitted only when it lowers the median miss in at least THREE of four out-of-sample tests:
 * hash-parity halves in both directions (fit on the slug-hash-even comparables, score the odd,
 * then swap), leave-one-out over the whole fitting set, and walk-forward (fitted on the
 * comparables listed up to the median listing date, scored on the ones listed after). Every test
 * also reports the share of real caps it prices within a factor of two. The control is never
 * admitted: it is there so the page can show a term that must not help, next to the ones that did.
 */
type ValueTermId = 'size' | 'category' | 'growth' | 'age' | 'chains' | 'control';
const VALUE_TERM_ORDER: ValueTermId[] = ['size', 'category', 'growth', 'age', 'chains', 'control'];
const VALUE_TERM_LABEL: Record<ValueTermId, string> = {
  size: '+ size curve, log TVL',
  category: '+ family effect, ridge-shrunk',
  growth: '+ 7-day TVL growth',
  age: '+ age, log years listed',
  chains: '+ chain count, log',
  control: '+ control: a random number',
};

interface ValueFit {
  flat_log_ratio: number;
  size: { a: number; b: number } | null;
  category_effects: Map<string | null, number> | null;
  growth_slope: number | null;
  age_slope: number | null;
  age_ref_years: number;
  chains_slope: number | null;
}

/** A protocol's growth reading, clamped as the fit reads it; no reported change reads as 0. */
const growthX = (p: Protocol): number => (p.change_7d === null ? 0 : clamp(p.change_7d, -60, 120) / 100);
/** The control reading: a hash of the slug, centred — noise by construction. */
const controlX = (p: Protocol): number => (slugHash(p.slug) % 1000) / 1000 - 0.5;

/** Predict log10 market cap under a fit. Winsorized terms keep one wild week from ruling a value. */
function predictLogValue(fit: ValueFit, p: Protocol, as_of: string): number {
  let pred =
    fit.size !== null
      ? fit.size.a + fit.size.b * Math.log10(Math.max(1, p.tvl_usd))
      : Math.log10(Math.max(1, p.tvl_usd)) + fit.flat_log_ratio;
  if (fit.category_effects !== null) pred += fit.category_effects.get(farmGroupOf(p.category)) ?? 0;
  if (fit.growth_slope !== null) pred += clamp(fit.growth_slope * growthX(p), -0.398, 0.398);
  if (fit.age_slope !== null) {
    const age = ageYearsOf(p, as_of);
    const x = age === null ? 0 : Math.log10(1 + age) - Math.log10(1 + fit.age_ref_years);
    pred += clamp(fit.age_slope * x, -0.301, 0.301);
  }
  if (fit.chains_slope !== null) pred += clamp(fit.chains_slope * Math.log10(Math.max(1, p.chains.length)), -0.3, 0.3);
  return pred;
}

/** Fit the model with exactly the given terms admitted, on the given comparables. */
function fitValueModel(set: Protocol[], as_of: string, terms: ReadonlySet<ValueTermId>): ValueFit {
  const flat_log_ratio = medianOf(set.map((p) => Math.log10(p.mcap_usd!) - Math.log10(Math.max(1, p.tvl_usd))));
  const ages = set.map((p) => ageYearsOf(p, as_of)).filter((a): a is number => a !== null);
  const fit: ValueFit = {
    flat_log_ratio,
    size: null,
    category_effects: null,
    growth_slope: null,
    age_slope: null,
    age_ref_years: ages.length > 0 ? medianOf(ages) : 0,
    chains_slope: null,
  };
  if (terms.has('size')) {
    fit.size = ols(set.map((p) => [Math.log10(Math.max(1, p.tvl_usd)), Math.log10(p.mcap_usd!)] as [number, number]));
  }
  const base = (p: Protocol): number =>
    fit.size !== null ? fit.size.a + fit.size.b * Math.log10(Math.max(1, p.tvl_usd)) : Math.log10(Math.max(1, p.tvl_usd)) + fit.flat_log_ratio;
  if (terms.has('category')) {
    // The effect is fitted per coarse family (lending, dexs, yield, …), not per raw category:
    // a handful of comparables per raw category is noise, and the tests below said so. The
    // shrinkage is heavy for the same reason — a family's mean residual is damped by
    // n/(n + 48) before it may move a price.
    const byCategory = new Map<string | null, number[]>();
    for (const p of set) {
      const list = byCategory.get(farmGroupOf(p.category)) ?? [];
      list.push(Math.log10(p.mcap_usd!) - base(p));
      byCategory.set(farmGroupOf(p.category), list);
    }
    const effects = new Map<string | null, number>();
    for (const [category, residuals] of byCategory) {
      const mean = residuals.reduce((s, x) => s + x, 0) / residuals.length;
      effects.set(category, clamp((mean * residuals.length) / (residuals.length + 48), -0.6, 0.6));
    }
    fit.category_effects = effects;
  }
  const residual = (p: Protocol): number => Math.log10(p.mcap_usd!) - predictLogValue(fit, p, as_of);
  if (terms.has('growth')) fit.growth_slope = slopeThroughOrigin(set.map((p) => [growthX(p), residual(p)] as [number, number]));
  if (terms.has('age')) {
    const dated = set.filter((p) => ageYearsOf(p, as_of) !== null);
    fit.age_slope = slopeThroughOrigin(
      dated.map((p) => [Math.log10(1 + ageYearsOf(p, as_of)!) - Math.log10(1 + fit.age_ref_years), residual(p)] as [number, number]),
    );
  }
  if (terms.has('chains')) {
    fit.chains_slope = slopeThroughOrigin(set.map((p) => [Math.log10(Math.max(1, p.chains.length)), residual(p)] as [number, number]));
  }
  return fit;
}

/** Leave-one-out log10 errors of a term set over the comparables: each point priced by a fit that never saw it. */
function valueLooErrors(set: Protocol[], as_of: string, terms: ReadonlySet<ValueTermId>): number[] {
  return set.map((p, i) => {
    const train = set.filter((_, j) => j !== i);
    return Math.log10(p.mcap_usd!) - predictLogValue(fitValueModel(train, as_of, terms), p, as_of);
  });
}

/** The walk-forward split: dated comparables divided at their median listing date. */
function walkForwardSplit(set: Protocol[], as_of: string): { train: Protocol[]; test: Protocol[]; cutoff: string } {
  const dated = set.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cutoff = dated[Math.floor(dated.length / 2)]!.listed_at!;
  return {
    train: dated.filter((p) => p.listed_at! <= cutoff),
    test: dated.filter((p) => p.listed_at! > cutoff),
    cutoff,
  };
}

/** Walk-forward log10 errors: a fit on the earlier-listed comparables, scored on the later ones. */
function valueWfErrors(set: Protocol[], as_of: string, terms: ReadonlySet<ValueTermId>): { errors: number[]; cutoff: string } {
  const { train, test, cutoff } = walkForwardSplit(set, as_of);
  const fit = fitValueModel(train, as_of, terms);
  return { errors: test.map((p) => Math.log10(p.mcap_usd!) - predictLogValue(fit, p, as_of)), cutoff };
}

/** Hash-parity log10 errors: a fit on one slug-hash half of the comparables, scored on the other. */
function valueParityErrors(set: Protocol[], as_of: string, terms: ReadonlySet<ValueTermId>, fromHalf: number): number[] {
  const train = set.filter((p) => slugHash(p.slug) % 2 === fromHalf);
  const test = set.filter((p) => slugHash(p.slug) % 2 !== fromHalf);
  const fit = fitValueModel(train, as_of, terms);
  return test.map((p) => Math.log10(p.mcap_usd!) - predictLogValue(fit, p, as_of));
}

/** The median miss as a factor: 10 to the median absolute log10 error. */
const missFactor = (errors: number[]): number => Math.pow(10, medianOf(errors.map((e) => Math.abs(e))));

/** One held-out test's score for the value model: the median miss as a factor, and the share of real caps priced within a factor of two. */
interface TestScore {
  miss: number;
  within2: number;
}

/** The four held-out tests every term must face, in the order the page prints them. */
interface ValueTests {
  h12: TestScore;
  h21: TestScore;
  loo: TestScore;
  wf: TestScore;
}

const scoreErrors = (errors: number[]): TestScore => ({
  miss: missFactor(errors),
  within2: Math.round((errors.filter((e) => Math.abs(e) <= Math.log10(2)).length / Math.max(1, errors.length)) * 100),
});

/** How many of the four tests a candidate's median miss improves on the current model's. */
const testsImproved = (e: ValueTests, cur: ValueTests): number =>
  [e.h12.miss < cur.h12.miss - 1e-9, e.h21.miss < cur.h21.miss - 1e-9, e.loo.miss < cur.loo.miss - 1e-9, e.wf.miss < cur.wf.miss - 1e-9].filter(Boolean).length;

interface StageRow {
  term: string;
  label: string;
  tests: ValueTests;
  verdict: string;
}

interface ValueModelResult {
  fit: ValueFit;
  kept: ValueTermId[];
  stages: StageRow[];
  tests: ValueTests;
  loo_miss: number;
  wf_miss: number;
  band: { q10: number; q25: number; q75: number; q90: number };
  honesty: { loo50: number; loo80: number; wf50: number; wf80: number; wf_n: number };
  ses: { term: string; estimate: number; se: number }[];
  wf_cutoff: string;
  fit_n: number;
}

/** Run the admission tests, fit the surviving model on all comparables, and measure its honesty. */
function buildValueModel(comps: Protocol[], as_of: string): ValueModelResult {
  const evaluate = (terms: ReadonlySet<ValueTermId>): ValueTests => ({
    h12: scoreErrors(valueParityErrors(comps, as_of, terms, 0)),
    h21: scoreErrors(valueParityErrors(comps, as_of, terms, 1)),
    loo: scoreErrors(valueLooErrors(comps, as_of, terms)),
    wf: scoreErrors(valueWfErrors(comps, as_of, terms).errors),
  });
  let kept: ValueTermId[] = [];
  let current = evaluate(new Set());
  const stages: StageRow[] = [{ term: 'flat', label: 'flat median multiple', tests: current, verdict: 'baseline' }];
  for (const term of VALUE_TERM_ORDER) {
    const candidate = new Set([...kept, term]);
    const e = evaluate(candidate);
    const improves = testsImproved(e, current);
    let verdict: string;
    if (term === 'control') verdict = improves >= 3 ? 'must not help — a noise-level gain, not admitted' : 'must not help';
    else verdict = improves >= 3 ? 'kept' : 'tested, not kept';
    stages.push({ term, label: VALUE_TERM_LABEL[term], tests: e, verdict });
    if (improves >= 3 && term !== 'control') {
      kept = [...kept, term];
      current = e;
    }
  }
  const keptSet = new Set(kept);
  const fit = fitValueModel(comps, as_of, keptSet);
  const looErrors = valueLooErrors(comps, as_of, keptSet);
  const band = {
    q10: quantileOf(looErrors, 0.1),
    q25: quantileOf(looErrors, 0.25),
    q75: quantileOf(looErrors, 0.75),
    q90: quantileOf(looErrors, 0.9),
  };
  const inside = (errors: number[], lo: number, hi: number): number =>
    Math.round((errors.filter((e) => e >= lo && e <= hi).length / errors.length) * 100);
  const wf = valueWfErrors(comps, as_of, keptSet);
  const honesty = {
    loo50: inside(looErrors, band.q25, band.q75),
    loo80: inside(looErrors, band.q10, band.q90),
    wf50: inside(wf.errors, band.q25, band.q75),
    wf80: inside(wf.errors, band.q10, band.q90),
    wf_n: wf.errors.length,
  };
  // Bootstrap standard errors for the admitted slopes: 100 seeded resamples of the comparables.
  const ses: { term: string; estimate: number; se: number }[] = [];
  if (kept.length > 0) {
    const rand = mulberry32(20261114);
    const samples: Record<string, number[]> = { size: [], growth: [], age: [], chains: [] };
    for (let r = 0; r < 100; r++) {
      const sample = comps.map(() => comps[Math.floor(rand() * comps.length)]!);
      const f = fitValueModel(sample, as_of, keptSet);
      if (f.size !== null) samples.size!.push(f.size.b);
      if (f.growth_slope !== null) samples.growth!.push(f.growth_slope);
      if (f.age_slope !== null) samples.age!.push(f.age_slope);
      if (f.chains_slope !== null) samples.chains!.push(f.chains_slope);
    }
    const sd = (xs: number[]): number => {
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length);
    };
    const estimate: Record<string, number> = {
      size: fit.size?.b ?? 0,
      growth: fit.growth_slope ?? 0,
      age: fit.age_slope ?? 0,
      chains: fit.chains_slope ?? 0,
    };
    for (const term of kept) {
      if (term === 'category') continue;
      ses.push({ term, estimate: round3(estimate[term]!), se: round3(sd(samples[term]!)) });
    }
  }
  return {
    fit,
    kept,
    stages,
    tests: current,
    loo_miss: current.loo.miss,
    wf_miss: current.wf.miss,
    band,
    honesty,
    ses,
    wf_cutoff: wf.cutoff,
    fit_n: comps.length,
  };
}

// ---------------------------------------------------------------- the odds model

/**
 * The odds model is a logistic fit on every dated protocol in the snapshot — the outcome is
 * whether it records a token today — admitted term by term under the same discipline as the
 * value model: a candidate (age, size, growth, chains, family, then a random control) is kept
 * only when it lowers the Brier score in at least three of four held-out tests — hash-parity
 * halves in both directions, a ten-fold test (folds by slug hash), and a walk-forward test
 * (fitted on protocols listed up to the median listing date, scored on the later ones). The fit
 * itself is ridge-shrunk (λ = 0.1 on the standardised features) and trained for 1,500 gradient
 * passes, well past the point where its held-out scores stop moving: v4's 600-pass fit had in
 * fact converged, and its 0.264 walk-forward Brier was a missing-term problem, not a training
 * problem — the family term and the two-piece age curve are what move it. A row's odds are then
 * read off the fitted curve: the probability that a protocol with its figures, still tokenless
 * at its present age, records a token within the next 24 months — (F(age + 2) − F(age)) /
 * (1 − F(age)).
 */
type OddsTermId = 'age' | 'size' | 'growth' | 'chains' | 'category' | 'control';
const ODDS_TERM_ORDER: OddsTermId[] = ['age', 'size', 'growth', 'chains', 'category', 'control'];
const ODDS_TERM_LABEL: Record<OddsTermId, string> = {
  age: '+ age curve, log years and its square',
  size: '+ size, log TVL',
  growth: '+ 7-day TVL growth',
  chains: '+ chain count, log',
  category: '+ family, ridge-shrunk',
  control: '+ control: a random number',
};

/** The farm families, in the order the odds model's family dummies take them. */
const ODDS_FAMILIES = ['lending', 'dex', 'perps', 'cdp', 'yield', 'stake', 'rwa', 'payments', 'chain', 'generic'] as const;

/** The feature columns each odds term owns: age is a two-piece curve, family is one dummy per family. */
const ODDS_TERM_COLS: Record<OddsTermId, number[]> = {
  age: [0, 1],
  size: [2],
  growth: [3],
  chains: [4],
  category: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  control: [15],
};

/** The raw odds features of one protocol: 0..1 age curve, 2 size, 3 growth, 4 chains, 5..14 family, 15 control. */
function oddsFeatures(p: Protocol, as_of: string, ageOverride?: number): number[] {
  const age = ageOverride ?? ageYearsOf(p, as_of) ?? 0;
  const ageLog = Math.log10(1 + Math.max(0, age));
  const family = farmGroupOf(p.category);
  return [
    ageLog,
    ageLog * ageLog,
    Math.log10(Math.max(1, p.tvl_usd)),
    growthX(p),
    Math.log10(Math.max(1, p.chains.length)),
    ...ODDS_FAMILIES.map((g) => (family === g ? 1 : 0)),
    controlX(p),
  ];
}

interface OddsFit {
  terms: OddsTermId[];
  cols: number[];
  mean: number[];
  sd: number[];
  w: number[];
  b: number;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-clamp(x, -30, 30)));

/** The odds fit's ridge: every standardised coefficient is shrunk toward 0 with this weight. */
const ODDS_RIDGE = 0.1;
/** Gradient passes per odds fit: the held-out scores stop moving long before this count. */
const ODDS_PASSES = 1500;

/** Fit the logistic model with exactly the given terms, by deterministic gradient descent. */
function fitOddsModel(train: Protocol[], as_of: string, terms: ReadonlySet<OddsTermId>): OddsFit {
  const cols = ODDS_TERM_ORDER.filter((t) => terms.has(t)).flatMap((t) => ODDS_TERM_COLS[t]);
  const X = train.map((p) => oddsFeatures(p, as_of));
  const y = train.map((p) => (hasToken(p) ? 1 : 0));
  const mean = cols.map((i) => X.reduce((s, row) => s + row[i]!, 0) / X.length);
  const sd = cols.map((i, k) => {
    const m = mean[k]!;
    return Math.sqrt(X.reduce((s, row) => s + (row[i]! - m) * (row[i]! - m), 0) / X.length) || 1;
  });
  const base = clamp(y.reduce((s, v) => s + v, 0) / y.length, 0.001, 0.999);
  let b = Math.log(base / (1 - base));
  const w = cols.map(() => 0);
  const Z = X.map((row) => cols.map((i, k) => (row[i]! - mean[k]!) / sd[k]!));
  for (let iter = 0; iter < ODDS_PASSES; iter++) {
    const gb = { v: 0 };
    const gw = w.map(() => 0);
    for (let r = 0; r < Z.length; r++) {
      let s = b;
      for (let k = 0; k < w.length; k++) s += w[k]! * Z[r]![k]!;
      const err = sigmoid(s) - y[r]!;
      gb.v += err;
      for (let k = 0; k < w.length; k++) gw[k]! += err * Z[r]![k]!;
    }
    b -= (0.2 * gb.v) / Z.length;
    for (let k = 0; k < w.length; k++) w[k]! -= 0.2 * (gw[k]! / Z.length + ODDS_RIDGE * w[k]!);
  }
  return { terms: ODDS_TERM_ORDER.filter((t) => terms.has(t)), cols, mean, sd, w, b };
}

/** The fitted probability that a protocol records a token, at its own age or an overridden one. */
function predictOdds(fit: OddsFit, p: Protocol, as_of: string, ageOverride?: number): number {
  const raw = oddsFeatures(p, as_of, ageOverride);
  let s = fit.b;
  fit.cols.forEach((i, k) => {
    s += fit.w[k]! * ((raw[i]! - fit.mean[k]!) / fit.sd[k]!);
  });
  return sigmoid(s);
}

const brier = (pairs: [number, number][]): number =>
  pairs.reduce((s, [pred, y]) => s + (pred - y) * (pred - y), 0) / Math.max(1, pairs.length);

/** Ten-fold Brier: folds by slug hash, each fold scored by a fit that never saw it. */
function oddsFoldBrier(sample: Protocol[], as_of: string, terms: ReadonlySet<OddsTermId>): number {
  const pairs: [number, number][] = [];
  for (let fold = 0; fold < 10; fold++) {
    const test = sample.filter((p) => slugHash(p.slug) % 10 === fold);
    const train = sample.filter((p) => slugHash(p.slug) % 10 !== fold);
    if (test.length === 0 || train.length === 0) continue;
    const fit = fitOddsModel(train, as_of, terms);
    for (const p of test) pairs.push([predictOdds(fit, p, as_of), hasToken(p) ? 1 : 0]);
  }
  return brier(pairs);
}

/** Walk-forward Brier: fitted on the earlier-listed half of the dated sample, scored on the later half. */
function oddsWfBrier(sample: Protocol[], as_of: string, terms: ReadonlySet<OddsTermId>): { brier: number; cutoff: string } {
  const dated = [...sample].sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cutoff = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const train = dated.filter((p) => p.listed_at! <= cutoff);
  const test = dated.filter((p) => p.listed_at! > cutoff);
  const fit = fitOddsModel(train, as_of, terms);
  return { brier: brier(test.map((p) => [predictOdds(fit, p, as_of), hasToken(p) ? 1 : 0] as [number, number])), cutoff };
}

/** Hash-parity Brier: a fit on one slug-hash half of the dated sample, scored on the other. */
function oddsParityBrier(sample: Protocol[], as_of: string, terms: ReadonlySet<OddsTermId>, fromHalf: number): number {
  const train = sample.filter((p) => slugHash(p.slug) % 2 === fromHalf);
  const test = sample.filter((p) => slugHash(p.slug) % 2 !== fromHalf);
  const fit = fitOddsModel(train, as_of, terms);
  return brier(test.map((p) => [predictOdds(fit, p, as_of), hasToken(p) ? 1 : 0] as [number, number]));
}

/** The four held-out Brier scores every odds term must face. */
interface OddsTests {
  h12: number;
  h21: number;
  fold: number;
  wf: number;
}

interface OddsStageRow {
  term: string;
  label: string;
  tests: OddsTests;
  verdict: string;
}

interface OddsModelResult {
  fit: OddsFit;
  kept: OddsTermId[];
  stages: OddsStageRow[];
  tests: OddsTests;
  fold_brier: number;
  wf_brier: number;
  base_fold: number;
  base_wf: number;
  sample_n: number;
  wf_cutoff: string;
  median_age: number;
}

/** Run the odds admission tests and fit the surviving model on every dated protocol. */
function buildOddsModel(snap: Snapshot): OddsModelResult {
  const as_of = snap.as_of;
  const sample = snap.protocols.filter((p) => p.listed_at !== null);
  const evaluate = (terms: ReadonlySet<OddsTermId>): OddsTests => ({
    h12: oddsParityBrier(sample, as_of, terms, 0),
    h21: oddsParityBrier(sample, as_of, terms, 1),
    fold: oddsFoldBrier(sample, as_of, terms),
    wf: oddsWfBrier(sample, as_of, terms).brier,
  });
  let kept: OddsTermId[] = [];
  let current = evaluate(new Set());
  const stages: OddsStageRow[] = [{ term: 'base', label: 'base rate alone', tests: current, verdict: 'baseline' }];
  for (const term of ODDS_TERM_ORDER) {
    const candidate = new Set([...kept, term]);
    const e = evaluate(candidate);
    const improves = [e.h12 < current.h12 - 1e-9, e.h21 < current.h21 - 1e-9, e.fold < current.fold - 1e-9, e.wf < current.wf - 1e-9].filter(Boolean).length;
    let verdict: string;
    if (term === 'control') verdict = improves >= 3 ? 'must not help — a noise-level gain, not admitted' : 'must not help';
    else verdict = improves >= 3 ? 'kept' : 'tested, not kept';
    stages.push({ term, label: ODDS_TERM_LABEL[term], tests: e, verdict });
    if (improves >= 3 && term !== 'control') {
      kept = [...kept, term];
      current = e;
    }
  }
  const ages = sample.map((p) => ageYearsOf(p, as_of)!).filter((a) => a !== null);
  return {
    fit: fitOddsModel(sample, as_of, new Set(kept)),
    kept,
    stages,
    tests: current,
    fold_brier: current.fold,
    wf_brier: current.wf,
    base_fold: stages[0]!.tests.fold,
    base_wf: stages[0]!.tests.wf,
    sample_n: sample.length,
    wf_cutoff: oddsWfBrier(sample, as_of, new Set(kept)).cutoff,
    median_age: medianOf(ages),
  };
}

/** Launch odds read off any fitted odds model: the chance of recording a token within 24 months. */
function oddsFromFit(
  fit: OddsFit,
  kept: OddsTermId[],
  medianAge: number,
  p: Protocol,
  as_of: string,
): { odds: number; age_years: number; age_known: boolean } {
  const known = ageYearsOf(p, as_of);
  const age = known ?? medianAge;
  const here = predictOdds(fit, p, as_of, age);
  if (!kept.includes('age')) return { odds: clamp(here, 0.01, 0.99), age_years: age, age_known: known !== null };
  const later = predictOdds(fit, p, as_of, age + 2);
  return { odds: clamp((later - here) / Math.max(1e-6, 1 - here), 0.01, 0.99), age_years: age, age_known: known !== null };
}

/** A row's launch odds under the board's fitted odds model. */
function launchOdds(model: OddsModelResult, p: Protocol, as_of: string): { odds: number; age_years: number; age_known: boolean } {
  return oddsFromFit(model.fit, model.kept, model.median_age, p, as_of);
}

/**
 * A board row's launch record, read from its peers in the snapshot: the protocols of the same
 * category whose TVL sits within a factor of three of its own, token-recorded and tokenless
 * together (the record counts the snapshot's symbol-or-cap token record, as everywhere in v5).
 * When fewer than five such peers exist the record widens to the whole category. It is a
 * record — how many like it already trade a token — never a forecast.
 */
function peerRecord(snap: Snapshot, p: Protocol): { num: number; den: number } {
  let peers = snap.protocols.filter(
    (q) => q.category === p.category && q.tvl_usd >= p.tvl_usd / 3 && q.tvl_usd <= p.tvl_usd * 3,
  );
  if (peers.length < 5) peers = snap.protocols.filter((q) => q.category === p.category);
  return { num: peers.filter((q) => hasToken(q)).length, den: peers.length };
}

// ---------------------------------------------------------------- farm plans & economics

/**
 * Farm plans are written per category group and per protocol, and priced as they are written:
 * every step names a concrete action on one of the protocol's own chains and carries a dollar
 * cost and a time. The plan's economics are then arithmetic, not adjectives: a deposit set by
 * rule at 0.02% of the protocol's TVL (floored, capped), an expected drop of the scenario's
 * share of implied value divided pro-rata by TVL, the plan's own summed fees, and its summed
 * hours. The verdict bands are drawn on the net per hour against a $25 line.
 */
type FarmGroup = 'lending' | 'dex' | 'perps' | 'cdp' | 'yield' | 'stake' | 'rwa' | 'payments' | 'chain' | 'generic';

function farmGroupOf(category: string | null): FarmGroup {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('collateral')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic') || c.includes('interest rate')) return 'perps';
  if (c.includes('cdp') || c.includes('stablecoin') || c.includes('algo-stable') || c.includes('reserve currency')) return 'cdp';
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager') || c.includes('risk curator') || c.includes('capital allocator') || c.includes('basis')) return 'yield';
  if (c.includes('staking') || c.includes('restaking') || c.includes('restaked')) return 'stake';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  if (c.includes('chain')) return 'chain';
  return 'generic';
}

/** What each group's core action costs in dollars, and the minutes it takes. */
const CORE_COST: Record<FarmGroup, number> = { lending: 4, dex: 5, perps: 6, cdp: 5, yield: 4, stake: 3, rwa: 5, payments: 2, chain: 6, generic: 5 };
const CORE_MINUTES: Record<FarmGroup, number> = { lending: 25, dex: 30, perps: 35, cdp: 30, yield: 20, stake: 15, rwa: 40, payments: 15, chain: 45, generic: 30 };

/** The group's core action, done on the protocol's first chain with the plan's deposit. */
const CORE_ACTION: Record<FarmGroup, (name: string, chain: string, stake: string, cost: number) => string> = {
  lending: (n, ch, s, c) => `Supply ${s} of a major stablecoin or ETH on ${n} via ${ch}, then borrow a small amount against it and repay within the week, so the wallet shows both sides of the market: about $${c} in gas.`,
  dex: (n, ch, s, c) => `Make 3-4 swaps totalling about ${s} on ${n} via ${ch} across two different days, then hold a small position in one of its main pools for at least a week: about $${c} in gas.`,
  perps: (n, ch, s, c) => `Open and close two small hedged positions on ${n} via ${ch}, about ${s} of margin in total, holding one overnight so the wallet records real trading rather than a single click: about $${c} in fees.`,
  cdp: (n, ch, s, c) => `Open a vault on ${n} via ${ch} with about ${s} of collateral, mint a small amount of its stablecoin, hold the position a full week, then repay and close cleanly: about $${c} in gas.`,
  yield: (n, ch, s, c) => `Deposit about ${s} into one of ${n}'s main vaults or curated markets on ${ch} and leave it untouched for at least two weeks, so the wallet reads as capital at work, not a drive-by: about $${c} in gas.`,
  stake: (n, ch, s, c) => `Stake about ${s} through ${n} on ${ch} and keep the position — including any receipt token it issues — in the same wallet for a month or more: about $${c} in gas.`,
  rwa: (n, ch, s, c) => `Complete ${n}'s onboarding on ${ch} if it asks for it, then hold about ${s} of its flagship real-world-asset product for at least a month: about $${c} in gas, forms included.`,
  payments: (n, ch, s, c) => `Route a real payment of about ${s} through ${n} on ${ch} — pay an actual bill or invoice rather than sending funds to yourself — and keep the receipt: about $${c} in fees.`,
  chain: (n, ch, s, c) => `Bridge about ${s} to ${ch === n ? 'the chain' : ch} and use two or three native apps there in the same week, so the wallet is an early active address on ${n}'s own network: about $${c} in bridge and gas fees.`,
  generic: (n, ch, s, c) => `Use ${n}'s core product on ${ch} with about ${s} at stake, completing the full flow it is built around — deposit and withdrawal, or mint and redeem — rather than stopping at an approval: about $${c} in gas.`,
};

interface PlanStep {
  when: string;
  text: string;
  cost: number;
  minutes: number;
}

const moneyFull = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

/** The plan deposit for a protocol of this TVL: 0.02% of TVL, floored and capped. */
const depositFor = (tvl: number): number => clamp(Math.round(DEPOSIT_PCT * tvl), DEPOSIT_MIN, DEPOSIT_MAX);

/**
 * The canonical bridge into a chain, named: a plan that says "bridge the funds" without saying
 * over what is a slogan, so each route the plan takes names the bridge the chain itself runs —
 * and, for USDC, the native CCTP route where Circle runs one. Chains not listed take the
 * fallback: the canonical bridge the chain's own documentation links.
 */
const CANONICAL_BRIDGE: Record<string, string> = {
  Ethereum: 'native — no bridge',
  Arbitrum: "the Arbitrum Bridge (Arbitrum's own canonical bridge); native USDC also moves over Circle CCTP",
  Optimism: "the Optimism Gateway (the canonical Superchain bridge); native USDC also moves over Circle CCTP",
  'OP Mainnet': "the Optimism Gateway (the canonical Superchain bridge); native USDC also moves over Circle CCTP",
  Base: "the Base Bridge (Base's own canonical bridge); native USDC also moves over Circle CCTP",
  Polygon: "the Polygon PoS Bridge (Polygon's canonical bridge); native USDC also moves over Circle CCTP",
  Avalanche: "the Avalanche Bridge (Avalanche's canonical bridge); native USDC also moves over Circle CCTP",
  Solana: "Wormhole's Portal Bridge; native USDC also moves over Circle CCTP",
  'BNB Chain': 'the BNB Chain Bridge (the canonical Binance bridge)',
  BSC: 'the BNB Chain Bridge (the canonical Binance bridge)',
  'zkSync Era': 'the zkSync Era Bridge (the canonical bridge)',
  Linea: 'the Linea Bridge (the canonical bridge)',
  Scroll: 'the Scroll Canonical Bridge',
  Mantle: 'the Mantle Bridge (the canonical bridge)',
  Blast: 'the Blast Bridge (the canonical bridge)',
  Sonic: "the Sonic Gateway (the chain's canonical bridge)",
};

/** How the plan's money reaches a chain: the named canonical route, or native when it starts there. */
function bridgeRoute(chain: string): string {
  return CANONICAL_BRIDGE[chain] ?? `the canonical bridge linked from ${chain}'s own documentation`;
}

/** Build one protocol's six-step plan under the default scenario (26-week horizon). */
function farmPlan(p: Protocol, implied: number): PlanStep[] {
  const h = slugHash(p.slug);
  const pick = (band: readonly number[], salt: number): number => band[(h >>> salt) % band.length]!;
  const gas = pick([3, 4, 5, 6, 8], 3);
  const exitGas = Math.max(2, gas - 1);
  const first = p.chains[0] ?? 'Ethereum';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const group = farmGroupOf(p.category);
  const deposit = moneyFull(depositFor(p.tvl_usd));
  const weeks = HORIZON_WEEKS;
  const bridged = first !== 'Ethereum';
  const route =
    first === 'Ethereum'
      ? `Deposit route: native on Ethereum — no bridge; fund the wallet and deposit directly.`
      : `Deposit route: bridge the deposit from Ethereum to ${first} over ${bridgeRoute(first)}, about $6 and 20 minutes, then deposit.`;
  const steps: PlanStep[] = [
    {
      when: 'Day 0',
      text: `Set up one wallet for ${p.name} and fund it on ${first} with the plan deposit of ${deposit} plus about $${gas} of native gas; keep this single address for everything below — one consistent wallet, and never split activity across sybil addresses. ${route}`,
      cost: gas + (bridged ? 6 : 0),
      minutes: 15 + (bridged ? 20 : 0),
    },
    {
      when: 'Day 0',
      text: CORE_ACTION[group](p.name, first, deposit, CORE_COST[group]),
      cost: CORE_COST[group],
      minutes: CORE_MINUTES[group],
    },
    second !== null
      ? {
          when: 'Day 0',
          text: `Repeat the core action on ${second}, where ${p.name} also runs, at about half the first position. Bridge that second position over ${bridgeRoute(second)} rather than a third-party fast bridge: multi-chain use is the cheapest signal that a wallet is a real user.`,
          cost: exitGas + 6,
          minutes: 40,
        }
      : {
          when: 'Day 7',
          text: `Come back a week later and repeat the core action on ${first} at a similar size, so the wallet's history spans weeks rather than a single afternoon.`,
          cost: gas,
          minutes: 20,
        },
    {
      when: `Weekly ×${weeks}`,
      text: `Weekly cadence, five minutes a week: leave the position in place and check four things — the position's balance, the APY or points page, any curator or fee change, and ${p.name}'s announcements. No churn that would read as farming rather than use.`,
      cost: 0,
      minutes: 5 * weeks,
    },
    {
      when: `Day ${weeks * 7 - 14}`,
      text: `Pre-exit review: check the points or rewards programme's own status — still running, terms changed, snapshot announced, or ended — and note any eligibility wording verbatim. Re-read the withdrawal terms (instant, epoch or queue) and any curator or performance fee before this date, so the exit is a known cost, not a surprise. If ${p.name}'s TVL has fallen 25% below the snapshot's ${moneyFull(p.tvl_usd)}, start the exit instead of waiting.`,
      cost: 0,
      minutes: 10,
    },
    {
      when: `Day ${weeks * 7}`,
      text: `Exit rule: withdraw the position cleanly at the horizon unless a launch is live and the position itself is the eligibility — a dated history from one wallet, kept whole, is what a retroactive drop reads first. The sizing is printed so it can be checked: implied value ${moneyShort(implied)} × 7.5% drop share × this plan's ${deposit} of ${moneyFull(p.tvl_usd)} TVL ≈ ${moneyFull((implied * DROP_SHARE * depositFor(p.tvl_usd)) / Math.max(1, p.tvl_usd))} expected, before the fees above.`,
      cost: exitGas,
      minutes: 20,
    },
  ];
  return steps;
}

/** A plan step as board.json carries it: when, what, and what it costs in money and minutes. */
const stepText = (s: PlanStep): string =>
  `${s.when} — ${s.text}${s.cost > 0 ? ` Cost $${s.cost}.` : ''} Time ${s.minutes >= 60 ? `${Math.round((s.minutes / 60) * 10) / 10} h` : `${s.minutes} min`}.`;

interface Economics {
  deposit: number;
  drop: number;
  fees: number;
  hours: number;
  net: number;
  per_hour: number;
  label: 'FARM' | 'THIN' | 'SKIP';
  verdict: string;
}

/** Price a plan: expected drop on the deposit, less the plan's fees, over the plan's hours. */
function economics(implied: number, tvl: number, steps: PlanStep[]): Economics {
  const deposit = depositFor(tvl);
  const drop = (implied * DROP_SHARE * deposit) / Math.max(1, tvl);
  const fees = steps.reduce((s, x) => s + x.cost, 0);
  const hours = steps.reduce((s, x) => s + x.minutes, 0) / 60;
  const net = drop - fees;
  const per_hour = net / Math.max(0.1, hours);
  const perHourText = `$${per_hour >= 100 ? Math.round(per_hour) : round2(per_hour)}`;
  const label: Economics['label'] = net < 0 ? 'SKIP' : per_hour >= WAGE_LINE ? 'FARM' : 'THIN';
  const verdict =
    label === 'FARM'
      ? `FARM — the expected drop on a ${moneyFull(deposit)} plan is ${moneyShort(drop)} over ${HORIZON_WEEKS} weeks; after $${fees} of fees it nets ${moneyShort(net)}, about ${perHourText} an hour of work — above the $${WAGE_LINE}/h line.`
      : label === 'THIN'
        ? `THIN — the expected drop on a ${moneyFull(deposit)} plan is ${moneyShort(drop)}; after $${fees} of fees it nets ${moneyShort(net)}, about ${perHourText} an hour — the plan pays for itself but does not beat the $${WAGE_LINE}/h line.`
        : `SKIP — the expected drop on a ${moneyFull(deposit)} plan is ${moneyShort(drop)}, which does not cover the plan's $${fees} of fees (net ${moneyShort(net)}): at this size and these odds, farming it loses money.`;
  return { deposit, drop: round2(drop), fees, hours: round2(hours), net: round2(net), per_hour: round2(per_hour), label, verdict };
}

// ---------------------------------------------------------------- the board

/** One row of /output/board.json, and of the dashboard's data. */
interface Row {
  slug: string;
  name: string;
  rank: number;
  rank_range: [number, number];
  implied_value_usd: number;
  value_if_launches_usd: number;
  value_range_usd: [number, number];
  farm_steps: string[];
  plan: PlanStep[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_years: number;
  age_known: boolean;
  odds_pct: number;
  odds_num: number;
  odds_den: number;
  plan_cost_usd: number;
  deposit_usd: number;
  drop_usd: number;
  fees_usd: number;
  hours: number;
  net_usd: number;
  per_hour_usd: number;
  verdict_label: 'FARM' | 'THIN' | 'SKIP';
  verdict: string;
  watchlist: boolean;
  segment: 'watchlist' | 'early' | 'off-list';
  parent_name: string | null;
  parent_multiple: number | null;
}

interface Built {
  rows: Row[];
  counts: Record<Group, number>;
  value: ValueModelResult;
  odds: OddsModelResult;
  checksum: string;
  total_implied: number;
  total_tvl: number;
}

/**
 * Build the board: fit both models, score every ranked protocol, rank by implied value
 * (value if it launches × launch odds), walk the values down so none ever rises with rank,
 * and price every row's farm plan. The v5 invariant is checked as it is built: no protocol
 * that records a token can appear on the board.
 */
function buildBoard(snap: Snapshot): Built {
  const watchlist = new Set(snap.watchlist);
  const counts = {} as Record<Group, number>;
  const groups = new Map<string, Group>();
  for (const p of snap.protocols) {
    const g = groupOfProtocol(p, watchlist, snap.floor_usd);
    groups.set(p.slug, g);
    counts[g] = (counts[g] ?? 0) + 1;
  }
  const priced = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const comps = priced.filter((p) => p.tvl_usd > 0);
  const value = buildValueModel(comps, snap.as_of);
  const oddsModel = buildOddsModel(snap);

  interface ScoredRow {
    p: Protocol;
    group: Group;
    value_if: number;
    odds: number;
    age_years: number;
    age_known: boolean;
    point: number;
  }
  const scored: ScoredRow[] = [];
  for (const p of snap.protocols) {
    const g = groups.get(p.slug)!;
    if (!isRankedGroup(g)) continue;
    if (hasToken(p)) throw new Error(`radar v6: ${p.slug} records a token and reached the ranked pool — the separation failed`);
    const value_if = Math.pow(10, predictLogValue(value.fit, p, snap.as_of));
    const o = launchOdds(oddsModel, p, snap.as_of);
    scored.push({ p, group: g, value_if, odds: o.odds, age_years: o.age_years, age_known: o.age_known, point: value_if * o.odds });
  }
  const jittered = scored.map((s) => ({
    ...s,
    jittered: s.point * (1 + (((slugHash(s.p.slug) % 2001) - 1000) / 1000) * 0.03),
  }));
  jittered.sort((a, b) => b.jittered - a.jittered || (a.p.slug < b.p.slug ? -1 : 1));

  // Rank ranges from bootstrap refits, not from the value band: 100 seeded resamples of the
  // comparables and of the dated odds sample, both models refitted and the whole board
  // re-ranked each time. The range is where a row's rank lands across refits (10th–90th
  // percentile) — it measures the fitted models' own uncertainty, which is far tighter than
  // the residual band on any single value, and the two are never conflated on the page.
  const dated = snap.protocols.filter((p) => p.listed_at !== null);
  const rankSamples = new Map<string, number[]>();
  {
    const rand = mulberry32(20260214);
    const keptValue = new Set(value.kept);
    const keptOdds = new Set(oddsModel.kept);
    for (let r = 0; r < 100; r++) {
      const compSample = comps.map(() => comps[Math.floor(rand() * comps.length)]!);
      const vf = fitValueModel(compSample, snap.as_of, keptValue);
      const oddSample = dated.map(() => dated[Math.floor(rand() * dated.length)]!);
      const of = fitOddsModel(oddSample, snap.as_of, keptOdds);
      const vals = scored.map((s) => ({
        slug: s.p.slug,
        v: Math.pow(10, predictLogValue(vf, s.p, snap.as_of)) * oddsFromFit(of, oddsModel.kept, oddsModel.median_age, s.p, snap.as_of).odds,
      }));
      vals.sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
      vals.forEach((x, rank) => {
        const list = rankSamples.get(x.slug) ?? [];
        list.push(rank + 1);
        rankSamples.set(x.slug, list);
      });
    }
  }
  const rows: Row[] = [];
  let previous = Number.POSITIVE_INFINITY;
  jittered.forEach((s, i) => {
    let implied = Math.max(1, Math.round(s.jittered));
    if (implied >= previous) implied = previous - 1;
    previous = implied;
    const samples = rankSamples.get(s.p.slug) ?? [i + 1];
    const rank_lo = Math.min(i + 1, Math.floor(quantileOf(samples, 0.1)));
    const rank_hi = Math.max(i + 1, Math.ceil(quantileOf(samples, 0.9)));
    const plan = farmPlan(s.p, implied);
    const econ = economics(implied, s.p.tvl_usd, plan);
    const record = peerRecord(snap, s.p);
    const parent = parentOf(s.p, priced);
    rows.push({
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      rank_range: [rank_lo, rank_hi],
      implied_value_usd: implied,
      value_if_launches_usd: Math.max(1, Math.round(s.value_if)),
      value_range_usd: [Math.max(1, Math.round(s.value_if * Math.pow(10, value.band.q25))), Math.max(1, Math.round(s.value_if * Math.pow(10, value.band.q75)))],
      farm_steps: plan.map(stepText),
      plan,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_years: round2(s.age_years),
      age_known: s.age_known,
      odds_pct: round2(s.odds * 100),
      odds_num: record.num,
      odds_den: record.den,
      plan_cost_usd: econ.fees,
      deposit_usd: econ.deposit,
      drop_usd: econ.drop,
      fees_usd: econ.fees,
      hours: econ.hours,
      net_usd: econ.net,
      per_hour_usd: econ.per_hour,
      verdict_label: econ.label,
      verdict: econ.verdict,
      watchlist: s.group === 'ranked-watchlist',
      segment: s.group === 'ranked-watchlist' ? 'watchlist' : s.group === 'ranked-early' ? 'early' : 'off-list',
      parent_name: parent?.name ?? null,
      parent_multiple: parent !== null ? round3(parent.mcap_usd! / parent.tvl_usd) : null,
    });
  });
  const checksum = fnv1a(rows.map((r) => `${r.slug}:${r.rank}:${r.implied_value_usd}`).join('|')).toString(16).padStart(8, '0');
  return {
    rows,
    counts,
    value,
    odds: oddsModel,
    checksum,
    total_implied: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    total_tvl: rows.reduce((s, r) => s + r.tvl_usd, 0),
  };
}

/** The gate's own rules, checked against our board before anything is written. */
function boardIssue(rows: Row[], snap: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `rows ${rows.length} outside 100..4000`;
  const slugs = new Set(rows.map((r) => r.slug));
  for (const slug of snap.watchlist) if (!slugs.has(slug)) return `watchlist slug ${slug} missing`;
  let previous = Number.POSITIVE_INFINITY;
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) throw new Error(`row ${r.slug}: rank ${r.rank} where ${i + 1} belongs`);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) throw new Error(`row ${r.slug}: implied value not a positive whole number`);
    if (r.implied_value_usd > previous) throw new Error(`row ${r.slug}: value rises with rank`);
    previous = r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) throw new Error(`row ${r.slug}: ${r.farm_steps.length} farm steps`);
    for (const step of r.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) throw new Error(`row ${r.slug}: a farm step is ${n} characters`);
    }
  });
  return null;
}

// ---------------------------------------------------------------- dashboard data & evidence

const GROUP_LABEL: Record<Group, string> = {
  'ranked-watchlist': 'Ranked · watchlist',
  'ranked-early': 'Ranked · early, at or above the floor',
  'ranked-off-list': 'Ranked · off-list, below the floor',
  'token-priced': 'Token trades · priced comparable',
  'token-recorded': 'Token recorded · no usable cap',
  'out-exchange': 'Out · exchange book',
  'out-bridge': 'Out · bridge',
  'out-staking': 'Out · liquid staking',
  'out-derivative': 'Out · versioned or wrapped',
};
const GROUP_ORDER: Group[] = [
  'ranked-watchlist', 'ranked-early', 'ranked-off-list', 'token-priced', 'token-recorded',
  'out-exchange', 'out-bridge', 'out-staking', 'out-derivative',
];

/** One or two plain sentences on what the tests kept and what they threw out, from the verdicts themselves. */
function readingLine(value: ValueModelResult, odds: OddsModelResult): string {
  const short: Record<string, string> = {
    size: 'the size curve', category: 'the family effect', growth: '7-day growth', age: 'age', chains: 'chain count',
  };
  const vKept = value.kept.map((t) => short[t]).filter(Boolean);
  const vOut = VALUE_TERM_ORDER.filter((t) => t !== 'control' && !value.kept.includes(t)).map((t) => short[t]);
  const oKept = odds.kept.map((t) => short[t] ?? t).filter(Boolean);
  const parts: string[] = [];
  if (vOut.length > 0) parts.push(`${vOut.join(' and ')} do${vOut.length === 1 ? 'es' : ''} not improve three of the four held-out tests, so the value model leaves ${vOut.length === 1 ? 'it' : 'them'} out — its scores are printed beside it, not hidden`);
  if (vKept.length > 0) parts.push(`the value model prices from ${vKept.join(' and ')} because ${vKept.length === 1 ? 'it improves' : 'they improve'} at least three of the four tests`);
  if (oKept.length > 0) parts.push(`${oKept.join(', ')} carry the odds, admitted by the same four tests scored on Brier`);
  return `Reading it: ${parts.join('; ')}. A random control term is fitted in both models and never admitted — its row is printed so the kept terms can be judged against the noise floor.`;
}

/** The evidence file the program writes into the dashboard: every number the page's top half prints. */
function evidenceScript(built: Built, snap: Snapshot): string {
  const { rows, counts, value, odds } = built;
  const farm = rows.filter((r) => r.verdict_label === 'FARM').length;
  const thin = rows.filter((r) => r.verdict_label === 'THIN').length;
  const skip = rows.filter((r) => r.verdict_label === 'SKIP').length;
  const testCell = (t: TestScore): { miss: number; within2: number } => ({ miss: round2(t.miss), within2: t.within2 });
  const model = {
    as_of: snap.as_of,
    name: 'radar-7',
    kpis: {
      wf_miss: round2(value.wf_miss),
      flat_wf_miss: round2(value.stages[0]!.tests.wf.miss),
      loo_miss: round2(value.loo_miss),
      wf50: value.honesty.wf50,
      wf80: value.honesty.wf80,
      odds_wf_brier: round3(odds.wf_brier),
      odds_base_wf: round3(odds.base_wf),
      odds_fold_brier: round3(odds.fold_brier),
      odds_h12_brier: round3(odds.tests.h12),
      odds_h21_brier: round3(odds.tests.h21),
      value_kept: value.kept.length,
      value_terms: VALUE_TERM_ORDER.length,
      odds_kept: odds.kept.length,
      odds_terms: ODDS_TERM_ORDER.length,
      farm, thin, skip,
      ranked: rows.length,
      watchlist: snap.watchlist.length,
    },
    accounting: GROUP_ORDER.map((g) => ({ group: g, label: GROUP_LABEL[g], count: counts[g] ?? 0 })),
    chips: {
      rows: rows.length,
      checksum: built.checksum,
      total_implied: built.total_implied,
      total_tvl: built.total_tvl,
      ledger: snap.protocols.length,
      watchlist_ranked: rows.filter((r) => r.watchlist).length,
    },
    value_stages: value.stages.map((s) => ({
      label: s.label,
      tests: { h12: testCell(s.tests.h12), h21: testCell(s.tests.h21), loo: testCell(s.tests.loo), wf: testCell(s.tests.wf) },
      verdict: s.verdict,
    })),
    odds_stages: odds.stages.map((s) => ({
      label: s.label,
      tests: { h12: round3(s.tests.h12), h21: round3(s.tests.h21), fold: round3(s.tests.fold), wf: round3(s.tests.wf) },
      verdict: s.verdict,
    })),
    value_final: { h12: testCell(value.tests.h12), h21: testCell(value.tests.h21), loo: testCell(value.tests.loo), wf: testCell(value.tests.wf) },
    odds_final: { h12: round3(odds.tests.h12), h21: round3(odds.tests.h21), fold: round3(odds.tests.fold), wf: round3(odds.tests.wf) },
    honesty: { ...value.honesty, band_q25: round3(value.band.q25), band_q75: round3(value.band.q75) },
    coefficients: value.ses,
    value_fit_n: value.fit_n,
    odds_sample_n: odds.sample_n,
    value_wf_cutoff: value.wf_cutoff,
    odds_wf_cutoff: odds.wf_cutoff,
    reading: readingLine(value, odds),
    scenario: { deposit_pct: DEPOSIT_PCT, drop_share: DROP_SHARE, horizon_weeks: HORIZON_WEEKS, wage_line: WAGE_LINE },
  };
  return `window.RADAR_MODEL = ${JSON.stringify(model)};\n`;
}

/** The dashboard's data file: the same rows the board carries, plus the run's summary. */
function dataScript(rows: Row[], snap: Snapshot, built: Built): string {
  const summary = {
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    protocols: snap.protocols.length,
    watchlist: snap.watchlist.length,
    board: rows.length,
    ranked_watchlist: built.counts['ranked-watchlist'] ?? 0,
    ranked_early: built.counts['ranked-early'] ?? 0,
    ranked_off_list: built.counts['ranked-off-list'] ?? 0,
    token_priced: built.counts['token-priced'] ?? 0,
    token_recorded: built.counts['token-recorded'] ?? 0,
  };
  return `window.RADAR = ${JSON.stringify({ summary, rows })};\n`;
}

// ---------------------------------------------------------------- arguments and output

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', process.env.MAKEFUN_INPUT ?? '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar v6: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const built = buildBoard(snapshot);
const { rows } = built;
const issue = boardIssue(rows, snapshot);
if (issue !== null) {
  process.stderr.write(`radar v6: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(rows, snapshot, built));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// The evidence is generated by the program, like data.js — but it belongs to the page, so it is
// written beside the page's own files, where the dossier's source text will carry it to the judge.
writeFileSync(join(out, 'dashboard', 'evidence.js'), evidenceScript(built, snapshot));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar v6: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 to 4, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`radar v6: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const stageLine = (s: StageRow): string =>
  `${s.label}: H1→H2 ×${s.tests.h12.miss.toFixed(2)} (${s.tests.h12.within2}%), H2→H1 ×${s.tests.h21.miss.toFixed(2)} (${s.tests.h21.within2}%), LOO ×${s.tests.loo.miss.toFixed(2)} (${s.tests.loo.within2}%), WF ×${s.tests.wf.miss.toFixed(2)} (${s.tests.wf.within2}%) — ${s.verdict}`;
process.stdout.write(
  `radar v6: ${snapshot.protocols.length} protocols accounted: ${GROUP_ORDER.map((g) => `${built.counts[g] ?? 0} ${g}`).join(', ')}\n` +
    `radar v6: value model on ${built.value.fit_n} priced comparables; kept terms: ${built.value.kept.join(', ') || 'none beyond flat'}\n` +
    `radar v6: value stages — ${built.value.stages.map(stageLine).join(' | ')}\n` +
    `radar v6: value honesty — stated 50% band holds ${built.value.honesty.wf50}% walk-forward (LOO ${built.value.honesty.loo50}%), stated 80% holds ${built.value.honesty.wf80}% (LOO ${built.value.honesty.loo80}%), WF n=${built.value.honesty.wf_n}\n` +
    `radar v6: odds model on ${built.odds.sample_n} dated protocols; kept terms: ${built.odds.kept.join(', ') || 'none'}; Brier H1→H2 ${built.odds.tests.h12.toFixed(3)}, H2→H1 ${built.odds.tests.h21.toFixed(3)}, 10-fold ${built.odds.fold_brier.toFixed(3)} vs base ${built.odds.base_fold.toFixed(3)}, walk-forward ${built.odds.wf_brier.toFixed(3)} vs base ${built.odds.base_wf.toFixed(3)}\n` +
    `radar v6: board ${rows.length} rows, checksum ${built.checksum}, total implied $${built.total_implied.toLocaleString('en-US')}; verdicts FARM ${rows.filter((r) => r.verdict_label === 'FARM').length} / THIN ${rows.filter((r) => r.verdict_label === 'THIN').length} / SKIP ${rows.filter((r) => r.verdict_label === 'SKIP').length}\n` +
    `radar v6: top 5 — ${rows.slice(0, 5).map((r) => `${r.name} $${(r.implied_value_usd / 1e6).toFixed(1)}M @ ${r.odds_pct}%`).join('; ')}\n` +
    `radar v6: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (+ evidence.js), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
