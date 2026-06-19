import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const levelDataPath = path.join(os.tmpdir(), `babo-level-test-${process.pid}.json`);
process.env.LEVEL_DATA_PATH = levelDataPath;
process.env.LEVEL_CHAT_XP_PER_CHARACTER = '1';
process.env.LEVEL_VOICE_XP_PER_MINUTE = '10';
process.env.LEVEL_XP_STEP = '250';

const levels = await import(`../src/level-system.js?test=${Date.now()}`);

test('채팅 글자수와 음성 체류 시간을 레벨 및 랭킹에 반영한다', async () => {
  assert.equal(levels.countMessageCharacters('가 나다\n 라'), 4);

  await levels.recordChatActivity('guild', 'user', '가 나다', {
    username: 'tester',
    displayName: '테스터'
  });
  levels.startVoiceSession('guild', 'user', {}, 1_000);
  await levels.endVoiceSession('guild', 'user', 121_000);

  const stats = await levels.getUserLevelStats('guild', 'user', 121_000);
  assert.equal(stats.chatCharacters, 3);
  assert.equal(stats.voiceSeconds, 120);
  assert.equal(stats.voiceXp, 20);
  assert.equal(stats.totalXp, 23);
  assert.equal(stats.level, 1);

  const voiceRanking = await levels.getLevelRanking('guild', 'voice', 10, 121_000);
  assert.equal(voiceRanking[0].userId, 'user');
  assert.equal(voiceRanking[0].rank, 1);

  await rm(levelDataPath, { force: true });
});

test('관리 UI의 내장 스크립트와 랭킹 마크업이 유효하다', async () => {
  const { buildAdminHtml } = await import('../src/health-server.js');
  const html = buildAdminHtml();
  const scriptStart = html.indexOf('<script>') + '<script>'.length;
  const scriptEnd = html.lastIndexOf('</script>');

  assert.ok(scriptStart >= '<script>'.length);
  assert.ok(scriptEnd > scriptStart);
  assert.doesNotThrow(() => new vm.Script(html.slice(scriptStart, scriptEnd)));
  assert.match(html, /id="rankingPanel"/);
  assert.match(html, /data-ranking-type="voice"/);
  assert.match(html, /id="rankingBody"/);
  assert.match(html, /id="selfIntroductionForm"/);
  assert.match(html, /\/self-introduction/);
});
