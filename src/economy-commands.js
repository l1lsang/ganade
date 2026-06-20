import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder
} from 'discord.js';
import {
  adminAddCustomItem,
  adminAdjustWallet,
  adminCreateNews,
  adminDeleteCustomItem,
  adminResetEconomy,
  adminSetStockPrice,
  adminSetUserBlocked,
  adminUpdateEconomySettings,
  buyShopItem,
  buyStock,
  claimQuestReward,
  enhanceRod,
  equipEconomyItem,
  fish,
  getEconomicNews,
  getEconomyAdminLogs,
  getEconomyConfig,
  getEconomyProfile,
  getEconomyRanking,
  getEquipment,
  getFishingDex,
  getInventory,
  getItemInformation,
  getMarketOverview,
  getMiniGameRecord,
  getQuestStatus,
  getShop,
  getStockHoldings,
  getStockInformation,
  getStockList,
  playMiniGame,
  sellAllItems,
  sellItem,
  sellStock,
  setEconomyLogChannel,
  transferDuc
} from './economy.js';
import {
  formatDuc,
  gradeColors,
  gradeOrder,
  shopItems,
  virtualStocks
} from './economy-catalog.js';

export const economyCommandNames = Object.freeze({
  wallet: '지갑', balance: '잔액', transfer: '송금', profile: '내정보',
  fishing: '낚시', inventory: '인벤토리', sell: '판매', sellAll: '전체판매', fishDex: '낚시도감',
  shop: '상점', buy: '구매', equipment: '장비', enhance: '강화', itemInfo: '아이템정보', titles: '칭호', equip: '장착',
  stockList: '주식목록', stockInfo: '주식정보', buyStock: '매수', sellStock: '매도', holdings: '내주식', stockRanking: '주식랭킹', market: '시장',
  coin: '동전던지기', dice: '주사위', slot: '슬롯', oddEven: '홀짝', blackmong: '블랙멍', gameRecord: '미니게임기록',
  news: '경제뉴스', todayMarket: '오늘의시장', newsHistory: '뉴스기록', analysis: '시장분석',
  quests: '퀘스트', dailyQuests: '일일퀘스트', weeklyQuests: '주간퀘스트', claimQuest: '퀘스트완료',
  richRanking: '부자랭킹', fishingRanking: '낚시랭킹', questRanking: '퀘스트랭킹',
  economySettings: '경제설정', adminGive: '관리자지급', adminTake: '관리자회수', economyReset: '경제리셋', stockAdjust: '주가조정',
  createNews: '뉴스생성', addItem: '아이템추가', deleteItem: '아이템삭제', sanction: '유저제재', probability: '확률설정', cooldown: '쿨타임설정', logs: '로그조회'
});

const economyCommandSet = new Set(Object.values(economyCommandNames));
const adminEconomyCommandSet = new Set([
  economyCommandNames.economySettings,
  economyCommandNames.adminGive,
  economyCommandNames.adminTake,
  economyCommandNames.economyReset,
  economyCommandNames.stockAdjust,
  economyCommandNames.createNews,
  economyCommandNames.addItem,
  economyCommandNames.deleteItem,
  economyCommandNames.sanction,
  economyCommandNames.probability,
  economyCommandNames.cooldown,
  economyCommandNames.logs
]);
const stockChoices = virtualStocks.map((stock) => ({ name: `${stock.name} (${stock.symbol})`, value: stock.symbol }));
const gradeChoices = gradeOrder.map((grade) => ({ name: grade, value: grade }));
const shopChoices = shopItems.map((item) => ({ name: `${item.name} · ${formatDuc(item.price)}`, value: item.id }));

function command(name, description) {
  return new SlashCommandBuilder().setName(name).setDescription(description);
}

function addBet(builder) {
  return builder.addIntegerOption((option) => option.setName('베팅').setDescription('사용할 듀코인, 최대 500').setRequired(true).setMinValue(1).setMaxValue(500));
}

function adminCommand(name, description) {
  return command(name, description).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
}

