import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommands, commandNames } from '../src/commands.js';
import {
  buildGanadiHelpEmbed,
  ganadiHelpCategoryChoices
} from '../src/ganadi-help.js';

function embedText(embed) {
  const data = embed.toJSON();
  return [
    data.title,
    data.description,
    ...(data.fields || []).flatMap((field) => [field.name, field.value]),
    data.footer?.text
  ].filter(Boolean).join('\n');
}

test('/가나디 도움말에 일반 멤버용 분야 선택지를 제공한다', () => {
  const command = buildCommands().find((entry) => entry.name === commandNames.ganadi);
  const help = command.options.find((option) => option.name === '도움말');
  const category = help.options.find((option) => option.name === '분야');

  assert.ok(help);
  assert.equal(category.required, false);
  assert.deepEqual(
    category.choices.map((choice) => choice.value),
    ganadiHelpCategoryChoices.map((choice) => choice.value)
  );
});

test('도움말 임베드는 일반 유저 명령어를 모두 안내하고 관리자 명령어는 제외한다', () => {
  const commands = buildCommands();
  const helpText = ganadiHelpCategoryChoices
    .map((choice) => embedText(buildGanadiHelpEmbed(choice.value)))
    .join('\n');

  const publicCommands = commands.filter((command) => command.default_member_permissions == null);
  const adminCommands = commands.filter((command) => command.default_member_permissions != null);

  for (const command of publicCommands) {
    assert.ok(helpText.includes(`/${command.name}`), `일반 명령어 /${command.name} 안내가 빠졌습니다.`);
  }

  for (const command of adminCommands) {
    assert.ok(!helpText.includes(`/${command.name}`), `관리자 명령어 /${command.name}가 노출되었습니다.`);
  }
});

test('알 수 없는 도움말 분야는 처음 시작하기 화면으로 돌아간다', () => {
  assert.deepEqual(
    buildGanadiHelpEmbed('unknown').toJSON(),
    buildGanadiHelpEmbed('start').toJSON()
  );
});
