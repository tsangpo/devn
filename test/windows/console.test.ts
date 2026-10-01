import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fixture } from '../helpers';
import { testPlatform } from '../platform';

describe('Windows attached console', { skip: testPlatform.posix }, () => {
  test('Ctrl+C reaches the child once and allows it to continue before normal exit', async t => {
    const f = fixture(t); f.init('a');
    assert.equal(f.run(['profile', 'use', 'a']).status, 0);
    testPlatform.writeExecutable(path.join(f.bin, 'claude'), `
let count = 0;
process.on('SIGINT', () => console.log('INTERRUPTED_' + ++count));
process.stdin.on('data', data => { if (data.toString().includes('done')) process.exit(count === 1 ? 7 : 90); });
console.log('CLIENT_READY');
setInterval(() => {}, 1000);
`);
    let output = '', interrupted = false, finished = false;
    const child = Bun.spawn([process.execPath, path.join(f.repo, 'bin/devn'), 'claude'], {
      env: f.env, cwd: f.project,
      terminal: { cols: 120, rows: 40, data(terminal, data) {
        output += new TextDecoder().decode(data);
        if (!interrupted && output.includes('CLIENT_READY')) { interrupted = true; terminal.write('\x03'); }
        if (!finished && output.includes('INTERRUPTED_1')) { finished = true; terminal.write('done\r'); }
      } },
    });
    const timer = setTimeout(() => child.kill(), 60000);
    try {
      assert.equal(await child.exited, 7, output);
      assert.equal(interrupted, true); assert.equal(finished, true);
      assert.ok(!output.includes('INTERRUPTED_2'), output);
    } finally { clearTimeout(timer); child.kill(); child.terminal?.close(); }
  });
});