export function buildEconomyCommands() {
  const commands = [
    command(economyCommandNames.wallet, '내 듀코인 지갑과 총 자산을 확인합니다.')
      .addUserOption((o) => o.setName('유저').setDescription('확인할 유저, 비워두면 본인').setRequired(false)),
    command(economyCommandNames.balance, '내 듀코인 잔액을 빠르게 확인합니다.')
      .addUserOption((o) => o.setName('유저').setDescription('확인할 유저, 비워두면 본인').setRequired(false)),
    command(economyCommandNames.transfer, '다른 멤버에게 듀코인을 송금합니다.')
      .addUserOption((o) => o.setName('유저').setDescription('듀코인을 받을 멤버').setRequired(true))
      .addIntegerOption((o) => o.setName('금액').setDescription('송금할 듀코인').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    command(economyCommandNames.profile, '내 가나디 월드 경제 정보를 확인합니다.')
      .addUserOption((o) => o.setName('유저').setDescription('확인할 유저, 비워두면 본인').setRequired(false)),
    command(economyCommandNames.fishing, '낚시로 아이템을 한 개 획득합니다.'),
    command(economyCommandNames.inventory, '보유한 낚시 아이템과 소모품을 확인합니다.'),
    command(economyCommandNames.sell, '인벤토리의 낚시 아이템을 판매합니다.')
      .addStringOption((o) => o.setName('아이템').setDescription('아이템 이름 또는 ID').setRequired(true).setMaxLength(50))
      .addIntegerOption((o) => o.setName('수량').setDescription('판매 수량, 기본 1개').setRequired(false).setMinValue(1).setMaxValue(1000)),
    command(economyCommandNames.sellAll, '낚시 아이템을 한꺼번에 판매합니다.')
      .addStringOption((o) => o.setName('등급').setDescription('이 등급만 판매, 비우면 전체').setRequired(false).addChoices(...gradeChoices)),
    command(economyCommandNames.fishDex, '지금까지 발견한 낚시 아이템 도감을 확인합니다.'),
    command(economyCommandNames.shop, '가나디 상점의 장비와 아이템을 확인합니다.'),
    command(economyCommandNames.buy, '가나디 상점에서 아이템을 구매합니다.')
      .addStringOption((o) => o.setName('아이템').setDescription('구매할 상점 아이템').setRequired(true).addChoices(...shopChoices))
      .addIntegerOption((o) => o.setName('수량').setDescription('소모품 구매 수량').setRequired(false).setMinValue(1).setMaxValue(100)),
    command(economyCommandNames.equipment, '보유 장비와 장착 상태를 확인합니다.'),
    command(economyCommandNames.enhance, '현재 장착한 낚싯대를 안전하게 강화합니다.'),
    command(economyCommandNames.itemInfo, '아이템 이름 또는 ID로 상세 정보를 확인합니다.')
      .addStringOption((o) => o.setName('아이템').setDescription('아이템 이름 또는 ID').setRequired(true).setMaxLength(50)),
    command(economyCommandNames.titles, '보유한 칭호를 확인합니다.'),
    command(economyCommandNames.equip, '낚싯대 또는 칭호를 장착합니다.')
      .addStringOption((o) => o.setName('종류').setDescription('장착할 종류').setRequired(true).addChoices({ name: '낚싯대', value: 'rod' }, { name: '칭호', value: 'title' }))
      .addStringOption((o) => o.setName('이름').setDescription('보유한 낚싯대/칭호 이름 또는 ID').setRequired(true).setMaxLength(50)),
    command(economyCommandNames.stockList, '가나디 월드의 가상 주식 목록을 확인합니다.'),
    command(economyCommandNames.stockInfo, '가상 주식의 현재 정보와 뉴스를 확인합니다.')
      .addStringOption((o) => o.setName('종목').setDescription('확인할 가상 종목').setRequired(true).addChoices(...stockChoices)),
    command(economyCommandNames.buyStock, '듀코인으로 가상 주식을 매수합니다.')
      .addStringOption((o) => o.setName('종목').setDescription('매수할 가상 종목').setRequired(true).addChoices(...stockChoices))
      .addIntegerOption((o) => o.setName('수량').setDescription('매수 수량').setRequired(true).setMinValue(1).setMaxValue(100000)),
    command(economyCommandNames.sellStock, '보유한 가상 주식을 매도합니다.')
      .addStringOption((o) => o.setName('종목').setDescription('매도할 가상 종목').setRequired(true).addChoices(...stockChoices))
      .addIntegerOption((o) => o.setName('수량').setDescription('매도 수량').setRequired(true).setMinValue(1).setMaxValue(100000)),
    command(economyCommandNames.holdings, '내 가상 주식 보유 현황을 확인합니다.'),
    command(economyCommandNames.stockRanking, '가상 주식 평가액 랭킹을 확인합니다.'),
    command(economyCommandNames.market, '가나디 월드 가상 시장 현황을 확인합니다.'),
    addBet(command(economyCommandNames.coin, '앞뒤를 맞히는 가상 동전 게임입니다.'))
      .addStringOption((o) => o.setName('선택').setDescription('앞 또는 뒤').setRequired(true).addChoices({ name: '앞', value: '앞' }, { name: '뒤', value: '뒤' })),
    addBet(command(economyCommandNames.dice, '가나디와 주사위 숫자를 겨룹니다.')),
    addBet(command(economyCommandNames.slot, '가상 슬롯머신을 돌립니다.')),
    addBet(command(economyCommandNames.oddEven, '주사위 결과의 홀짝을 맞힙니다.'))
      .addStringOption((o) => o.setName('선택').setDescription('홀 또는 짝').setRequired(true).addChoices({ name: '홀', value: '홀' }, { name: '짝', value: '짝' })),
    addBet(command(economyCommandNames.blackmong, '21에 가까운 숫자를 만드는 간단한 카드 게임입니다.')),
    command(economyCommandNames.gameRecord, '내 미니게임 승패와 오늘 손실을 확인합니다.'),
    command(economyCommandNames.news, '오늘의 가상 경제 뉴스를 확인합니다.'),
    command(economyCommandNames.todayMarket, '오늘 가나디 월드 시장 분위기를 확인합니다.'),
    command(economyCommandNames.newsHistory, '최근 가상 경제 뉴스 기록을 확인합니다.'),
    command(economyCommandNames.analysis, '가상 시장의 등락과 위험을 분석합니다.'),
    command(economyCommandNames.quests, '일일·주간 퀘스트를 함께 확인합니다.'),
    command(economyCommandNames.dailyQuests, '오늘의 일일 퀘스트를 확인합니다.'),
    command(economyCommandNames.weeklyQuests, '이번 주 주간 퀘스트를 확인합니다.'),
    command(economyCommandNames.claimQuest, '완료한 퀘스트 묶음 보상을 받습니다.')
      .addStringOption((o) => o.setName('종류').setDescription('받을 퀘스트 보상').setRequired(true).addChoices({ name: '일일', value: 'daily' }, { name: '주간', value: 'weekly' })),
    command(economyCommandNames.richRanking, '가나디 월드 총 자산 랭킹을 확인합니다.'),
    command(economyCommandNames.fishingRanking, '누적 낚시 횟수 랭킹을 확인합니다.'),
    command(economyCommandNames.questRanking, '퀘스트 보상 완료 랭킹을 확인합니다.'),
    adminCommand(economyCommandNames.economySettings, '경제 관리자 감사 로그 채널을 설정합니다.')
      .addChannelOption((o) => o.setName('로그채널').setDescription('모든 관리자 경제 조작을 기록할 채널').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    adminCommand(economyCommandNames.adminGive, '유저에게 듀코인을 관리자 지급합니다.')
      .addUserOption((o) => o.setName('유저').setDescription('지급 대상').setRequired(true))
      .addIntegerOption((o) => o.setName('금액').setDescription('지급 금액').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000))
      .addStringOption((o) => o.setName('사유').setDescription('감사 로그에 남길 사유').setRequired(true).setMaxLength(300)),
    adminCommand(economyCommandNames.adminTake, '유저의 듀코인을 관리자 회수합니다.')
      .addUserOption((o) => o.setName('유저').setDescription('회수 대상').setRequired(true))
      .addIntegerOption((o) => o.setName('금액').setDescription('회수 금액').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000))
      .addStringOption((o) => o.setName('사유').setDescription('감사 로그에 남길 사유').setRequired(true).setMaxLength(300)),
    adminCommand(economyCommandNames.economyReset, '유저 또는 서버 경제 데이터를 초기화합니다.')
      .addStringOption((o) => o.setName('범위').setDescription('초기화 범위').setRequired(true).addChoices({ name: '특정 유저', value: 'user' }, { name: '서버 전체', value: 'server' }))
      .addStringOption((o) => o.setName('확인').setDescription('정확히 초기화 입력').setRequired(true).setMaxLength(10))
      .addUserOption((o) => o.setName('유저').setDescription('유저 초기화일 때 대상').setRequired(false)),
    adminCommand(economyCommandNames.stockAdjust, '가상 주식 가격을 수동 조정합니다.')
      .addStringOption((o) => o.setName('종목').setDescription('조정할 종목').setRequired(true).addChoices(...stockChoices))
      .addIntegerOption((o) => o.setName('가격').setDescription('새 가상 가격').setRequired(true).setMinValue(10).setMaxValue(1_000_000_000))
      .addStringOption((o) => o.setName('사유').setDescription('조정 사유').setRequired(true).setMaxLength(300)),
    adminCommand(economyCommandNames.createNews, '관리자 가상 경제 뉴스를 생성합니다.')
      .addStringOption((o) => o.setName('제목').setDescription('뉴스 제목').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('내용').setDescription('뉴스 내용').setRequired(true).setMaxLength(1000))
      .addStringOption((o) => o.setName('종목').setDescription('영향을 줄 가상 종목').setRequired(false).addChoices(...stockChoices))
      .addNumberOption((o) => o.setName('영향률').setDescription('예: 5는 +5%, -5는 -5%').setRequired(false).setMinValue(-30).setMaxValue(30)),
    adminCommand(economyCommandNames.addItem, '사용자 정의 낚시 아이템을 추가합니다.')
      .addStringOption((o) => o.setName('id').setDescription('영문 소문자/숫자/밑줄 ID').setRequired(true).setMaxLength(32))
      .addStringOption((o) => o.setName('이름').setDescription('아이템 이름').setRequired(true).setMaxLength(50))
      .addStringOption((o) => o.setName('등급').setDescription('아이템 등급').setRequired(true).addChoices(...gradeChoices))
      .addIntegerOption((o) => o.setName('가격').setDescription('기본 판매가').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000))
      .addNumberOption((o) => o.setName('가중치').setDescription('낚일 상대 가중치').setRequired(true).setMinValue(0.01).setMaxValue(10000))
      .addStringOption((o) => o.setName('설명').setDescription('아이템 설명').setRequired(false).setMaxLength(300)),
    adminCommand(economyCommandNames.deleteItem, '사용자 정의 낚시 아이템을 삭제합니다.')
      .addStringOption((o) => o.setName('id').setDescription('삭제할 사용자 정의 아이템 ID').setRequired(true).setMaxLength(32)),
    adminCommand(economyCommandNames.sanction, '유저의 경제 게임 이용을 제한하거나 해제합니다.')
      .addUserOption((o) => o.setName('유저').setDescription('처리 대상').setRequired(true))
      .addStringOption((o) => o.setName('조치').setDescription('제한 또는 해제').setRequired(true).addChoices({ name: '이용 제한', value: 'block' }, { name: '제한 해제', value: 'unblock' }))
      .addStringOption((o) => o.setName('사유').setDescription('처리 사유').setRequired(true).setMaxLength(300)),
    adminCommand(economyCommandNames.probability, '신화 아이템 상대 확률 배수를 설정합니다.')
      .addNumberOption((o) => o.setName('신화배수').setDescription('0~10, 기본 1').setRequired(true).setMinValue(0).setMaxValue(10)),
    adminCommand(economyCommandNames.cooldown, '낚시와 미니게임 쿨타임을 설정합니다.')
      .addIntegerOption((o) => o.setName('낚시초').setDescription('15~3600초').setRequired(false).setMinValue(15).setMaxValue(3600))
      .addIntegerOption((o) => o.setName('미니게임초').setDescription('1~300초').setRequired(false).setMinValue(1).setMaxValue(300)),
    adminCommand(economyCommandNames.logs, '경제 관리자 감사 로그를 파일로 확인합니다.')
  ];
  return commands;
}

