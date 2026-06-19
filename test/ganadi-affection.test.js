import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const affectionDataPath = path.join(os.tmpdir(), `ganadi-affection-test-${process.pid}.json`);
process.env.GANADI_AFFECTION_DATA_PATH = affectionDataPath;

const affection = await import(`../src/ganadi-affection.js?test=${Date.now()}`);

test('호감도는 개인별 50에서 시작해 대화마다 올라가고 120에서 멈춘다', async () => {
  const initial = await affection.getGanadiAffection('guild-1', 'user-1');
  assert.equal(initial.score, 50);
  assert.equal(initial.interactions, 0);

  const afterReply = await affection.addGanadiAffection('guild-1', 'user-1', 1, {
    username: 'tester',
    displayName: '테스터'
  });
  assert.equal(afterReply.score, 51);
  assert.equal(afterReply.interactions, 1);
  assert.equal(afterReply.displayName, '테스터');

  const maximum = await affection.addGanadiAffection('guild-1', 'user-1', 1000);
  assert.equal(maximum.score, 120);
  assert.equal(maximum.interactions, 2);

  const anotherUser = await affection.getGanadiAffection('guild-1', 'user-2');
  const anotherGuild = await affection.getGanadiAffection('guild-2', 'user-1');
  assert.equal(anotherUser.score, 50);
  assert.equal(anotherGuild.score, 50);

  await rm(affectionDataPath, { force: true });
});

test('호감도 단계와 진행 바를 만든다', () => {
  assert.equal(affection.getGanadiAffectionTier(50).name, '첫 만남부터 호감');
  assert.equal(affection.getGanadiAffectionTier(90).name, '소중한 친구');
  assert.equal(affection.getGanadiAffectionTier(120).name, '영원한 단짝');
  assert.equal(affection.buildGanadiAffectionBar(50, 12), '▰▰▰▰▰▱▱▱▱▱▱▱');
  assert.equal(affection.buildGanadiAffectionBar(120, 12), '▰▰▰▰▰▰▰▰▰▰▰▰');
});

test('/가나디 호감도 명령어를 제공한다', async () => {
  const { buildCommands, commandNames } = await import('../src/commands.js');
  const command = buildCommands().find((entry) => entry.name === commandNames.ganadi);
  assert.ok(command);
  assert.equal(command.options[0].name, '호감도');
  assert.equal(command.options[0].options[0].name, '유저');
});
