import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { guardDockerExecArgs, guardPrompt, HOST_DISCONNECT_GUARD_SCRIPT } from '../src/hostDisconnectGuard.js';

const linuxPython = process.platform === 'linux' && spawnSync('python3', ['--version']).status === 0;

test('guard passes the prompt through stdin and preserves the Hermes command', () => {
  const prompt = 'hello\nprivate input';
  const args = guardDockerExecArgs(['exec', '-i', '--user', 'hermes', 'owned-pod', 'timeout', '60s', 'hermes', 'chat']);
  assert.deepEqual(args.slice(0, 9), ['exec', '-i', '--user', 'hermes', 'owned-pod', 'python3', '-u', '-c', HOST_DISCONNECT_GUARD_SCRIPT]);
  assert.deepEqual(args.slice(9), ['timeout', '60s', 'hermes', 'chat']);
  assert.equal(JSON.stringify(args).includes(prompt), false);
  assert.deepEqual(JSON.parse(guardPrompt(prompt)), { prompt });
  assert.throws(() => guardDockerExecArgs(['exec', 'owned-pod', 'hermes']), /Hermes docker exec/);
});

test('guard relays a normal child result and exits', { skip: !linuxPython }, async () => {
  const child = spawn('python3', ['-u', '-c', HOST_DISCONNECT_GUARD_SCRIPT, 'python3', '-u', '-c', 'import sys; print(sys.stdin.read(), flush=True)'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stdin.write(guardPrompt('normal result'));
  const code = await new Promise((resolve) => child.once('close', resolve));
  assert.equal(code, 0);
  assert.equal(output.trim(), 'normal result');
});

test('guard terminates an active child group when its host stdin closes', { skip: !linuxPython }, async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'waypoint-host-guard-'));
  const pidFile = path.join(folder, 'child.pid');
  const script = `import os,pathlib,sys,time\npathlib.Path(${JSON.stringify(pidFile)}).write_text(str(os.getpid()))\nprint('ready',flush=True)\nsys.stdin.read()\nwhile True: time.sleep(1)\n`;
  const child = spawn('python3', ['-u', '-c', HOST_DISCONNECT_GUARD_SCRIPT, 'python3', '-u', '-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { if (String(chunk).includes('ready')) resolve(); });
      child.once('error', reject);
    });
    child.stdin.write(guardPrompt('start'));
    await ready;
    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    child.stdin.end();
    const code = await Promise.race([
      new Promise((resolve) => child.once('close', resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('guard did not stop after stdin EOF')), 4000)),
    ]);
    assert.notEqual(code, 0);
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    assert.ok(!stat || stat.split(' ')[2] === 'Z');
  } finally {
    child.kill('SIGKILL');
    await fs.rm(folder, { recursive: true, force: true });
  }
});