export function isEconomyCommand(name) {
  return economyCommandSet.has(name);
}

function profileOf(user, member = null) {
  return {
    username: user.username,
    displayName: member?.displayName || user.globalName || user.username,
    avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 })
  };
}

function economyEmbed(title, color = 0xf5a623) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setFooter({ text: '듀코인은 현실 가치가 없는 서버 내부 오락용 가상 재화다멍!' })
    .setTimestamp();
}

function truncateLines(lines, limit = 3800) {
  const output = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > limit) break;
    output.push(line);
    length += line.length + 1;
  }
  return output.join('\n') || '표시할 내용이 없다멍!';
}

function signed(value, suffix = '') {
  const number = Number(value) || 0;
  return `${number > 0 ? '+' : ''}${number.toLocaleString('ko-KR')}${suffix}`;
}

function questText(section) {
  return section.rows.map((row) => `${row.complete ? '✅' : '⬜'} ${row.label} — ${row.progress}/${row.goal}`).join('\n');
}

function gameName(game) {
  return { coin: '동전던지기', dice: '주사위', slot: '슬롯', odd_even: '홀짝', blackmong: '블랙멍' }[game] || game;
}

async function buildWalletReply(guildId, targetUser, member = null, compact = false) {
  const data = await getEconomyProfile(guildId, targetUser.id, profileOf(targetUser, member));
  if (compact) return { content: `🐶 ${targetUser}님의 잔액은 **${formatDuc(data.assets.wallet)}**이다멍!`, allowedMentions: { users: [], roles: [] } };
  const title = data.user.equippedTitle ? `${data.user.equippedTitle} · ${targetUser.globalName || targetUser.username}` : targetUser.globalName || targetUser.username;
  const embed = economyEmbed('🐶 듀코인 지갑 조회멍!', data.user.upgrades.wallet_skin ? 0xff70c0 : 0xf5a623)
    .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      { name: '닉네임', value: title, inline: false },
      { name: '보유 듀코인', value: formatDuc(data.assets.wallet), inline: true },
      { name: '보유 주식 평가액', value: formatDuc(data.assets.stockValue), inline: true },
      { name: '인벤토리 예상 가치', value: formatDuc(data.assets.inventoryValue), inline: true },
      { name: '총 자산', value: `**${formatDuc(data.assets.total)}**`, inline: false }
    )
    .setDescription('왈왈! 오늘도 든든하게 모아보자멍!');
  return { embeds: [embed], allowedMentions: { users: [], roles: [] } };
}

