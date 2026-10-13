import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_KEY, applyTheme, cleanTheme, readTheme } from '../src/theme.ts';

test('theme defaults to dark and only accepts light or dark', () => {
  assert.equal(cleanTheme(undefined), 'dark');
  assert.equal(cleanTheme('neon'), 'dark');
  assert.equal(cleanTheme('light'), 'light');
  assert.equal(readTheme(null), 'dark');
  assert.equal(readTheme({ getItem: () => { throw new Error('blocked'); } }), 'dark');
});

test('applying a theme sets the root attribute and persists it', () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v); } };
  const root = { dataset: {} as DOMStringMap };
  applyTheme('light', root, storage);
  assert.equal(root.dataset.theme, 'light');
  assert.equal(stored.get(THEME_KEY), 'light');
  assert.equal(readTheme(storage), 'light');
  applyTheme('dark', root, storage);
  assert.equal(readTheme(storage), 'dark');
});
