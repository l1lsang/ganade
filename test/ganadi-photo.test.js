import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  getRandomGanadiPhoto,
  listGanadiPhotos,
  selectRandomGanadiPhoto
} from '../src/ganadi-photo.js';

test('src/ㄱㄴㄷ 폴더에서 지원하는 가나디 사진을 찾는다', async () => {
  const photos = await listGanadiPhotos();
  assert.ok(photos.length > 0);
  assert.ok(photos.every((photo) => ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(
    path.extname(photo.name).toLowerCase()
  )));
});

test('가나디 사진 목록에서 임의의 한 장을 선택한다', async () => {
  const photos = [
    { name: 'first.jpg', path: 'first.jpg' },
    { name: 'second.jpg', path: 'second.jpg' },
    { name: 'third.jpg', path: 'third.jpg' }
  ];

  assert.equal(selectRandomGanadiPhoto(photos, () => 0).name, 'first.jpg');
  assert.equal(selectRandomGanadiPhoto(photos, () => 0.9999).name, 'third.jpg');
  assert.equal(selectRandomGanadiPhoto([], () => 0), null);

  const selected = await getRandomGanadiPhoto(() => 0);
  assert.ok(selected?.name);
});
