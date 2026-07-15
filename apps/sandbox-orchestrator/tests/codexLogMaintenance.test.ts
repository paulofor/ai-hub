import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { maintainCodexSqliteLogs } from '../src/codexLogMaintenance.js';

const silentLogger = { info() {}, warn() {} };

test('rotaciona logs_2.sqlite e arquivos WAL/SHM quando excedem limite', async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-log-maintenance-'));
  try {
    await fs.writeFile(path.join(codexHome, 'logs_2.sqlite'), '1234567890');
    await fs.writeFile(path.join(codexHome, 'logs_2.sqlite-wal'), 'wal');
    await fs.writeFile(path.join(codexHome, 'logs_2.sqlite-shm'), 'shm');

    const result = await maintainCodexSqliteLogs({
      codexHome,
      maxBytes: 5,
      keepRotated: 2,
      logger: silentLogger,
      now: new Date('2026-07-15T14:30:00Z'),
    });

    assert.equal(result.rotated, true);
    assert.equal(result.sizeBytes, 10);
    assert.deepEqual(
      result.rotatedFiles.map((file) => path.basename(file)).sort(),
      [
        'logs_2.sqlite-shm.20260715T143000Z',
        'logs_2.sqlite-wal.20260715T143000Z',
        'logs_2.sqlite.20260715T143000Z',
      ].sort(),
    );
    await assert.rejects(fs.stat(path.join(codexHome, 'logs_2.sqlite')), /ENOENT/);
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});

test('mantém logs_2.sqlite quando está abaixo do limite', async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-log-maintenance-'));
  try {
    await fs.writeFile(path.join(codexHome, 'logs_2.sqlite'), '12345');

    const result = await maintainCodexSqliteLogs({
      codexHome,
      maxBytes: 10,
      logger: silentLogger,
    });

    assert.equal(result.rotated, false);
    assert.equal(result.sizeBytes, 5);
    assert.equal(await fs.readFile(path.join(codexHome, 'logs_2.sqlite'), 'utf8'), '12345');
  } finally {
    await fs.rm(codexHome, { recursive: true, force: true });
  }
});
