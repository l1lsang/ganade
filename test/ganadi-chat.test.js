import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ganadiCharacterPrompt,
  generateGanadiReply,
  isGanadiChatChannel,
  normalizeGanadiInput,
  shouldRespondToGanadi
} from '../src/ganadi-chat.js';

test('듀와 가나디를 자연스러운 호칭으로 불렀을 때만 반응한다', () => {
  assert.equal(shouldRespondToGanadi('듀 뭐 해?'), true);
  assert.equal(shouldRespondToGanadi('가나디야! 놀자'), true);
  assert.equal(shouldRespondToGanadi('가나디는 간식 좋아해?'), true);
  assert.equal(shouldRespondToGanadi('듀얼 모니터 추천해 줘'), false);
  assert.equal(shouldRespondToGanadi('프로듀서가 왔어'), false);
  assert.equal(shouldRespondToGanadi('그냥 인사할게', true), true);
});

test('설정된 가나디 전용 채널에서만 대화를 허용한다', () => {
  assert.equal(isGanadiChatChannel('channel-1', 'channel-1'), true);
  assert.equal(isGanadiChatChannel('channel-2', 'channel-1'), false);
  assert.equal(isGanadiChatChannel('channel-1', null), false);
});

test('Discord 멘션을 입력에서 제거하고 길이를 제한한다', () => {
  assert.equal(normalizeGanadiInput('<@123456789012345678> 안녕!', 20), '안녕!');
  assert.equal(normalizeGanadiInput('<@!123456789012345678>', 20), '듀!');
  assert.equal(normalizeGanadiInput('가나디야 반가워', 4), '가나디야');
});

test('Responses API에 캐릭터 지침을 전달하고 답변을 정리한다', async () => {
  let request = null;
  const openai = {
    responses: {
      create: async (params) => {
        request = params;
        return { output_text: JSON.stringify({ reply: '  듀! 나 불렀어?  ', affectionDelta: 3 }) };
      }
    }
  };

  const result = await generateGanadiReply(openai, {
    content: '듀 안녕',
    model: 'test-model',
    affection: -250
  });

  assert.deepEqual(result, { reply: '듀! 나 불렀어?', affectionDelta: 3 });
  assert.equal(request.model, 'test-model');
  assert.deepEqual(JSON.parse(request.input), {
    currentAffection: -250,
    userMessage: '듀 안녕'
  });
  assert.equal(request.instructions, ganadiCharacterPrompt);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.required, ['reply', 'affectionDelta']);
  assert.equal(request.max_output_tokens, 300);
});
