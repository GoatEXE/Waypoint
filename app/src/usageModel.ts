import type { UsageDay, UsageReport } from './api';

export type UsageRange = 7 | 30 | 'all';

export interface UsageBar { start: number; end: number; tasks: number; tokens: number }

const DAY_MS = 86400000;

export function dayTokens(d: UsageDay): number {
  return d.input + d.output + d.cacheRead + d.cacheWrite;
}

export function todayIndex(now: Date = new Date()): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / DAY_MS);
}

export function dayDate(day: number): Date {
  const d = new Date(day * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function rangeStart(days: UsageDay[], today: number, range: UsageRange): number {
  if (range !== 'all') return today - range + 1;
  const first = days.reduce((min, d) => Math.min(min, d.day), today);
  return Math.min(first, today - 6);
}

export function barStep(span: number): 1 | 7 | 30 {
  return span <= 60 ? 1 : span <= 371 ? 7 : 30;
}

export function barsFor(days: UsageDay[], today: number, range: UsageRange): UsageBar[] {
  const from = rangeStart(days, today, range);
  const step = barStep(today - from + 1);
  const bars: UsageBar[] = [];
  for (let end = today; end >= from; end -= step) bars.unshift({ start: Math.max(from, end - step + 1), end, tasks: 0, tokens: 0 });
  for (const d of days) {
    if (d.day < from || d.day > today) continue;
    const bar = bars.find(b => d.day >= b.start && d.day <= b.end);
    if (bar) { bar.tasks += d.tasks; bar.tokens += dayTokens(d); }
  }
  return bars;
}

export interface UsageTotals { tasks: number; tokens: number; input: number; output: number; cache: number; sessions: number; cost: number; costSessions: number; costUnknown: number; activeDays: number; agents: { id: string; tokens: number }[] }

export function totalsFor(days: UsageDay[], today: number, range: UsageRange): UsageTotals {
  const from = rangeStart(days, today, range);
  const t: UsageTotals = { tasks: 0, tokens: 0, input: 0, output: 0, cache: 0, sessions: 0, cost: 0, costSessions: 0, costUnknown: 0, activeDays: 0, agents: [] };
  const agents = new Map<string, number>();
  for (const d of days) {
    if (d.day < from || d.day > today) continue;
    const tokens = dayTokens(d);
    t.tasks += d.tasks; t.tokens += tokens; t.input += d.input; t.output += d.output; t.cache += d.cacheRead + d.cacheWrite;
    t.sessions += d.sessions; t.cost += d.cost; t.costSessions += d.costSessions; t.costUnknown += d.costUnknown;
    if (tokens || d.tasks) t.activeDays++;
    for (const [id, n] of Object.entries(d.agents)) agents.set(id, (agents.get(id) || 0) + n);
  }
  t.agents = [...agents].map(([id, tokens]) => ({ id, tokens })).sort((a, b) => b.tokens - a.tokens);
  return t;
}

export function compactNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function costLine(report: Pick<UsageReport, 'billing'>, t: Pick<UsageTotals, 'cost' | 'costSessions' | 'costUnknown'>): string | null {
  if (!report.billing.apiKey) return null;
  if (!t.costSessions || t.cost <= 0) return t.costUnknown ? 'API-key cost unavailable for this range (no price for the model)' : null;
  const dollars = t.cost < 0.01 ? 'Under $0.01' : `About $${t.cost.toFixed(t.cost < 10 ? 2 : 0)}`;
  return t.costUnknown ? `${dollars} on API keys (some runs had no price)` : `${dollars} on API keys`;
}

export function memoryUsed(entries: string[]): number {
  const kept = entries.map(e => e.trim()).filter(Boolean);
  return kept.length ? kept.join('\n§\n').length : 0;
}
