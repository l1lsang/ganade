import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const birthdayDataPath = path.join(os.tmpdir(), `birthday-test-${process.pid}.json`);
process.env.BIRTHDAY_DATA_PATH = birthdayDataPath;

const birthday = await import(`../src/birthday.js?test=${Date.now()}`);

test.after(async () => {
  await rm(birthdayDataPath, { force: true });
});

test('여러 월·일 형식을 생일로 해석하고 잘못된 날짜를 거절한다', () => {
  assert.deepEqual(birthday.parseBirthdayInput('3월 14일'), { month: 3, day: 14 });
  assert.deepEqual(birthday.parseBirthdayInput('03-14'), { month: 3, day: 14 });
  assert.deepEqual(birthday.parseBirthdayInput('12/31'), { month: 12, day: 31 });
  assert.deepEqual(birthday.parseBirthdayInput('2.29'), { month: 2, day: 29 });
  assert.throws(() => birthday.parseBirthdayInput('2-30'), /존재하는 월과 일/);
  assert.throws(() => birthday.parseBirthdayInput('생일'), /형식/);
});

test('서버별 생일을 등록, 조회, 수정, 해제한다', async () => {
  const registered = await birthday.registerBirthday(
    'guild-1',
    'user-1',
    { month: 6, day: 20 },
    { username: 'tester', displayName: '테스터' }
  );
  assert.equal(registered.month, 6);
  assert.equal(registered.day, 20);

  const found = await birthday.getBirthday('guild-1', 'user-1');
  assert.equal(found.displayName, '테스터');
  assert.equal((await birthday.getBirthdaysForDate('guild-1', 6, 20))[0].userId, 'user-1');
  assert.equal(await birthday.getBirthdayCount('guild-1'), 1);

  const updated = await birthday.registerBirthday('guild-1', 'user-1', { month: 7, day: 1 });
  assert.equal(updated.month, 7);
  assert.equal((await birthday.getBirthdaysForDate('guild-1', 6, 20)).length, 0);

  assert.equal(await birthday.removeBirthday('guild-1', 'user-1'), true);
  assert.equal(await birthday.getBirthday('guild-1', 'user-1'), null);
  assert.equal(await birthday.removeBirthday('guild-1', 'user-1'), false);
});

test('한국 시간 오전 9시부터 생일 축하가 실행된다', () => {
  const before = new Date('2026-06-19T23:59:00.000Z');
  const due = new Date('2026-06-20T00:00:00.000Z');

  assert.equal(birthday.getKoreanBirthdayDateTime(due).date, '2026-06-20');
  assert.equal(birthday.isBirthdayAnnouncementDue(before), false);
  assert.equal(birthday.isBirthdayAnnouncementDue(due), true);
  assert.equal(birthday.normalizeBirthdayAnnouncementTime('8:30'), '08:30');
  assert.equal(birthday.normalizeBirthdayAnnouncementTime('25:00'), '09:00');
});

test('등록 버튼 UI와 실제 유저 멘션이 포함된 축하 임베드를 만든다', () => {
  const panel = birthday.buildBirthdayRegistrationPayload();
  assert.equal(panel.embeds[0].data.title, '🎂 듀 가나디의 생일 우체통');
  assert.equal(panel.components[0].components[0].data.custom_id, birthday.birthdayCustomIds.register);
  assert.equal(panel.components[0].components[1].data.custom_id, birthday.birthdayCustomIds.remove);

  const payload = birthday.buildBirthdayAnnouncementPayload({
    id: '123456789012345678',
    displayName: '생일자',
    user: {
      username: 'birthday-user',
      displayAvatarURL: () => 'https://example.com/avatar.png'
    },
    displayAvatarURL: () => 'https://example.com/avatar.png'
  }, { month: 6, day: 20 });

  assert.match(payload.content, /<@123456789012345678>/);
  assert.match(payload.embeds[0].data.title, /생일 축하한다듀/);
  assert.deepEqual(payload.allowedMentions.users, ['123456789012345678']);
});

test('생일자가 서버 명단에 없거나 봇이면 축하 대상에서 제외한다', async () => {
  const missingGuild = {
    members: { fetch: async () => { throw new Error('Unknown Member'); } }
  };
  const botGuild = {
    members: { fetch: async () => ({ user: { bot: true } }) }
  };
  const member = { id: 'user-1', user: { bot: false } };
  const activeGuild = {
    members: { fetch: async () => member }
  };

  assert.equal(await birthday.fetchBirthdayGuildMember(missingGuild, 'gone-user'), null);
  assert.equal(await birthday.fetchBirthdayGuildMember(botGuild, 'bot-user'), null);
  assert.equal(await birthday.fetchBirthdayGuildMember(activeGuild, 'user-1'), member);
});

test('/생일 명령어에 설정·해제·상태 하위 명령이 있다', async () => {
  const { buildCommands, commandNames } = await import('../src/commands.js');
  const command = buildCommands().find((entry) => entry.name === commandNames.birthday);
  assert.ok(command);
  assert.deepEqual(command.options.map((option) => option.name), ['설정', '해제', '상태']);
  assert.deepEqual(command.options[0].options.map((option) => option.name), ['채널', '축하채널']);
  assert.ok(command.options[0].options.every((option) => option.required === false));
});

test('축하 채널을 따로 지정하고 기존 설정은 등록 채널로 호환한다', () => {
  assert.equal(birthday.getBirthdayAnnouncementChannelId({
    channelId: 'registration-channel',
    announcementChannelId: 'announcement-channel'
  }), 'announcement-channel');
  assert.equal(birthday.getBirthdayAnnouncementChannelId({
    channelId: 'legacy-registration-channel'
  }), 'legacy-registration-channel');
});
