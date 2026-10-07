import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [podView, setup] = await Promise.all([
  fs.readFile(new URL('../src/views/PodView.tsx', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/views/PodSeatSetup.tsx', import.meta.url), 'utf8'),
]);

test('PodView includes the real seat setup module without exposing raw implementation details', () => {
  assert.match(podView, /<PodSeatSetup pod=\{pod\} selectedSeatId=\{selected\?\.id \|\| ''\}/);
  const combined = `${podView}\n${setup}`;
  for (const forbidden of ['instanceDir', 'profileDir', 'profilesDir', 'dockerPlan', 'docker exec', 'container command']) {
    assert.equal(combined.includes(forbidden), false, forbidden);
  }
});

test('seat setup actions are explicit and explain inherited provider connections', () => {
  assert.match(setup, /Start pod/);
  assert.match(setup, /Prepare seat/);
  assert.match(setup, /Save model/);
  assert.match(setup, /Connect Claude OAuth/);
  assert.match(setup, /Connect Codex device/);
  assert.match(setup, /Use an OpenAI API key for this seat/);
  assert.match(setup, /provider === 'anthropic'/);
  assert.match(setup, /provider === 'openai-codex'/);
  assert.match(setup, /provider === 'openai-api'/);
  assert.match(setup, /Save API key/);
  assert.match(setup, /Pods share the CEO provider connections/);
  assert.match(setup, /connect a missing provider in Settings/);
  assert.match(setup, /Each seat needs a model and its own provider connection/);
  assert.doesNotMatch(setup, /useEffect\(\(\) => \{[^}]*podLifecycle/s);
  assert.doesNotMatch(setup, /useEffect\(\(\) => \{[^}]*provisionPodSeats/s);
  assert.doesNotMatch(setup, /useEffect\(\(\) => \{[^}]*startSeatLogin/s);
});

test('dry-run previews do not claim success and config loads independently of readiness', () => {
  assert.match(setup, /const cfg = await api\.config\(\)\.catch\(\(\) => null\)/);
  assert.match(setup, /setConfig\(cfg\)/);
  assert.match(setup, /isPreviewOnly\(result\)/);
  assert.match(setup, /Preview only, no pod\/seat changed\./);
  assert.equal(setup.includes('finished.`'), false);
});

test('provider connection is gated on the applied configured model provider', () => {
  assert.match(setup, /selectedStatus\?\.model\?\.state === 'configured'/);
  assert.match(setup, /draftMatchesApplied/);
  assert.match(setup, /canConnectProvider/);
  assert.match(setup, /connectionProvider \? authProviders\[connectionProvider\]/);
  assert.match(setup, /disabled=\{Boolean\(busy\) \|\| !canConnectProvider \|\| providerConnection\?\.authenticated\}/);
  assert.match(setup, /disabled=\{!canUseApiKey \|\| apiKey\.length < 8/);
  assert.match(setup, /Save the selected model and prepare the seat before connecting a provider/);
});

test('transient secrets and codes are cleared, code is masked, and login polling keeps cancelling visible', () => {
  assert.match(setup, /setApiKey\(''\)/);
  assert.match(setup, /setCode\(''\)/);
  assert.match(setup, /input type="password" value=\{code\}/);
  assert.match(setup, /login\.state === 'pending' \|\| login\.state === 'cancelling'/);
  assert.match(setup, /LOGIN_MAX_POLLS/);
  assert.match(setup, /window\.setTimeout/);
  assert.match(setup, /clearLoginPoll/);
  assert.match(setup, /next\.message \|\| 'Connection started\.'/);
  assert.match(setup, /\{login\.message &&/);
  assert.match(setup, /next\.state === 'authorized'/);
  assert.match(setup, /void refreshStatus\(\)/);
});
