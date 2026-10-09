import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helperDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docker', 'auth-image');
const python = ['python3', 'python'].find((bin) => spawnSync(bin, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'], { stdio: 'ignore' }).status === 0);

async function fakeBridge(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      calls.push({ auth: req.headers.authorization, ...parsed });
      const [status, reply] = handler(parsed);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { calls, url: `http://127.0.0.1:${server.address().port}/bridge/tools`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function seatHome(url, file = 'messaging.json') {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-gh-home-'));
  await fs.mkdir(path.join(home, 'waypoint'));
  await fs.writeFile(path.join(home, 'waypoint', file), JSON.stringify({ baseUrl: url, token: 'seat-token' }));
  return home;
}

function run(args, { home, input = '' }) {
  return new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(python, [path.join(helperDir, 'waypoint_github.py'), ...args], { env: { ...process.env, HERMES_HOME: home, PYTHONDONTWRITEBYTECODE: '1' } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    });
  });
}

test('git credential helper asks Waypoint for a token scoped to the requested repository', { skip: !python }, async () => {
  const bridge = await fakeBridge(({ args }) => [200, { repo: args.repo, token: 'ghs_scoped', expiresAt: 'later' }]);
  try {
    const home = await seatHome(bridge.url);
    const result = await run(['credential', 'get'], { home, input: 'protocol=https\nhost=github.com\npath=acme/site.git\n' });
    assert.equal(result.stdout, 'username=x-access-token\npassword=ghs_scoped\n'.replaceAll('\n', os.EOL));
    assert.deepEqual(bridge.calls, [{ auth: 'Bearer seat-token', tool: 'github_token', args: { repo: 'acme/site' } }]);
    const other = await run(['credential', 'get'], { home, input: 'protocol=https\nhost=gitlab.com\npath=acme/site.git\n' });
    assert.equal(other.stdout, '');
    assert.equal(bridge.calls.length, 1);
  } finally { await bridge.close(); }
});

test('a refused token surfaces Waypoint\'s message, and the CEO uses its bridge credential', { skip: !python }, async () => {
  const bridge = await fakeBridge(() => [403, { error: { message: 'This seat has no GitHub access. Add it to a project\'s GitHub seats in Waypoint.' } }]);
  try {
    const home = await seatHome(bridge.url, 'bridge.json');
    const result = await run(['credential', 'get'], { home, input: 'protocol=https\nhost=github.com\npath=acme/site\n' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Waypoint: This seat has no GitHub access/);
    assert.equal(bridge.calls[0].auth, 'Bearer seat-token');
  } finally { await bridge.close(); }
});

test('gh shim finds the repository from flags, API paths, and repo commands', { skip: !python }, () => {
  const probe = `import json,sys; sys.path.insert(0, ${JSON.stringify(helperDir)}); import waypoint_github as w; w.origin_repo = lambda: 'from/origin'; print(json.dumps([w.gh_repo(a) for a in json.loads(sys.argv[1])]))`;
  const cases = [['issue', 'create', '-R', 'acme/site'], ['pr', 'list', '--repo=https://github.com/acme/site.git'], ['api', 'repos/acme/site/pulls'], ['repo', 'clone', 'acme/site'], ['pr', 'create', '--fill'], ['issue', 'list', '-Racme/site']];
  const out = spawnSync(python, ['-B', '-c', probe, JSON.stringify(cases)], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), ['acme/site', 'acme/site', 'acme/site', 'acme/site', 'from/origin', 'acme/site']);
});
