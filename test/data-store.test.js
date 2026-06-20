import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJsonDataStore } from '../src/data-store.js';

const localPath = path.join(os.tmpdir(), `data-store-test-${process.pid}.json`);
const store = createJsonDataStore({
  name: 'test-store',
  localPath,
  forceLocal: true
});

test.after(async () => {
  await rm(localPath, { force: true });
});

test('공통 저장소의 명시적 로컬 모드는 JSON을 읽고 쓴다', async () => {
  assert.deepEqual(await store.read(), {});

  const saved = {
    guild: {
      score: 123,
      nested: { enabled: true },
      ignored: undefined
    }
  };
  await store.write(saved);

  assert.deepEqual(await store.read(), {
    guild: {
      score: 123,
      nested: { enabled: true }
    }
  });
});
