import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommands, commandNames } from '../src/commands.js';
import {
  buildSelfIntroductionEmbed,
  defaultSelfIntroduction,
  normalizeSelfIntroductionSettings
} from '../src/self-introduction.js';

test('자기소개 설정을 검증하고 임베드로 만든다', () => {
  const settings = normalizeSelfIntroductionSettings({
    channelId: '123456789012345678',
    title: '어서 오세요',
    description: '이름과 취미를 알려 주세요.',
    footer: '자유롭게 작성해 주세요.',
    color: '#ABCDEF'
  });

  assert.equal(settings.color, '#abcdef');
  assert.equal(settings.messageId, null);

  const embed = buildSelfIntroductionEmbed(settings).toJSON();
  assert.equal(embed.title, '어서 오세요');
  assert.equal(embed.description, '이름과 취미를 알려 주세요.');
  assert.equal(embed.footer.text, '자유롭게 작성해 주세요.');
  assert.equal(embed.color, 0xabcdef);
});

test('자기소개 기본값과 Discord 명령어를 제공한다', () => {
  assert.match(defaultSelfIntroduction.description, /이름\/닉네임/);
  assert.throws(
    () => normalizeSelfIntroductionSettings({ enabled: true }),
    /채널을 선택/
  );

  const command = buildCommands().find((entry) => entry.name === commandNames.selfIntroduction);
  assert.ok(command);
  assert.equal(command.options[0].name, '채널');
  assert.equal(command.options[0].required, true);
});