export async function buildEconomyRankingReply(guildId, type = 'assets') {
  const rows = await getEconomyRanking(guildId, type, 10);
  const labels = { assets: '총 자산', wallet: '보유 듀코인', fishing: '낚시 횟수', quests: '퀘스트 완료', stock: '주식 손익' };
  const values = rows.map((row, index) => {
    const value = ['fishing', 'quests'].includes(type)
      ? `${row.value.toLocaleString('ko-KR')}회`
      : type === 'stock'
        ? `${signed(row.value)} 🦴`
        : formatDuc(row.value);
    return `**${index + 1}위** <@${row.userId}> — ${value}`;
  });
  return {
    embeds: [economyEmbed(`🏆 가나디 월드 ${labels[type] || labels.assets} 랭킹멍!`, 0xffc107).setDescription(values.join('\n') || '아직 랭킹 기록이 없다멍!')],
    allowedMentions: { users: [], roles: [] }
  };
}

async function requireAdmin(interaction, requireLog = true) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) throw new Error('서버 관리 권한이 필요하다멍!');
  const config = await getEconomyConfig(interaction.guildId);
  if (!requireLog) return { config, channel: null };
  if (!config.logChannelId) throw new Error('먼저 `/경제설정 로그채널:<채널>`로 감사 로그 채널을 설정해 달라멍!');
  const channel = interaction.guild.channels.cache.get(config.logChannelId)
    || await interaction.guild.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('설정된 경제 로그 채널을 찾을 수 없다멍!');
  const permissions = channel.permissionsFor(interaction.guild.members.me);
  if (!permissions?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks])) {
    throw new Error('경제 로그 채널에서 메시지 전송과 임베드 권한이 필요하다멍!');
  }
  return { config, channel };
}

