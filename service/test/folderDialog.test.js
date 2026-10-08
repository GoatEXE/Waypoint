import test from 'node:test';
import assert from 'node:assert/strict';
import { FolderDialog, pickerCommand } from '../src/folderDialog.js';

test('windows picker runs an encoded STA PowerShell script with the start folder', () => {
  const { command, args } = pickerCommand('win32', "E:\\Repos\\it's here");
  assert.equal(command, 'powershell.exe');
  assert.ok(args.includes('-STA'));
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes('dialog.SetOptions(options | 0x20 | 0x40 | 0x800)'));
  assert.ok(script.endsWith("-Start 'E:\\Repos\\it''s here'"));
  assert.equal(pickerCommand('darwin', '/Users/me').command, 'osascript');
  assert.equal(pickerCommand('linux', '').command, 'zenity');
});

test('pick returns the chosen folder, treats empty output as cancel, and allows one picker at a time', async () => {
  let release;
  const outputs = ['#< CLIXML\r\n<Objs/>\r\nE:\\Repositories\\goat-ops\r\n', '', 'C:\\'];
  const dialog = new FolderDialog({ platform: 'win32', runner: () => new Promise((resolve) => { release = () => resolve({ code: 0, stdout: outputs.shift() }); }) });
  const first = dialog.pick({ start: 'relative/ignored' });
  await assert.rejects(dialog.pick(), /already open/);
  release();
  assert.deepEqual(await first, { path: 'E:\\Repositories\\goat-ops', cancelled: false });
  const second = dialog.pick(); release();
  assert.deepEqual(await second, { path: null, cancelled: true });
  const third = dialog.pick(); release();
  assert.deepEqual(await third, { path: 'C:\\', cancelled: false });
  const failing = new FolderDialog({ platform: 'linux', runner: async () => ({ code: 127, stdout: '' }) });
  await assert.rejects(failing.pick(), /could not be opened/);
});
