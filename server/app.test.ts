import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getDefaultDistDir } from './app.js';

test('default dist directory is resolved relative to the server entrypoint', () => {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const expectedDistDir = path.resolve(serverDir, '../../dist');

  assert.equal(getDefaultDistDir(), expectedDistDir);
});
