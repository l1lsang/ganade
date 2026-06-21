import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommands, commandNames } from '../src/commands.js';
import {
  buildJoinDirectMessagePayload,
  buildWelcomePayload,
  defaultWelcomeMessage,
  joinDirectMessageTitle
} from '../src/welcome.js';

const targetUser = {
  id: '123456789012345678',
  username: 'new-member',
  globalName: '새멤버',
  displayAvatarURL: () => 'https://cdn.example.com/avatar.png'
};

test('/환영 명령어는 환영할 멤버와 선택 환영 글을 받는다', () => {
  const command = buildCommands().find((entry) => entry.name === commandNames.welcome);
  const memberOption = command.options.find((option) => option.name === '멤버');
  const messageOption = command.options.find((option) => option.name === '글');

  assert.ok(command);
  assert.equal(memberOption.required, true);
  assert.equal(messageOption.required, false);
  assert.equal(messageOption.max_length, 1000);
  assert.equal(command.default_member_permissions, undefined);
});

test('환영 글은 대상 멤버만 멘션하고 기본 문구를 사용한다', () => {
  const payload = buildWelcomePayload({
    guildName: '가나디 마을',
    targetUser,
    targetDisplayName: '새 멤버 별명',
    welcomerName: '기존 멤버'
  });
  const embed = payload.embeds[0].toJSON();

  assert.equal(payload.content, `<@${targetUser.id}>`);
  assert.deepEqual(payload.allowedMentions.users, [targetUser.id]);
  assert.deepEqual(payload.allowedMentions.parse, []);
  assert.match(embed.title, /새 멤버 별명/);
  assert.match(embed.description, /가나디 마을/);
  assert.ok(embed.description.includes(defaultWelcomeMessage));
  assert.equal(embed.footer.text, '기존 멤버님이 보내는 환영 인사');
});

test('직접 입력한 환영 글의 앞뒤 공백을 정리한다', () => {
  const payload = buildWelcomePayload({
    guildName: '가나디 마을',
    targetUser,
    welcomerName: '기존 멤버',
    message: '  우리 서버에서 함께 재미있게 놀아요!  '
  });
  const description = payload.embeds[0].toJSON().description;

  assert.ok(description.endsWith('우리 서버에서 함께 재미있게 놀아요!'));
  assert.ok(!description.includes(defaultWelcomeMessage));
});

test('가입 안내 DM에 서버 아이콘과 필수 할 일을 담는다', () => {
  const payload = buildJoinDirectMessagePayload({
    guildName: '가나디 마을',
    guildIconUrl: 'https://cdn.example.com/guild-icon.png'
  });
  const embed = payload.embeds[0].toJSON();

  assert.equal(embed.title, joinDirectMessageTitle);
  assert.equal(embed.thumbnail.url, 'https://cdn.example.com/guild-icon.png');
  assert.match(embed.description, /종교 카테고리/);
  assert.match(embed.description, /자기소개 하기/);
  assert.deepEqual(payload.allowedMentions.parse, []);
});
