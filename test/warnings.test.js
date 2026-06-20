import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const warningDataPath = path.join(os.tmpdir(), `warnings-test-${process.pid}.json`);
process.env.DATA_STORAGE_DRIVER = 'local';
process.env.WARNING_DATA_PATH = warningDataPath;

const warnings = await import(`../src/warnings.js?test=${Date.now()}`);

test.after(async () => {
  await rm(warningDataPath, { force: true });
});

test('서버별 경고 로그 채널을 설정하고 해제한다', async () => {
  assert.equal((await warnings.getWarningConfig('guild-1')).logChannelId, null);

  const configured = await warnings.setWarningLogChannel(
    'guild-1',
    'moderator-1',
    'channel-1'
  );
  assert.equal(configured.logChannelId, 'channel-1');
  assert.equal((await warnings.getWarningConfig('guild-1')).logChannelId, 'channel-1');

  const issued = await warnings.addWarning(
    'guild-1',
    'user-1',
    'moderator-1',
    '테스트 경고 사유'
  );
  assert.equal(issued.event.moderatorId, 'moderator-1');
  assert.equal(issued.event.userId, 'user-1');
  assert.equal(issued.event.reason, '테스트 경고 사유');

  const history = await warnings.getWarningHistory('guild-1');
  assert.equal(history.config.logChannelId, 'channel-1');
  assert.match(warnings.buildWarningHistoryText(
    { id: 'guild-1', name: '테스트 서버' },
    history
  ), /경고 로그 채널: channel-1/);

  await warnings.setWarningLogChannel('guild-1', 'moderator-1', null);
  assert.equal((await warnings.getWarningConfig('guild-1')).logChannelId, null);
});

test('/경고 명령어에 로그 채널 설정과 해제 하위 명령이 있다', async () => {
  const { buildCommands, commandNames } = await import('../src/commands.js');
  const command = buildCommands().find((entry) => entry.name === commandNames.warning);
  assert.ok(command);
  assert.deepEqual(
    command.options.slice(-2).map((option) => option.name),
    ['로그채널', '로그해제']
  );
  assert.equal(command.options.at(-2).options[0].name, '채널');
});
