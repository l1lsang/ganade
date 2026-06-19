import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduledGreetingPayload,
  findDueBibleSlot,
  generateScheduledGreeting,
  getKoreanDateTime,
  normalizeBibleSchedule,
  scheduledGreetingPrompt,
  selectDailyBibleVerse,
  shouldIncludeDailyBible
} from '../src/bible-scheduler.js';
import { buildCommands, commandNames } from '../src/commands.js';

test('UTC 시각을 한국 날짜와 아침·점심·저녁 예약으로 판정한다', () => {
  const morning = new Date('2026-06-20T23:05:00.000Z');
  assert.deepEqual(getKoreanDateTime(morning), {
    date: '2026-06-21',
    hour: 8,
    minute: 5
  });

  assert.equal(findDueBibleSlot({ now: morning }).key, 'morning');
  assert.equal(findDueBibleSlot({
    now: morning,
    lastSent: { morning: '2026-06-21' }
  }), null);
  assert.equal(findDueBibleSlot({
    now: new Date('2026-06-20T23:21:00.000Z')
  }), null);

  assert.equal(findDueBibleSlot({
    now: new Date('2026-06-21T03:05:00.000Z')
  }).key, 'lunch');
  assert.equal(findDueBibleSlot({
    now: new Date('2026-06-21T10:15:00.000Z')
  }).key, 'evening');
});

test('잘못된 예약 시각은 기본 한국 시간으로 정규화한다', () => {
  assert.deepEqual(normalizeBibleSchedule({
    morning: '7:00',
    lunch: '25:00',
    evening: '20:30'
  }), {
    morning: '08:00',
    lunch: '12:00',
    evening: '20:30'
  });
});

test('날짜와 서버가 같으면 같은 하루 한 번 구절을 선택한다', () => {
  const first = selectDailyBibleVerse('2026-06-21', 'guild-1');
  const second = selectDailyBibleVerse('2026-06-21', 'guild-1');
  assert.deepEqual(first, second);
  assert.match(first.reference, /\d/);
  assert.ok(first.theme.length > 10);
  assert.ok(first.fallback.length > 10);
});

test('하루 첫 안부에만 성경 말씀을 포함한다', () => {
  assert.equal(shouldIncludeDailyBible({}, '2026-06-21'), true);
  assert.equal(shouldIncludeDailyBible({
    lastBibleDate: '2026-06-21'
  }, '2026-06-21'), false);
  assert.equal(shouldIncludeDailyBible({
    lastSent: { morning: '2026-06-21' }
  }, '2026-06-21'), false);
  assert.equal(shouldIncludeDailyBible({
    lastBibleDate: '2026-06-20',
    lastSent: { evening: '2026-06-20' }
  }, '2026-06-21'), true);
});

test('OpenAI 안부를 정리하고 @everyone 허용 메시지를 만든다', async () => {
  let request = null;
  const openai = {
    responses: {
      create: async (params) => {
        request = params;
        return { output_text: '@everyone 오늘도 힘내! <@123456789012345678>' };
      }
    }
  };
  const slot = {
    key: 'morning',
    label: '아침',
    emoji: '🌅',
    color: 0xf9c74f,
    date: '2026-06-21',
    time: '08:00',
    greetingTheme: '잘 잤는지 묻는다.'
  };
  const verse = selectDailyBibleVerse(slot.date, 'guild-1');
  const greeting = await generateScheduledGreeting(openai, {
    model: 'test-model',
    slot,
    verse
  });

  assert.equal(greeting, '여러분 오늘도 힘내!');
  assert.equal(request.model, 'test-model');
  assert.equal(request.instructions, scheduledGreetingPrompt);
  assert.match(request.input, /오늘 한 번 포함할 성경 구절/);

  const payload = buildScheduledGreetingPayload(slot, greeting, verse);
  assert.equal(payload.content, '@everyone');
  assert.deepEqual(payload.allowedMentions, { parse: ['everyone'] });
  assert.match(payload.embeds[0].toJSON().description, new RegExp(verse.reference));

  const lunchPayload = buildScheduledGreetingPayload({
    ...slot,
    key: 'lunch',
    label: '점심',
    time: '12:00'
  }, '점심은 먹었어?');
  assert.equal(lunchPayload.embeds[0].toJSON().description, '점심은 먹었어?');
  assert.doesNotMatch(lunchPayload.embeds[0].toJSON().title, /말씀/);

  await generateScheduledGreeting(openai, {
    model: 'test-model',
    slot: {
      ...slot,
      key: 'lunch',
      label: '점심',
      greetingTheme: '밥을 먹었는지 묻는다.'
    }
  });
  assert.match(request.input, /이 메시지에는 성경 구절을 포함하지 않는다/);
});

test('/성경말씀 명령어에 설정·해제·상태 하위 명령이 있다', () => {
  const command = buildCommands().find((entry) => entry.name === commandNames.bibleMessage);
  assert.ok(command);
  assert.deepEqual(command.options.map((option) => option.name), ['설정', '해제', '상태']);
  assert.equal(command.options[0].options[0].name, '채널');
});
