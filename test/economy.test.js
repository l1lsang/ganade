import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const economyDataPath = path.join(os.tmpdir(), `economy-test-${process.pid}.json`);
process.env.ECONOMY_DATA_PATH = economyDataPath;

const economy = await import(`../src/economy.js?test=${Date.now()}`);

test.after(async () => {
  await rm(economyDataPath, { force: true });
});

const profile = { username: 'tester', displayName: '테스터' };

test('신규 유저에게 500 듀코인을 지급하고 기존 출석체크 보상을 날짜별 한 번만 지급한다', async () => {
  const initial = await economy.getEconomyProfile('guild-wallet', 'user-1', profile);
  assert.equal(initial.assets.wallet, 500);

  const attendance = { date: '2026-06-20', streak: 1 };
  const first = await economy.awardAttendanceEconomy(
    'guild-wallet', 'user-1', attendance, profile,
    new Date('2026-06-20T00:00:00.000Z'),
    () => 0
  );
  assert.equal(first.reward, 100);
  assert.equal(first.wallet, 600);

  const duplicate = await economy.awardAttendanceEconomy(
    'guild-wallet', 'user-1', attendance, profile,
    new Date('2026-06-20T01:00:00.000Z'),
    () => 0.99
  );
  assert.equal(duplicate.alreadyRewarded, true);
  assert.equal(duplicate.wallet, 600);

  const quests = await economy.getQuestStatus('guild-wallet', 'user-1', profile);
  assert.equal(quests.daily.rows.find((row) => row.key === 'attendance').complete, true);
});

test('송금 수수료를 적용하고 두 지갑을 원자적으로 갱신한다', async () => {
  await economy.adminAdjustWallet('guild-transfer', 'admin', 'sender', 1000, '테스트 준비');
  const result = await economy.transferDuc('guild-transfer', 'sender', 'recipient', 100, {
    sender: { username: 'sender' },
    recipient: { username: 'recipient' }
  });
  assert.equal(result.amount, 100);
  assert.equal(result.fee, 3);
  assert.equal(result.senderWallet, 1397);
  assert.equal(result.recipientWallet, 600);
  await assert.rejects(() => economy.transferDuc('guild-transfer', 'sender', 'recipient', 0), /1 듀코인/);
});

test('낚시 아이템 획득, 쿨타임, 판매가 동작한다', async () => {
  const now = new Date('2026-06-20T00:00:00.000Z');
  const caught = await economy.fish('guild-fishing', 'angler', profile, now, () => 0);
  assert.equal(caught.item.id, 'wet_sock');
  assert.equal(caught.inventoryCount, 1);
  await assert.rejects(
    () => economy.fish('guild-fishing', 'angler', profile, new Date(now.getTime() + 1000), () => 0),
    /쉬는 중/
  );

  const sold = await economy.sellItem('guild-fishing', 'angler', '젖은 양말', 1, profile, now);
  assert.equal(sold.count, 1);
  assert.ok(sold.earned >= 1);
  assert.equal((await economy.getInventory('guild-fishing', 'angler', profile, now)).count, 0);
});

test('상점, 장비 구매, 장착, 안전 강화가 동작한다', async () => {
  await economy.adminAdjustWallet('guild-equipment', 'admin', 'user-1', 10000, '테스트 준비');
  const bought = await economy.buyShopItem('guild-equipment', 'user-1', 'silver_rod', 1, profile);
  assert.equal(bought.item.id, 'silver_rod');
  await economy.equipEconomyItem('guild-equipment', 'user-1', 'rod', 'silver_rod', profile);
  const enhanced = await economy.enhanceRod('guild-equipment', 'user-1', profile, new Date(), () => 0);
  assert.equal(enhanced.success, true);
  assert.equal(enhanced.level, 1);
  assert.equal((await economy.getEquipment('guild-equipment', 'user-1', profile)).rods.find((entry) => entry.rod.id === 'silver_rod').equipped, true);
});

test('가상 주식 거래와 미니게임 제한이 동작한다', async () => {
  await economy.adminAdjustWallet('guild-market', 'admin', 'user-1', 100000, '테스트 준비');
  const bought = await economy.buyStock('guild-market', 'user-1', 'MFOOD', 2, profile);
  assert.equal(bought.count, 2);
  assert.equal((await economy.getStockHoldings('guild-market', 'user-1', profile)).holdings[0].quantity, 2);
  const sold = await economy.sellStock('guild-market', 'user-1', 'MFOOD', 1, profile);
  assert.equal(sold.remaining, 1);

  const gameNow = new Date('2026-06-20T00:00:00.000Z');
  const win = await economy.playMiniGame('guild-market', 'user-1', 'coin', 100, '앞', profile, gameNow, () => 0);
  assert.equal(win.result, 'win');
  assert.equal(win.net, 100);
  await assert.rejects(
    () => economy.playMiniGame('guild-market', 'user-1', 'coin', 501, '앞', profile, new Date(gameNow.getTime() + 20_000), () => 0),
    /최대/
  );
});

test('관리자 조작을 내부 감사 로그에 남기고 로그 채널을 저장한다', async () => {
  const configured = await economy.setEconomyLogChannel('guild-admin', 'admin-1', 'channel-1');
  assert.equal(configured.config.logChannelId, 'channel-1');
  await economy.adminAdjustWallet('guild-admin', 'admin-1', 'user-1', 500, '이벤트 보상');
  const logs = await economy.getEconomyAdminLogs('guild-admin');
  assert.equal(logs.at(-1).action, '듀코인 지급');
  assert.equal(logs.at(-1).reason, '이벤트 보상');
});

test('경제 이용이 제한된 멤버도 기존 출석체크 자체는 막지 않고 경제 보상만 제외한다', async () => {
  await economy.adminSetUserBlocked('guild-blocked', 'admin-1', 'user-1', true, '테스트 제재');
  const result = await economy.awardAttendanceEconomy(
    'guild-blocked',
    'user-1',
    { date: '2026-06-20', streak: 1 },
    profile,
    new Date('2026-06-20T00:00:00.000Z'),
    () => 0
  );
  assert.equal(result.blocked, true);
  assert.equal(result.reward, 0);
});

test('경제 명령은 별도 /출석 없이 기존 /출석체크와 공존한다', async () => {
  const { buildCommands } = await import('../src/commands.js');
  const commands = buildCommands();
  assert.ok(commands.some((command) => command.name === '출석체크'));
  assert.equal(commands.some((command) => command.name === '출석'), false);
  assert.ok(commands.some((command) => command.name === '지갑'));
  assert.ok(commands.some((command) => command.name === '낚시'));
  assert.ok(commands.some((command) => command.name === '경제설정'));
  assert.ok(commands.length < 100);
  assert.equal(new Set(commands.map((command) => command.name)).size, commands.length);

  for (const command of commands) {
    let sawOptional = false;
    for (const option of command.options || []) {
      if (option.type === 1 || option.type === 2) continue;
      if (!option.required) sawOptional = true;
      else assert.equal(sawOptional, false, `${command.name}: 필수 옵션은 선택 옵션보다 앞에 있어야 함`);
    }
  }
});
