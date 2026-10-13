import test from 'node:test';
import assert from 'node:assert/strict';
import type { UsageDay } from '../src/api.ts';
import { barStep, barsFor, compactNumber, costLine, dayDate, memoryUsed, rangeStart, todayIndex, totalsFor } from '../src/usageModel.ts';

const day = (d: number, over: Partial<UsageDay> = {}): UsageDay => ({ day: d, tasks: 0, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, costSessions: 0, costUnknown: 0, agents: {}, ...over });

test('today index follows the local calendar day', () => {
  const back = dayDate(todayIndex(new Date(2026, 9, 13, 23, 30)));
  assert.deepEqual([back.getFullYear(), back.getMonth(), back.getDate()], [2026, 9, 13]);
});

test('ranges start where expected and all time reaches the first day', () => {
  const today = 20000;
  const days = [day(today - 100, { tasks: 1 })];
  assert.equal(rangeStart(days, today, 7), today - 6);
  assert.equal(rangeStart(days, today, 30), today - 29);
  assert.equal(rangeStart(days, today, 'all'), today - 100);
  assert.equal(rangeStart([], today, 'all'), today - 6);
});

test('bars are daily for short ranges and weekly or monthly for long ones', () => {
  assert.equal(barStep(7), 1);
  assert.equal(barStep(60), 1);
  assert.equal(barStep(200), 7);
  assert.equal(barStep(800), 30);
  const today = 20000;
  const days = [day(today, { tasks: 2, input: 5 }), day(today - 3, { output: 7 }), day(today - 9, { tasks: 9 })];
  const week = barsFor(days, today, 7);
  assert.equal(week.length, 7);
  assert.equal(week[6].tasks, 2);
  assert.equal(week[3].tokens, 7);
  assert.equal(week.reduce((n, b) => n + b.tasks, 0), 2);
});

test('bar sums match the range totals for every range', () => {
  const today = 20000;
  const days = Array.from({ length: 400 }, (_, i) => day(today - i, { tasks: i % 3, input: i, output: 1, sessions: 1, agents: { ceo: i + 1 } }));
  for (const range of [7, 30, 'all'] as const) {
    const bars = barsFor(days, today, range);
    const totals = totalsFor(days, today, range);
    assert.equal(bars.reduce((n, b) => n + b.tasks, 0), totals.tasks, `tasks ${range}`);
    assert.equal(bars.reduce((n, b) => n + b.tokens, 0), totals.tokens, `tokens ${range}`);
    assert.equal(bars[bars.length - 1].end, today);
  }
});

test('range totals only include days in range and rank agents', () => {
  const today = 20000;
  const days = [day(today, { tasks: 2, input: 10, sessions: 1, agents: { ceo: 10 } }), day(today - 6, { output: 50, sessions: 1, agents: { builder: 50 } }), day(today - 7, { tasks: 9, input: 999 })];
  const week = totalsFor(days, today, 7);
  assert.equal(week.tasks, 2);
  assert.equal(week.tokens, 60);
  assert.deepEqual(week.agents.map(a => a.id), ['builder', 'ceo']);
  assert.equal(totalsFor(days, today, 30).tasks, 11);
});

test('cost shows only for API-key billing and never as $0', () => {
  const sub = { billing: { apiKey: false, subscription: true, providers: [] } };
  const key = { billing: { apiKey: true, subscription: false, providers: ['anthropic'] } };
  assert.equal(costLine(sub, { cost: 3, costSessions: 1, costUnknown: 0 }), null);
  assert.equal(costLine(key, { cost: 0, costSessions: 0, costUnknown: 0 }), null);
  assert.equal(costLine(key, { cost: 0, costSessions: 2, costUnknown: 0 }), null);
  assert.equal(costLine(key, { cost: 1.234, costSessions: 2, costUnknown: 0 }), 'About $1.23 on API keys');
  assert.equal(costLine(key, { cost: 0.004, costSessions: 1, costUnknown: 0 }), 'Under $0.01 on API keys');
  assert.match(costLine(key, { cost: 2, costSessions: 1, costUnknown: 1 })!, /some runs had no price/);
  assert.match(costLine(key, { cost: 0, costSessions: 0, costUnknown: 1 })!, /unavailable/);
});

test('numbers compact and memory size matches Hermes delimiter', () => {
  assert.equal(compactNumber(999), '999');
  assert.equal(compactNumber(1500), '1.5K');
  assert.equal(compactNumber(17961024), '18M');
  assert.equal(memoryUsed(['ab', ' ', 'cd']), 'ab\n§\ncd'.length);
  assert.equal(memoryUsed([]), 0);
});