async function sendAdminLog(channel, interaction, log) {
  if (!channel || !log) return;
  const details = Object.entries(log)
    .filter(([key]) => !['id', 'adminId', 'action', 'createdAt'].includes(key))
    .map(([key, value]) => `**${key}:** ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🔐 가나디 월드 관리자 감사 로그')
      .addFields(
        { name: '관리자', value: `${interaction.user} (${interaction.user.id})`, inline: false },
        { name: '작업', value: log.action, inline: false },
        { name: '상세', value: truncateLines(details, 1000), inline: false }
      )
      .setTimestamp(new Date(log.createdAt))],
    allowedMentions: { users: [], roles: [] }
  });
}

export async function handleEconomyCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '가나디 월드는 서버 안에서만 열 수 있다멍!', ephemeral: true });
    return;
  }
  const name = interaction.commandName;
  await interaction.deferReply({ ephemeral: adminEconomyCommandSet.has(name) });
  const profile = profileOf(interaction.user, interaction.member);

  if (name === economyCommandNames.wallet || name === economyCommandNames.balance || name === economyCommandNames.profile) {
    const target = interaction.options.getUser('유저') || interaction.user;
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    await interaction.editReply(await buildWalletReply(interaction.guildId, target, member, name === economyCommandNames.balance));
    return;
  }
  if (name === economyCommandNames.transfer) {
    const target = interaction.options.getUser('유저', true);
    if (target.bot) throw new Error('봇에게는 듀코인을 보낼 수 없다멍!');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) throw new Error('서버에 있는 멤버에게만 송금할 수 있다멍!');
    const result = await transferDuc(interaction.guildId, interaction.user.id, target.id, interaction.options.getInteger('금액', true), {
      sender: profile, recipient: profileOf(target, member)
    });
    await interaction.editReply({
      embeds: [economyEmbed('💸 듀코인 송금 완료멍!', 0x57f287).addFields(
        { name: '받는 멤버', value: `${target}`, inline: true },
        { name: '송금액', value: formatDuc(result.amount), inline: true },
        { name: '수수료 3%', value: formatDuc(result.fee), inline: true },
        { name: '남은 잔액', value: formatDuc(result.senderWallet), inline: false }
      )], allowedMentions: { users: [], roles: [] }
    });
    return;
  }
  if (name === economyCommandNames.fishing) {
    const result = await fish(interaction.guildId, interaction.user.id, profile);
    await interaction.editReply({ embeds: [economyEmbed('🎣 첨벙첨벙… 낚시 결과멍!', gradeColors[result.item.grade])
      .setDescription(`${interaction.user}님이 **${result.item.name}**을(를) 낚았다멍!`)
      .addFields(
        { name: '등급', value: result.item.grade, inline: true },
        { name: '예상 판매가', value: formatDuc(result.estimatedPrice), inline: true },
        { name: '장비', value: `${result.rod.name} +${result.rodLevel}`, inline: true },
        { name: '인벤토리', value: `${result.inventoryCount}/${result.capacity}`, inline: true }
      )], allowedMentions: { users: [], roles: [] } });
    return;
  }
  if (name === economyCommandNames.inventory) {
    const result = await getInventory(interaction.guildId, interaction.user.id, profile);
    const lines = result.entries.sort((a, b) => gradeOrder.indexOf(b.item.grade || '쓰레기') - gradeOrder.indexOf(a.item.grade || '쓰레기'))
      .map(({ item, quantity, unitPrice }) => `${item.grade ? `[${item.grade}] ` : ''}**${item.name}** x${quantity}${unitPrice ? ` · ${formatDuc(unitPrice)}씩` : ''}`);
    await interaction.editReply({ embeds: [economyEmbed('🎒 가나디 인벤토리멍!').setDescription(truncateLines(lines)).addFields({ name: '보관량', value: `${result.count}/${result.capacity}`, inline: true })] });
    return;
  }
  if (name === economyCommandNames.sell) {
    const result = await sellItem(interaction.guildId, interaction.user.id, interaction.options.getString('아이템', true), interaction.options.getInteger('수량') || 1, profile);
    await interaction.editReply({ embeds: [economyEmbed('🛒 아이템 판매 완료멍!', 0x57f287).addFields(
      { name: '판매', value: `${result.item.name} x${result.count}`, inline: true }, { name: '획득', value: formatDuc(result.earned), inline: true }, { name: '현재 잔액', value: formatDuc(result.wallet), inline: false }
    )] });
    return;
  }
  if (name === economyCommandNames.sellAll) {
    const result = await sellAllItems(interaction.guildId, interaction.user.id, interaction.options.getString('등급'), profile);
    await interaction.editReply({ embeds: [economyEmbed('🛒 전체 판매 완료멍!', 0x57f287).setDescription(truncateLines(result.sold.map((entry) => `${entry.item.name} x${entry.count} — ${formatDuc(entry.subtotal)}`))).addFields({ name: '총 획득', value: formatDuc(result.earned) }, { name: '현재 잔액', value: formatDuc(result.wallet) })] });
    return;
  }
  if (name === economyCommandNames.fishDex) {
    const result = await getFishingDex(interaction.guildId, interaction.user.id, profile);
    const grouped = gradeOrder.map((grade) => ({ grade, items: result.discovered.filter((entry) => entry.item.grade === grade) })).filter((group) => group.items.length);
    await interaction.editReply({ embeds: [economyEmbed('📖 가나디 낚시 도감멍!').setDescription(truncateLines(grouped.flatMap((group) => [`**${group.grade}**`, ...group.items.map((entry) => `• ${entry.item.name} · 발견 ${entry.count}회`)]))).addFields({ name: '발견률', value: `${result.discovered.length}/${result.total}`, inline: true }, { name: '총 낚시', value: `${result.fishingCount}회`, inline: true })] });
    return;
  }
  if (name === economyCommandNames.shop) {
    const result = await getShop(interaction.guildId, interaction.user.id, profile);
    await interaction.editReply({ embeds: [economyEmbed('🏪 가나디 상점이 열렸다멍!').setDescription(truncateLines(result.items.map((item) => `**${item.name}** (ID: ${item.id}) · ${formatDuc(item.price)}\n↳ ${item.description}`))).addFields({ name: '내 잔액', value: formatDuc(result.wallet) })] });
    return;
  }
  if (name === economyCommandNames.buy) {
    const result = await buyShopItem(interaction.guildId, interaction.user.id, interaction.options.getString('아이템', true), interaction.options.getInteger('수량') || 1, profile);
    await interaction.editReply({ embeds: [economyEmbed('🛍️ 구매 완료멍!', 0x57f287).addFields({ name: '구매', value: `${result.item.name} x${result.count}` }, { name: '사용', value: formatDuc(result.cost), inline: true }, { name: '잔액', value: formatDuc(result.wallet), inline: true })] });
    return;
  }
  if (name === economyCommandNames.equipment || name === economyCommandNames.titles) {
    const result = await getEquipment(interaction.guildId, interaction.user.id, profile);
    const description = name === economyCommandNames.titles
      ? (result.titles.map((title) => `${title === result.equippedTitle ? '✅' : '▫️'} ${title}`).join('\n') || '아직 보유한 칭호가 없다멍!')
      : [...result.rods.map(({ rod, level, equipped }) => `${equipped ? '✅' : '▫️'} **${rod.name} +${level}** — ${rod.description}`), ...result.upgrades.map((item) => `✨ ${item.name} — ${item.description}`)].join('\n');
    await interaction.editReply({ embeds: [economyEmbed(name === economyCommandNames.titles ? '🏷️ 내 칭호멍!' : '🧰 내 장비멍!').setDescription(truncateLines(description.split('\n')))] });
    return;
  }
  if (name === economyCommandNames.enhance) {
    const result = await enhanceRod(interaction.guildId, interaction.user.id, profile);
    await interaction.editReply({ embeds: [economyEmbed(result.success ? '✨ 낚싯대 강화 성공멍!' : '댕댕… 강화는 유지됐다멍.', result.success ? 0x57f287 : 0x747f8d).addFields(
      { name: '장비', value: result.rod.name, inline: true }, { name: '강화 단계', value: `+${result.beforeLevel} → +${result.level}`, inline: true }, { name: '비용', value: formatDuc(result.cost), inline: true }, { name: '성공 확률', value: `${Math.round(result.chance * 100)}%`, inline: true }
    )] });
    return;
  }
  if (name === economyCommandNames.itemInfo) {
    const item = await getItemInformation(interaction.guildId, interaction.options.getString('아이템', true));
    if (!item) throw new Error('그 아이템을 찾지 못했다멍!');
    await interaction.editReply({ embeds: [economyEmbed(`🔎 ${item.name} 정보멍!`, gradeColors[item.grade] || 0xf5a623).setDescription(item.description).addFields(
      { name: 'ID', value: `\`${item.id}\``, inline: true }, { name: '종류/등급', value: item.grade || item.type, inline: true }, { name: '가격', value: formatDuc(item.price), inline: true }
    )] });
    return;
  }
  if (name === economyCommandNames.equip) {
    const result = await equipEconomyItem(interaction.guildId, interaction.user.id, interaction.options.getString('종류', true), interaction.options.getString('이름', true), profile);
    await interaction.editReply(`✅ **${result.name}**을(를) 장착했다멍!`);
    return;
  }
  if (name === economyCommandNames.stockList) {
    const result = await getStockList(interaction.guildId, interaction.user.id, profile);
    await interaction.editReply({ embeds: [economyEmbed('📊 가나디 월드 가상 주식 목록멍!', 0x3498db).setDescription(result.stocks.map((stock) => `**${stock.name} (${stock.symbol})** · ${formatDuc(stock.price)} · ${signed(stock.changeRate.toFixed(2), '%')}`).join('\n'))] });
    return;
  }
  if (name === economyCommandNames.stockInfo) {
    const result = await getStockInformation(interaction.guildId, interaction.user.id, interaction.options.getString('종목', true), profile);
    const stock = result.stock;
    await interaction.editReply({ embeds: [economyEmbed(`📈 ${stock.name} 가상 주식 정보멍!`, stock.change >= 0 ? 0x57f287 : 0xed4245).addFields(
      { name: '현재가', value: formatDuc(stock.price), inline: true }, { name: '직전 시세 대비', value: `${signed(stock.change)} (${signed(stock.changeRate.toFixed(2), '%')})`, inline: true }, { name: '위험도', value: stock.risk, inline: true }, { name: '기업 설명', value: stock.description }, { name: '최근 가상 뉴스', value: result.news?.title || '뉴스 없음' }
    )] });
    return;
  }
  if (name === economyCommandNames.buyStock || name === economyCommandNames.sellStock) {
    const symbol = interaction.options.getString('종목', true);
    const quantity = interaction.options.getInteger('수량', true);
    const result = name === economyCommandNames.buyStock ? await buyStock(interaction.guildId, interaction.user.id, symbol, quantity, profile) : await sellStock(interaction.guildId, interaction.user.id, symbol, quantity, profile);
    const buying = name === economyCommandNames.buyStock;
    await interaction.editReply({ embeds: [economyEmbed(buying ? '📥 가상 주식 매수 완료멍!' : '📤 가상 주식 매도 완료멍!', buying ? 0x3498db : 0x57f287).addFields(
      { name: '종목', value: `${result.stock.name} (${result.stock.symbol})`, inline: true }, { name: '수량', value: `${result.count}주`, inline: true }, { name: '체결가', value: formatDuc(result.price), inline: true }, { name: '수수료', value: formatDuc(result.fee), inline: true }, { name: buying ? '최종 사용' : '최종 수령', value: formatDuc(buying ? result.total : result.received), inline: true }, { name: '잔액', value: formatDuc(result.wallet), inline: true }
    )] });
    return;
  }
  if (name === economyCommandNames.holdings) {
    const result = await getStockHoldings(interaction.guildId, interaction.user.id, profile);
    await interaction.editReply({ embeds: [economyEmbed('💼 내 가상 주식 보유 현황멍!', 0x3498db).setDescription(truncateLines(result.holdings.map((holding) => `**${holding.stock.name}** ${holding.quantity}주 · ${formatDuc(holding.value)} · 손익 ${signed(holding.profit)} 🦴`))).addFields({ name: '총 평가액', value: formatDuc(result.totalValue) })] });
    return;
  }
  if (name === economyCommandNames.stockRanking) { await interaction.editReply(await buildEconomyRankingReply(interaction.guildId, 'stock')); return; }
  if ([economyCommandNames.market, economyCommandNames.todayMarket, economyCommandNames.analysis].includes(name)) {
    const result = await getMarketOverview(interaction.guildId, interaction.user.id, profile);
    await interaction.editReply({ embeds: [economyEmbed('🌍 오늘의 가나디 월드 시장멍!', 0x5865f2).addFields(
      { name: '경제 상태', value: result.state, inline: true }, { name: '주식 평균 등락', value: signed(result.averageChangeRate.toFixed(2), '%'), inline: true }, { name: '낚시 아이템 가격', value: `기준가의 ${(result.itemPriceMultiplier * 100).toFixed(0)}%`, inline: true }, { name: '주요 뉴스', value: `${result.news?.title || '없음'}\n${result.news?.text || ''}` }
    )] });
    return;
  }
  if ([economyCommandNames.news, economyCommandNames.newsHistory].includes(name)) {
    const result = await getEconomicNews(interaction.guildId, interaction.user.id, profile);
    if (name === economyCommandNames.newsHistory) {
      await interaction.editReply({ embeds: [economyEmbed('🗞️ 최근 가상 경제뉴스 기록멍!').setDescription(truncateLines([...result.history].reverse().map((news) => `**${news.title}** [${news.category}]\n${news.text}`)))] });
    } else {
      const hint = result.subscribed ? `\n\n📰 **구독자 힌트:** ${result.news.stock ? `${result.news.stock} 종목에 ${signed(result.news.stockEffect * 100, '%')} 영향 가능성` : '특정 종목 직접 영향 없음'}` : '';
      await interaction.editReply({ embeds: [economyEmbed(`📰 ${result.news.title} 속보멍!`).setDescription(`${result.news.text}${hint}`).addFields({ name: '시장 영향', value: `아이템 가격 x${result.news.itemMultiplier} · 낚시 분위기 x${result.news.fishingMultiplier}` })] });
    }
    return;
  }
  const gameMap = new Map([
    [economyCommandNames.coin, 'coin'], [economyCommandNames.dice, 'dice'], [economyCommandNames.slot, 'slot'], [economyCommandNames.oddEven, 'odd_even'], [economyCommandNames.blackmong, 'blackmong']
  ]);
  if (gameMap.has(name)) {
    const result = await playMiniGame(interaction.guildId, interaction.user.id, gameMap.get(name), interaction.options.getInteger('베팅', true), interaction.options.getString('선택'), profile);
    const details = result.game === 'coin' ? `선택 ${result.details.choice} · 결과 ${result.details.outcome}`
      : result.game === 'dice' ? `나 ${result.details.userRoll} · 가나디 ${result.details.ganadiRoll}`
        : result.game === 'odd_even' ? `숫자 ${result.details.number} · 결과 ${result.details.outcome}`
          : result.game === 'slot' ? result.details.reels.join(' | ')
            : `나 ${result.details.userScore} · 가나디 ${result.details.ganadiScore}`;
    const rest = result.restRecommended ? '\n\n댕댕… 10번 넘게 연속으로 놀았으니 잠깐 쉬어가는 것도 좋다멍!' : '';
    await interaction.editReply({ embeds: [economyEmbed(`🎮 ${gameName(result.game)} 결과멍!`, result.result === 'win' ? 0x57f287 : result.result === 'loss' ? 0xed4245 : 0xfee75c).setDescription(`**${details}**${rest}`).addFields(
      { name: '결과', value: result.result === 'win' ? '승리!' : result.result === 'loss' ? '아쉽게 패배' : '무승부', inline: true }, { name: '베팅', value: formatDuc(result.wager), inline: true }, { name: '순변동', value: `${signed(result.net)} 🦴`, inline: true }, { name: '잔액', value: formatDuc(result.wallet), inline: true }, { name: '오늘 손실', value: `${formatDuc(result.dailyLoss)} / ${formatDuc(result.dailyLossLimit)}`, inline: true }
    )] });
    return;
  }
  if (name === economyCommandNames.gameRecord) {
    const result = await getMiniGameRecord(interaction.guildId, interaction.user.id, profile);
    await interaction.editReply({ embeds: [economyEmbed('🎮 미니게임 기록멍!').addFields(
      { name: '승/무/패', value: `${result.wins}승 · ${result.ties}무 · ${result.losses}패`, inline: true }, { name: '오늘 손실', value: `${formatDuc(result.dailyLoss)} / ${formatDuc(result.dailyLossLimit)}`, inline: true }, { name: '1회 한도', value: formatDuc(result.maxBet), inline: true }
    ).setDescription(truncateLines([...result.history].reverse().slice(0, 10).map((entry) => `${gameName(entry.game)} · ${entry.result} · ${signed(entry.net)} 🦴`)))] });
    return;
  }
  if ([economyCommandNames.quests, economyCommandNames.dailyQuests, economyCommandNames.weeklyQuests].includes(name)) {
    const result = await getQuestStatus(interaction.guildId, interaction.user.id, profile);
    const embed = economyEmbed('📜 가나디 퀘스트멍!', 0x9b59b6);
    if (name !== economyCommandNames.weeklyQuests) embed.addFields({ name: `오늘의 퀘스트 · 보상 ${formatDuc(result.daily.reward)}`, value: `${questText(result.daily)}\n보상: ${result.daily.claimed ? '수령 완료' : '미수령'}` });
    if (name !== economyCommandNames.dailyQuests) embed.addFields({ name: `이번 주 퀘스트 · 보상 ${formatDuc(result.weekly.reward)}`, value: `${questText(result.weekly)}\n보상: ${result.weekly.claimed ? '수령 완료' : '미수령'}` });
    await interaction.editReply({ embeds: [embed] });
    return;
  }
  if (name === economyCommandNames.claimQuest) {
    const result = await claimQuestReward(interaction.guildId, interaction.user.id, interaction.options.getString('종류', true), profile);
    await interaction.editReply({ embeds: [economyEmbed('🎁 퀘스트 보상 수령 완료멍!', 0x57f287).addFields({ name: '보상', value: formatDuc(result.reward), inline: true }, { name: '잔액', value: formatDuc(result.wallet), inline: true })] });
    return;
  }
  if (name === economyCommandNames.richRanking) { await interaction.editReply(await buildEconomyRankingReply(interaction.guildId, 'assets')); return; }
  if (name === economyCommandNames.fishingRanking) { await interaction.editReply(await buildEconomyRankingReply(interaction.guildId, 'fishing')); return; }
  if (name === economyCommandNames.questRanking) { await interaction.editReply(await buildEconomyRankingReply(interaction.guildId, 'quests')); return; }

  if (name === economyCommandNames.economySettings) {
    const { channel: ignored } = await requireAdmin(interaction, false);
    void ignored;
    const channel = interaction.options.getChannel('로그채널', true);
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks])) throw new Error('로그 채널에 메시지와 임베드를 보낼 권한이 필요하다멍!');
    const result = await setEconomyLogChannel(interaction.guildId, interaction.user.id, channel.id);
    await sendAdminLog(channel, interaction, result.log);
    await interaction.editReply({ content: `${channel} 채널을 경제 관리자 감사 로그 채널로 설정했다멍!`, allowedMentions: { parse: [] } });
    return;
  }
  if (name === economyCommandNames.logs) {
    await requireAdmin(interaction, false);
    const logs = await getEconomyAdminLogs(interaction.guildId);
    const text = logs.map((log, index) => `${index + 1}. [${log.createdAt}] 관리자 ${log.adminId} | ${log.action} | ${JSON.stringify(log)}`).join('\n') || '기록 없음';
    await interaction.editReply({ files: [new AttachmentBuilder(Buffer.from(`${text}\n`, 'utf8'), { name: `economy-admin-logs-${interaction.guildId}.txt` })] });
    return;
  }

  const { channel: logChannel } = await requireAdmin(interaction, true);
  let adminResult;
  if (name === economyCommandNames.adminGive || name === economyCommandNames.adminTake) {
    const target = interaction.options.getUser('유저', true);
    const amount = interaction.options.getInteger('금액', true) * (name === economyCommandNames.adminGive ? 1 : -1);
    adminResult = await adminAdjustWallet(interaction.guildId, interaction.user.id, target.id, amount, interaction.options.getString('사유', true));
    await interaction.editReply(`${target}님의 듀코인을 ${formatDuc(adminResult.amount)} ${amount > 0 ? '지급' : '회수'}했다멍! 현재 ${formatDuc(adminResult.after)}`);
  } else if (name === economyCommandNames.economyReset) {
    if (interaction.options.getString('확인', true) !== '초기화') throw new Error('확인 칸에 정확히 `초기화`라고 입력해야 한다멍!');
    const scope = interaction.options.getString('범위', true);
    const target = interaction.options.getUser('유저');
    if (scope === 'user' && !target) throw new Error('초기화할 유저를 선택해 달라멍!');
    adminResult = await adminResetEconomy(interaction.guildId, interaction.user.id, scope, target?.id || null);
    await interaction.editReply(scope === 'server' ? '서버 경제 데이터를 초기화했다멍.' : `${target}님의 경제 데이터를 초기화했다멍.`);
  } else if (name === economyCommandNames.stockAdjust) {
    adminResult = await adminSetStockPrice(interaction.guildId, interaction.user.id, interaction.options.getString('종목', true), interaction.options.getInteger('가격', true), interaction.options.getString('사유', true));
    await interaction.editReply(`${adminResult.stock.name} 가격을 ${formatDuc(adminResult.after)}로 조정했다멍!`);
  } else if (name === economyCommandNames.createNews) {
    adminResult = await adminCreateNews(interaction.guildId, interaction.user.id, {
      title: interaction.options.getString('제목', true), text: interaction.options.getString('내용', true), stock: interaction.options.getString('종목'), stockEffect: (interaction.options.getNumber('영향률') || 0) / 100
    });
    await interaction.editReply(`경제뉴스 **${adminResult.news.title}**을(를) 생성했다멍!`);
  } else if (name === economyCommandNames.addItem) {
    adminResult = await adminAddCustomItem(interaction.guildId, interaction.user.id, {
      id: interaction.options.getString('id', true), name: interaction.options.getString('이름', true), grade: interaction.options.getString('등급', true), price: interaction.options.getInteger('가격', true), weight: interaction.options.getNumber('가중치', true), description: interaction.options.getString('설명')
    });
    await interaction.editReply(`낚시 아이템 **${adminResult.item.name}**을(를) 추가했다멍!`);
  } else if (name === economyCommandNames.deleteItem) {
    adminResult = await adminDeleteCustomItem(interaction.guildId, interaction.user.id, interaction.options.getString('id', true));
    await interaction.editReply(`사용자 정의 아이템 **${adminResult.item.name}**을(를) 삭제했다멍!`);
  } else if (name === economyCommandNames.sanction) {
    const target = interaction.options.getUser('유저', true);
    adminResult = await adminSetUserBlocked(interaction.guildId, interaction.user.id, target.id, interaction.options.getString('조치', true) === 'block', interaction.options.getString('사유', true));
    await interaction.editReply(`${target}님의 경제 이용을 ${adminResult.blocked ? '제한' : '허용'}했다멍!`);
  } else if (name === economyCommandNames.probability) {
    adminResult = await adminUpdateEconomySettings(interaction.guildId, interaction.user.id, { mythicChanceMultiplier: interaction.options.getNumber('신화배수', true) });
    await interaction.editReply(`신화 아이템 상대 확률 배수를 ${adminResult.config.mythicChanceMultiplier}로 설정했다멍!`);
  } else if (name === economyCommandNames.cooldown) {
    const fishingCooldownSeconds = interaction.options.getInteger('낚시초');
    const gameCooldownSeconds = interaction.options.getInteger('미니게임초');
    if (fishingCooldownSeconds === null && gameCooldownSeconds === null) throw new Error('바꿀 쿨타임을 하나 이상 입력해 달라멍!');
    adminResult = await adminUpdateEconomySettings(interaction.guildId, interaction.user.id, { fishingCooldownSeconds, gameCooldownSeconds });
    await interaction.editReply(`쿨타임 설정을 저장했다멍! 낚시 ${adminResult.config.fishingCooldownMs / 1000}초 · 미니게임 ${adminResult.config.gameCooldownMs / 1000}초`);
  } else {
    throw new Error('지원하지 않는 가나디 월드 명령이다멍!');
  }
  await sendAdminLog(logChannel, interaction, adminResult.log);
}
