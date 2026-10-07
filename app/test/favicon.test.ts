import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const svg = await fs.readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8');

test('index.html links the Waypoint SVG favicon', () => {
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon.svg">/);
});

test('favicon recreates the sidebar brand mark as an outlined blue diamond', () => {
  assert.match(svg, /<rect [^>]*fill="none"[^>]*transform="rotate\(45 16 16\)"/);
  assert.match(svg, /stroke: #5ea8f9/);
  assert.match(svg, /prefers-color-scheme: light/);
});
