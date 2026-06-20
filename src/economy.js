import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  dailyQuestDefinitions,
  fishingItems,
  formatDuc,
  getFishingItem,
  getRod,
  getShopItem,
  getVirtualStock,
  gradeOrder,
  newsTemplates,
  rods,
  shopItems,
  virtualStocks,
  weeklyQuestDefinitions
} from './economy-catalog.js';
import { createJsonDataStore } from './data-store.js';

const explicitEconomyPath = process.env.ECONOMY_DATA_PATH;
const economyPath = explicitEconomyPath
  || path.join(process.cwd(), 'data', 'economy.json');
const economyStore = createJsonDataStore({
  name: 'economy',
  localPath: economyPath
});
const kstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const defaultConfig = Object.freeze({
  logChannelId: null,
  fishingCooldownMs: 180_000,
  gameCooldownMs: 10_000,
  maxBet: 500,
  dailyLossLimit: 5000,
  transferFeeRate: 0.03,
  stockFeeRate: 0.01,
  mythicChanceMultiplier: 1
});

let economyCache = null;
let mutationQueue = Promise.resolve();

function secureRandom() {
  return randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;
}

function safeInteger(value, fallback = 0, minimum = 0) {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

function normalizeProfile(profile = {}, current = {}) {
  return {
    username: typeof profile.username === 'string' ? profile.username.slice(0, 100) : current.username || null,
    displayName: typeof profile.displayName === 'string' ? profile.displayName.slice(0, 100) : current.displayName || null,
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 500) : current.avatarUrl || null
  };
}

function defaultQuestPeriod(key = null) {
  return { key, progress: {}, claimed: false };
}

function defaultUser() {
  return {
    wallet: 500,
    inventory: {},
    fishDex: {},
    stocks: {},
    ownedRods: ['old_rod'],
    equippedRod: 'old_rod',
    rodLevels: { old_rod: 0 },
    upgrades: {},
    titles: [],
    equippedTitle: null,
    blocked: false,
    lastFishingAt: null,
    lastAttendanceRewardDate: null,
    quests: {
      daily: defaultQuestPeriod(),
      weekly: defaultQuestPeriod()
    },
    game: {
      date: null,
      dailyLoss: 0,
      consecutive: 0,
      lastPlayedAt: null,
      wins: 0,
      losses: 0,
      ties: 0,
      history: []
    },
    stats: {
      attendance: 0,
      fishing: 0,
      soldItems: 0,
      stockTrades: 0,
      miniGames: 0,
      questsClaimed: 0,
      transferred: 0,
      received: 0
    },
    createdAt: null,
    updatedAt: null,
    username: null,
    displayName: null,
    avatarUrl: null
  };
}

function normalizeUser(raw = {}, profile = {}, now = new Date()) {
  const base = defaultUser();
  const ownedRods = Array.isArray(raw.ownedRods) ? raw.ownedRods.filter((id) => getRod(id).id === id) : base.ownedRods;
  if (!ownedRods.includes('old_rod')) ownedRods.unshift('old_rod');
  const equippedRod = ownedRods.includes(raw.equippedRod) ? raw.equippedRod : 'old_rod';

  return {
    ...base,
    ...raw,
    wallet: safeInteger(raw.wallet, base.wallet),
    inventory: raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {},
    fishDex: raw.fishDex && typeof raw.fishDex === 'object' ? raw.fishDex : {},
    stocks: raw.stocks && typeof raw.stocks === 'object' ? raw.stocks : {},
    ownedRods,
    equippedRod,
    rodLevels: raw.rodLevels && typeof raw.rodLevels === 'object' ? raw.rodLevels : base.rodLevels,
    upgrades: raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {},
    titles: Array.isArray(raw.titles) ? raw.titles.slice(0, 100) : [],
    equippedTitle: typeof raw.equippedTitle === 'string' ? raw.equippedTitle : null,
    blocked: raw.blocked === true,
    quests: {
      daily: { ...defaultQuestPeriod(), ...(raw.quests?.daily || {}), progress: raw.quests?.daily?.progress || {} },
      weekly: { ...defaultQuestPeriod(), ...(raw.quests?.weekly || {}), progress: raw.quests?.weekly?.progress || {} }
    },
    game: {
      ...base.game,
      ...(raw.game || {}),
      history: Array.isArray(raw.game?.history) ? raw.game.history.slice(-30) : []
    },
    stats: { ...base.stats, ...(raw.stats || {}) },
    ...normalizeProfile(profile, raw),
    createdAt: raw.createdAt || now.toISOString(),
    updatedAt: raw.updatedAt || now.toISOString()
  };
}

function defaultMarket() {
  return {
    lastUpdatedHour: null,
    newsDate: null,
    news: null,
    newsHistory: [],
    itemPriceMultiplier: 1,
    fishingMultiplier: 1,
    stocks: Object.fromEntries(virtualStocks.map((stock) => [stock.symbol, {
      price: stock.initialPrice,
      previousPrice: stock.initialPrice
    }]))
  };
}

function normalizeGuild(raw = {}) {
  const market = { ...defaultMarket(), ...(raw.market || {}) };
  market.stocks = {
    ...defaultMarket().stocks,
    ...(raw.market?.stocks || {})
  };
  return {
    config: { ...defaultConfig, ...(raw.config || {}) },
    users: raw.users && typeof raw.users === 'object' ? raw.users : {},
    market,
    customItems: raw.customItems && typeof raw.customItems === 'object' ? raw.customItems : {},
    adminLogs: Array.isArray(raw.adminLogs) ? raw.adminLogs.slice(-1000) : [],
    updatedAt: raw.updatedAt || null
  };
}

async function readAllEconomy() {
  if (economyCache) return economyCache;
  economyCache = await economyStore.read();
  return economyCache;
}

async function writeAllEconomy(data) {
  await economyStore.write(data);
  economyCache = data;
}

function enqueueMutation(mutator) {
  const task = mutationQueue.then(async () => mutator(await readAllEconomy()));
  mutationQueue = task.catch(() => null);
  return task;
}

export function getEconomyTime(now = new Date()) {
  const parts = Object.fromEntries(
    kstFormatter.formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = utcDate.getUTCDay() || 7;
  const monday = new Date(utcDate.getTime() - (weekday - 1) * 86_400_000);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    week: monday.toISOString().slice(0, 10),
    hourKey: `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function ensureQuestPeriods(user, time) {
  if (user.quests.daily.key !== time.date) user.quests.daily = defaultQuestPeriod(time.date);
  if (user.quests.weekly.key !== time.week) user.quests.weekly = defaultQuestPeriod(time.week);
}

function incrementQuest(user, time, key, amount = 1) {
  ensureQuestPeriods(user, time);
  user.quests.daily.progress[key] = safeInteger(user.quests.daily.progress[key]) + amount;
  user.quests.weekly.progress[key] = safeInteger(user.quests.weekly.progress[key]) + amount;
}

function randomIndex(length, random = secureRandom) {
  return Math.floor(Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0)) * length);
}

function ensureMarket(guild, time, random = secureRandom) {
  const market = guild.market;
  if (market.newsDate !== time.date) {
    const template = newsTemplates[randomIndex(newsTemplates.length, random)];
    market.newsDate = time.date;
    market.news = { ...template, id: `${time.date}:${template.title}`, createdAt: new Date().toISOString() };
    market.newsHistory = [...(market.newsHistory || []), market.news].slice(-30);
    market.itemPriceMultiplier = template.itemMultiplier;
    market.fishingMultiplier = template.fishingMultiplier;
    market.newsAppliedHour = null;
  }

  if (market.lastUpdatedHour === time.hourKey) return;
  for (const stock of virtualStocks) {
    const current = market.stocks[stock.symbol] || { price: stock.initialPrice, previousPrice: stock.initialPrice };
    const randomChange = ((Number(random()) || 0) * 2 - 1) * stock.volatility;
    const newsChange = market.newsAppliedHour ? 0 : (market.news?.stock === stock.symbol ? market.news.stockEffect : 0);
    const previousPrice = safeInteger(current.price, stock.initialPrice, 1);
    market.stocks[stock.symbol] = {
      previousPrice,
      price: Math.max(10, Math.round(previousPrice * (1 + randomChange + newsChange)))
    };
  }
  market.newsAppliedHour = time.hourKey;
  market.lastUpdatedHour = time.hourKey;
}

function assertEconomyAccess(user) {
  if (user.blocked) throw new Error('경제 게임 이용이 제한된 계정이다멍. 관리자에게 문의해 달라멍!');
}

async function mutateUser(guildId, userId, profile, mutator, now = new Date(), { allowBlocked = false } = {}) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const time = getEconomyTime(now);
    ensureMarket(guild, time);
    const user = normalizeUser(guild.users[userId], profile, now);
    ensureQuestPeriods(user, time);
    if (!allowBlocked) assertEconomyAccess(user);
    const result = await mutator({ guild, user, time, now });
    user.updatedAt = now.toISOString();
    guild.users[userId] = user;
    guild.updatedAt = now.toISOString();
    data[guildId] = guild;
    await writeAllEconomy(data);
    return result;
  });
}

function itemPrice(guild, user, item) {
  const rod = getRod(user.equippedRod);
  const level = safeInteger(user.rodLevels[user.equippedRod]);
  const multiplier = guild.market.itemPriceMultiplier * (1 + rod.saleBonus + level * 0.005);
  return Math.max(1, Math.round(item.price * multiplier));
}

function inventoryCount(user) {
  return Object.values(user.inventory).reduce((sum, quantity) => sum + safeInteger(quantity), 0);
}

function getInventoryCapacity(user) {
  return 100 + (user.upgrades.shiny_bucket ? 50 : 0);
}

function calculateAssets(guild, user) {
  const inventoryValue = Object.entries(user.inventory).reduce((sum, [id, quantity]) => {
    const item = getFishingItem(id, guild.customItems);
    return sum + (item ? itemPrice(guild, user, item) * safeInteger(quantity) : 0);
  }, 0);
  const stockValue = Object.entries(user.stocks).reduce((sum, [symbol, holding]) => {
    return sum + safeInteger(holding.quantity) * safeInteger(guild.market.stocks[symbol]?.price);
  }, 0);
  return {
    wallet: user.wallet,
    inventoryValue,
    stockValue,
    total: user.wallet + inventoryValue + stockValue
  };
}

export async function getEconomyProfile(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user }) => ({
    user: structuredClone(user),
    assets: calculateAssets(guild, user),
    market: structuredClone(guild.market),
    config: structuredClone(guild.config)
  }), now);
}

export async function awardAttendanceEconomy(guildId, userId, attendance, profile = {}, now = new Date(), random = secureRandom) {
  return mutateUser(guildId, userId, profile, ({ user, time }) => {
    if (user.blocked) {
      return { blocked: true, alreadyRewarded: true, reward: 0, wallet: user.wallet };
    }
    if (user.lastAttendanceRewardDate === attendance.date) {
      return { alreadyRewarded: true, reward: 0, wallet: user.wallet };
    }
    const base = 100 + Math.floor((Number(random()) || 0) * 201);
    const streakBonus = Math.max(0, safeInteger(attendance.streak, 1) - 1) * 20;
    const weeklyBonus = attendance.streak > 0 && attendance.streak % 7 === 0 ? 500 : 0;
    const monthlyBonus = attendance.streak > 0 && attendance.streak % 30 === 0 ? 3000 : 0;
    const reward = base + streakBonus + weeklyBonus + monthlyBonus;
    user.wallet += reward;
    user.lastAttendanceRewardDate = attendance.date;
    user.stats.attendance += 1;
    incrementQuest(user, time, 'attendance');
    if (monthlyBonus > 0 && !user.titles.includes('30일의 듀친구')) user.titles.push('30일의 듀친구');
    return { alreadyRewarded: false, reward, base, streakBonus, weeklyBonus, monthlyBonus, wallet: user.wallet };
  }, now, { allowBlocked: true });
}

export async function transferDuc(guildId, senderId, recipientId, amount, profiles = {}, now = new Date()) {
  const numericAmount = Number(amount);
  const transferAmount = Number.isFinite(numericAmount) ? Math.floor(numericAmount) : 0;
  if (transferAmount < 1) throw new Error('송금 금액은 1 듀코인 이상이어야 한다멍!');
  if (senderId === recipientId) throw new Error('자기 자신에게는 송금할 수 없다멍!');

  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const time = getEconomyTime(now);
    ensureMarket(guild, time);
    const sender = normalizeUser(guild.users[senderId], profiles.sender, now);
    const recipient = normalizeUser(guild.users[recipientId], profiles.recipient, now);
    assertEconomyAccess(sender);
    const fee = Math.max(1, Math.ceil(transferAmount * guild.config.transferFeeRate));
    const total = transferAmount + fee;
    if (sender.wallet < total) throw new Error(`수수료를 포함해 ${formatDuc(total)}가 필요하다멍!`);
    sender.wallet -= total;
    recipient.wallet += transferAmount;
    sender.stats.transferred += transferAmount;
    recipient.stats.received += transferAmount;
    sender.updatedAt = now.toISOString();
    recipient.updatedAt = now.toISOString();
    guild.users[senderId] = sender;
    guild.users[recipientId] = recipient;
    guild.updatedAt = now.toISOString();
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { amount: transferAmount, fee, total, senderWallet: sender.wallet, recipientWallet: recipient.wallet };
  });
}

function selectFishingItem(guild, user, random = secureRandom) {
  const rod = getRod(user.equippedRod);
  const level = safeInteger(user.rodLevels[user.equippedRod]);
  const hasBait = safeInteger(user.inventory.ganadi_bait) > 0;
  const items = [...fishingItems, ...Object.values(guild.customItems)];
  const weighted = items.map((item) => {
    const gradeIndex = gradeOrder.indexOf(item.grade);
    if (item.grade === '신화' && !rod.unlockMythic) return { item, weight: 0 };
    let weight = Math.max(0, Number(item.weight) || 0);
    if (gradeIndex >= 2) weight *= guild.market.fishingMultiplier * (1 + rod.highGradeBonus * 8 + level * 0.025 + (hasBait ? 0.35 : 0));
    if (gradeIndex >= 3) weight *= 1 + rod.rareBonus * 10 + level * 0.015;
    if (item.grade === '신화') weight *= guild.config.mythicChanceMultiplier;
    return { item, weight };
  });
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = (Number(random()) || 0) * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0 && entry.weight > 0) return { item: entry.item, usedBait: hasBait };
  }
  return { item: weighted.find((entry) => entry.weight > 0).item, usedBait: hasBait };
}

export async function fish(guildId, userId, profile = {}, now = new Date(), random = secureRandom) {
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    const rod = getRod(user.equippedRod);
    const level = safeInteger(user.rodLevels[user.equippedRod]);
    const cooldownMs = Math.max(15_000, Math.round(
      guild.config.fishingCooldownMs * rod.cooldownMultiplier * Math.max(0.7, 1 - level * 0.02)
    ));
    const last = user.lastFishingAt ? new Date(user.lastFishingAt).getTime() : 0;
    const remainingMs = last + cooldownMs - now.getTime();
    if (remainingMs > 0) {
      const error = new Error(`낚싯대가 아직 쉬는 중이다멍! ${Math.ceil(remainingMs / 1000)}초 뒤에 다시 던져 달라멍.`);
      error.code = 'FISHING_COOLDOWN';
      error.remainingMs = remainingMs;
      throw error;
    }
    if (inventoryCount(user) >= getInventoryCapacity(user)) {
      throw new Error('인벤토리가 가득 찼다멍! 아이템을 판매하거나 반짝이는 양동이를 준비해 달라멍.');
    }
    const catchResult = selectFishingItem(guild, user, random);
    const item = catchResult.item;
    user.inventory[item.id] = safeInteger(user.inventory[item.id]) + 1;
    user.fishDex[item.id] = safeInteger(user.fishDex[item.id]) + 1;
    if (catchResult.usedBait) user.inventory.ganadi_bait -= 1;
    user.lastFishingAt = now.toISOString();
    user.stats.fishing += 1;
    incrementQuest(user, time, 'fishing');
    return {
      item,
      estimatedPrice: itemPrice(guild, user, item),
      usedBait: catchResult.usedBait,
      rod,
      rodLevel: level,
      cooldownMs,
      inventoryCount: inventoryCount(user),
      capacity: getInventoryCapacity(user)
    };
  }, now);
}

function findOwnedItem(guild, user, input) {
  const normalized = String(input || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
  return Object.keys(user.inventory).map((id) => getFishingItem(id, guild.customItems) || getShopItem(id))
    .find((item) => item && (item.id.toLowerCase() === normalized || item.name.toLocaleLowerCase('ko-KR') === normalized)) || null;
}

export async function getInventory(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user }) => ({
    entries: Object.entries(user.inventory).flatMap(([id, quantity]) => {
      const item = getFishingItem(id, guild.customItems) || getShopItem(id);
      return item && quantity > 0 ? [{ item, quantity, unitPrice: getFishingItem(id, guild.customItems) ? itemPrice(guild, user, item) : 0 }] : [];
    }),
    count: inventoryCount(user),
    capacity: getInventoryCapacity(user),
    wallet: user.wallet
  }), now);
}

export async function sellItem(guildId, userId, input, quantity = 1, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    const item = findOwnedItem(guild, user, input);
    if (!item || !getFishingItem(item.id, guild.customItems)) throw new Error('판매할 수 있는 낚시 아이템을 찾지 못했다멍!');
    const owned = safeInteger(user.inventory[item.id]);
    const count = Math.min(owned, safeInteger(quantity, 1, 1));
    if (!count) throw new Error('그 아이템은 인벤토리에 없다멍!');
    const unitPrice = itemPrice(guild, user, item);
    const earned = unitPrice * count;
    user.inventory[item.id] = owned - count;
    if (user.inventory[item.id] <= 0) delete user.inventory[item.id];
    user.wallet += earned;
    user.stats.soldItems += count;
    incrementQuest(user, time, 'sell', count);
    return { item, count, unitPrice, earned, wallet: user.wallet };
  }, now);
}

export async function sellAllItems(guildId, userId, grade = null, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    const sold = [];
    let earned = 0;
    let count = 0;
    for (const [id, quantity] of Object.entries({ ...user.inventory })) {
      const item = getFishingItem(id, guild.customItems);
      if (!item || (grade && item.grade !== grade)) continue;
      const itemCount = safeInteger(quantity);
      const subtotal = itemPrice(guild, user, item) * itemCount;
      if (itemCount > 0) sold.push({ item, count: itemCount, subtotal });
      count += itemCount;
      earned += subtotal;
      delete user.inventory[id];
    }
    if (!count) throw new Error(grade ? `${grade} 등급 판매 아이템이 없다멍!` : '판매할 낚시 아이템이 없다멍!');
    user.wallet += earned;
    user.stats.soldItems += count;
    incrementQuest(user, time, 'sell', count);
    return { sold, count, earned, wallet: user.wallet };
  }, now);
}

export async function getFishingDex(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user }) => {
    const items = [...fishingItems, ...Object.values(guild.customItems)];
    return {
      discovered: items.filter((item) => safeInteger(user.fishDex[item.id]) > 0).map((item) => ({ item, count: user.fishDex[item.id] })),
      total: items.length,
      fishingCount: user.stats.fishing
    };
  }, now);
}

export async function buyShopItem(guildId, userId, itemId, quantity = 1, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ user }) => {
    const item = getShopItem(itemId);
    if (!item) throw new Error('상점에서 그 아이템을 찾지 못했다멍!');
    const count = item.unique ? 1 : Math.min(100, safeInteger(quantity, 1, 1));
    const alreadyOwned = item.type === 'rod'
      ? user.ownedRods.includes(item.id)
      : item.type === 'title'
        ? user.titles.includes(item.title)
        : Boolean(user.upgrades[item.id]);
    if (item.unique && alreadyOwned) throw new Error('이미 보유한 아이템이다멍!');
    const cost = item.price * count;
    if (user.wallet < cost) throw new Error(`${formatDuc(cost)}가 필요하지만 지갑이 부족하다멍!`);
    user.wallet -= cost;
    if (item.type === 'rod') {
      user.ownedRods.push(item.id);
      user.rodLevels[item.id] = 0;
    } else if (item.type === 'title') {
      user.titles.push(item.title);
    } else if (item.unique) {
      user.upgrades[item.id] = true;
    } else {
      user.inventory[item.id] = safeInteger(user.inventory[item.id]) + count;
    }
    return { item, count, cost, wallet: user.wallet };
  }, now);
}

export async function getEquipment(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ user }) => ({
    rods: user.ownedRods.map((id) => ({ rod: getRod(id), level: safeInteger(user.rodLevels[id]), equipped: id === user.equippedRod })),
    upgrades: Object.keys(user.upgrades).filter((id) => user.upgrades[id]).map((id) => getShopItem(id)).filter(Boolean),
    titles: user.titles,
    equippedTitle: user.equippedTitle,
    wallet: user.wallet
  }), now);
}

export async function equipEconomyItem(guildId, userId, type, input, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ user }) => {
    const normalized = String(input || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
    if (type === 'rod') {
      const rod = rods.find((entry) => entry.id.toLowerCase() === normalized || entry.name.toLocaleLowerCase('ko-KR') === normalized);
      if (!rod || !user.ownedRods.includes(rod.id)) throw new Error('보유한 낚싯대를 찾지 못했다멍!');
      user.equippedRod = rod.id;
      return { type, name: rod.name };
    }
    const title = user.titles.find((entry) => entry.toLocaleLowerCase('ko-KR') === normalized);
    if (!title) throw new Error('보유한 칭호를 찾지 못했다멍!');
    user.equippedTitle = title;
    return { type: 'title', name: title };
  }, now);
}

export async function enhanceRod(guildId, userId, profile = {}, now = new Date(), random = secureRandom) {
  return mutateUser(guildId, userId, profile, ({ user }) => {
    const rod = getRod(user.equippedRod);
    const level = safeInteger(user.rodLevels[rod.id]);
    if (level >= 10) throw new Error('이미 최대 강화 단계 +10이다멍!');
    const cost = Math.max(300, Math.round((rod.price * 0.04 + 300) * (level + 1) ** 1.55));
    if (user.wallet < cost) throw new Error(`강화 비용 ${formatDuc(cost)}가 부족하다멍!`);
    user.wallet -= cost;
    const chance = Math.max(0.35, 0.85 - level * 0.05);
    const success = (Number(random()) || 0) < chance;
    if (success) user.rodLevels[rod.id] = level + 1;
    return { rod, beforeLevel: level, level: success ? level + 1 : level, cost, chance, success, wallet: user.wallet };
  }, now);
}

export async function getShop(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ user }) => ({ items: shopItems, wallet: user.wallet }), now);
}

export async function getItemInformation(guildId, input, now = new Date()) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    ensureMarket(guild, getEconomyTime(now));
    const normalized = String(input || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
    const item = [...fishingItems, ...Object.values(guild.customItems), ...shopItems]
      .find((entry) => entry.id.toLowerCase() === normalized || entry.name.toLocaleLowerCase('ko-KR') === normalized);
    data[guildId] = guild;
    await writeAllEconomy(data);
    return item || null;
  });
}

function stockSnapshot(guild, stock) {
  const quote = guild.market.stocks[stock.symbol];
  const change = quote.price - quote.previousPrice;
  return {
    ...stock,
    price: quote.price,
    previousPrice: quote.previousPrice,
    change,
    changeRate: quote.previousPrice ? (change / quote.previousPrice) * 100 : 0
  };
}

export async function getStockList(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild }) => ({
    stocks: virtualStocks.map((stock) => stockSnapshot(guild, stock)),
    notice: '모든 종목은 현실과 무관한 가나디 월드의 가상 주식이다멍!'
  }), now);
}

export async function getStockInformation(guildId, userId, symbol, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    const stock = getVirtualStock(symbol);
    if (!stock) throw new Error('그 가상 종목을 찾지 못했다멍!');
    incrementQuest(user, time, 'stock_info');
    return { stock: stockSnapshot(guild, stock), news: guild.market.news };
  }, now);
}

export async function buyStock(guildId, userId, symbol, quantity, profile = {}, now = new Date()) {
  const count = Math.floor(Number(quantity));
  if (!Number.isFinite(count) || count < 1) throw new Error('매수 수량은 1주 이상이어야 한다멍!');
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    const stock = getVirtualStock(symbol);
    if (!stock) throw new Error('그 가상 종목을 찾지 못했다멍!');
    const price = guild.market.stocks[stock.symbol].price;
    const subtotal = price * count;
    const fee = Math.max(1, Math.ceil(subtotal * guild.config.stockFeeRate));
    const total = subtotal + fee;
    if (user.wallet < total) throw new Error(`수수료 포함 ${formatDuc(total)}가 필요하다멍!`);
    const current = user.stocks[stock.symbol] || { quantity: 0, totalCost: 0 };
    user.wallet -= total;
    user.stocks[stock.symbol] = {
      quantity: safeInteger(current.quantity) + count,
      totalCost: safeInteger(current.totalCost) + subtotal
    };
    user.stats.stockTrades += 1;
    incrementQuest(user, time, 'stock_trade');
    return { stock, count, price, subtotal, fee, total, wallet: user.wallet, holding: user.stocks[stock.symbol] };
  }, now);
}

export async function sellStock(guildId, userId, symbol, quantity, profile = {}, now = new Date()) {
  const count = Math.floor(Number(quantity));
  if (!Number.isFinite(count) || count < 1) throw new Error('매도 수량은 1주 이상이어야 한다멍!');
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    const stock = getVirtualStock(symbol);
    if (!stock) throw new Error('그 가상 종목을 찾지 못했다멍!');
    const current = user.stocks[stock.symbol] || { quantity: 0, totalCost: 0 };
    if (safeInteger(current.quantity) < count) throw new Error('보유 수량이 부족하다멍!');
    const price = guild.market.stocks[stock.symbol].price;
    const subtotal = price * count;
    const fee = Math.max(1, Math.ceil(subtotal * guild.config.stockFeeRate));
    const received = Math.max(0, subtotal - fee);
    const averageCost = current.quantity ? current.totalCost / current.quantity : 0;
    const realizedProfit = Math.round(received - averageCost * count);
    user.wallet += received;
    const remaining = current.quantity - count;
    if (remaining > 0) {
      user.stocks[stock.symbol] = {
        quantity: remaining,
        totalCost: Math.max(0, Math.round(current.totalCost - averageCost * count))
      };
    } else {
      delete user.stocks[stock.symbol];
    }
    user.stats.stockTrades += 1;
    incrementQuest(user, time, 'stock_trade');
    return { stock, count, price, subtotal, fee, received, realizedProfit, wallet: user.wallet, remaining };
  }, now);
}

export async function getStockHoldings(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user }) => {
    const holdings = Object.entries(user.stocks).flatMap(([symbol, holding]) => {
      const stock = getVirtualStock(symbol);
      if (!stock || !holding.quantity) return [];
      const currentPrice = guild.market.stocks[symbol].price;
      const value = currentPrice * holding.quantity;
      return [{ stock, ...holding, currentPrice, value, profit: value - holding.totalCost }];
    });
    return { holdings, totalValue: holdings.reduce((sum, holding) => sum + holding.value, 0) };
  }, now);
}

export async function getEconomicNews(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    incrementQuest(user, time, 'news');
    return {
      news: guild.market.news,
      subscribed: Boolean(user.upgrades.newspaper_subscription),
      history: guild.market.newsHistory
    };
  }, now);
}

export async function getMarketOverview(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild }) => {
    const stocks = virtualStocks.map((stock) => stockSnapshot(guild, stock));
    const average = stocks.reduce((sum, stock) => sum + stock.changeRate, 0) / stocks.length;
    const state = average >= 5 ? '과열' : average >= 1 ? '호황' : average <= -5 ? '침체' : average <= -1 ? '불황' : '안정';
    return {
      state,
      averageChangeRate: average,
      stocks,
      news: guild.market.news,
      itemPriceMultiplier: guild.market.itemPriceMultiplier,
      fishingMultiplier: guild.market.fishingMultiplier
    };
  }, now);
}

function draw(max, random = secureRandom) {
  return Math.floor(Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0)) * max);
}

function resolveGame(game, choice, random) {
  if (game === 'coin') {
    const outcome = draw(2, random) === 0 ? '앞' : '뒤';
    const win = choice === outcome;
    return { result: win ? 'win' : 'loss', multiplier: win ? 2 : 0, details: { choice, outcome } };
  }
  if (game === 'dice') {
    const userRoll = draw(6, random) + 1;
    const ganadiRoll = draw(6, random) + 1;
    const result = userRoll === ganadiRoll ? 'tie' : userRoll > ganadiRoll ? 'win' : 'loss';
    return { result, multiplier: result === 'win' ? 2 : result === 'tie' ? 1 : 0, details: { userRoll, ganadiRoll } };
  }
  if (game === 'odd_even') {
    const number = draw(6, random) + 1;
    const outcome = number % 2 === 0 ? '짝' : '홀';
    const win = choice === outcome;
    return { result: win ? 'win' : 'loss', multiplier: win ? 2 : 0, details: { choice, outcome, number } };
  }
  if (game === 'slot') {
    const symbols = ['🍖', '🐟', '🦴', '🍀', '⭐'];
    const reels = [symbols[draw(symbols.length, random)], symbols[draw(symbols.length, random)], symbols[draw(symbols.length, random)]];
    const unique = new Set(reels).size;
    const multiplier = unique === 1 ? (reels[0] === '🦴' ? 5 : 4) : unique === 2 ? 1.5 : 0;
    return { result: multiplier > 1 ? 'win' : multiplier === 1 ? 'tie' : 'loss', multiplier, details: { reels } };
  }
  if (game === 'blackmong') {
    const userCards = [draw(11, random) + 1, draw(11, random) + 1];
    const ganadiCards = [draw(11, random) + 1, draw(11, random) + 1];
    const userScore = userCards.reduce((sum, card) => sum + card, 0);
    const ganadiScore = ganadiCards.reduce((sum, card) => sum + card, 0);
    const userDistance = userScore > 21 ? 999 : 21 - userScore;
    const ganadiDistance = ganadiScore > 21 ? 999 : 21 - ganadiScore;
    const result = userDistance === ganadiDistance ? 'tie' : userDistance < ganadiDistance ? 'win' : 'loss';
    return { result, multiplier: result === 'win' ? 2 : result === 'tie' ? 1 : 0, details: { userCards, ganadiCards, userScore, ganadiScore } };
  }
  throw new Error('지원하지 않는 미니게임이다멍!');
}

export async function playMiniGame(guildId, userId, game, bet, choice = null, profile = {}, now = new Date(), random = secureRandom) {
  const wager = Math.floor(Number(bet));
  if (!Number.isFinite(wager) || wager < 1) throw new Error('베팅은 1 듀코인 이상이어야 한다멍!');
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    if (wager > guild.config.maxBet) throw new Error(`한 번에 최대 ${formatDuc(guild.config.maxBet)}까지만 사용할 수 있다멍!`);
    if (user.wallet < wager) throw new Error('지갑의 듀코인이 부족하다멍!');
    if (user.game.date !== time.date) {
      user.game.date = time.date;
      user.game.dailyLoss = 0;
      user.game.consecutive = 0;
    }
    const lastPlayed = user.game.lastPlayedAt ? new Date(user.game.lastPlayedAt).getTime() : 0;
    const remainingMs = lastPlayed + guild.config.gameCooldownMs - now.getTime();
    if (remainingMs > 0) throw new Error(`${Math.ceil(remainingMs / 1000)}초 뒤에 다시 놀아 달라멍!`);
    if (user.game.dailyLoss + wager > guild.config.dailyLossLimit) {
      throw new Error(`오늘 손실 한도 ${formatDuc(guild.config.dailyLossLimit)}에 가까워서 더는 진행할 수 없다멍. 내일 다시 즐기자멍!`);
    }
    if (lastPlayed && now.getTime() - lastPlayed > 30 * 60_000) user.game.consecutive = 0;
    const outcome = resolveGame(game, choice, random);
    user.wallet -= wager;
    let payout = Math.floor(wager * outcome.multiplier);
    if (outcome.result === 'win' && user.upgrades.lucky_collar) payout += Math.floor((payout - wager) * 0.05);
    user.wallet += payout;
    const net = payout - wager;
    if (net < 0) user.game.dailyLoss += -net;
    user.game.consecutive += 1;
    user.game.lastPlayedAt = now.toISOString();
    user.game[outcome.result === 'win' ? 'wins' : outcome.result === 'loss' ? 'losses' : 'ties'] += 1;
    user.stats.miniGames += 1;
    incrementQuest(user, time, 'mini_game');
    const historyEntry = { game, wager, payout, net, result: outcome.result, createdAt: now.toISOString() };
    user.game.history = [...user.game.history, historyEntry].slice(-30);
    return {
      game,
      wager,
      payout,
      net,
      wallet: user.wallet,
      dailyLoss: user.game.dailyLoss,
      dailyLossLimit: guild.config.dailyLossLimit,
      consecutive: user.game.consecutive,
      restRecommended: user.game.consecutive >= 10,
      ...outcome
    };
  }, now);
}

export async function getMiniGameRecord(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ guild, user, time }) => {
    if (user.game.date !== time.date) {
      user.game.date = time.date;
      user.game.dailyLoss = 0;
      user.game.consecutive = 0;
    }
    return { ...structuredClone(user.game), dailyLossLimit: guild.config.dailyLossLimit, maxBet: guild.config.maxBet };
  }, now);
}

function questRows(period, definitions) {
  return definitions.map((definition) => ({
    ...definition,
    progress: Math.min(definition.goal, safeInteger(period.progress[definition.key])),
    complete: safeInteger(period.progress[definition.key]) >= definition.goal
  }));
}

export async function getQuestStatus(guildId, userId, profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ user }) => ({
    daily: { ...structuredClone(user.quests.daily), rows: questRows(user.quests.daily, dailyQuestDefinitions), reward: 500 },
    weekly: { ...structuredClone(user.quests.weekly), rows: questRows(user.quests.weekly, weeklyQuestDefinitions), reward: 3000 }
  }), now);
}

export async function claimQuestReward(guildId, userId, type = 'daily', profile = {}, now = new Date()) {
  return mutateUser(guildId, userId, profile, ({ user }) => {
    const isWeekly = type === 'weekly';
    const period = isWeekly ? user.quests.weekly : user.quests.daily;
    const definitions = isWeekly ? weeklyQuestDefinitions : dailyQuestDefinitions;
    const reward = isWeekly ? 3000 : 500;
    if (period.claimed) throw new Error('이미 이 퀘스트 보상을 받았다멍!');
    const rows = questRows(period, definitions);
    if (!rows.every((row) => row.complete)) throw new Error('아직 완료하지 못한 퀘스트가 있다멍!');
    period.claimed = true;
    user.wallet += reward;
    user.stats.questsClaimed += 1;
    if (isWeekly && !user.titles.includes('성실한 듀친구')) user.titles.push('성실한 듀친구');
    return { type, reward, wallet: user.wallet, titleAwarded: isWeekly ? '성실한 듀친구' : null };
  }, now);
}

export async function getEconomyRanking(guildId, type = 'assets', limit = 10, now = new Date()) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    ensureMarket(guild, getEconomyTime(now));
    const rows = Object.entries(guild.users).map(([userId, raw]) => {
      const user = normalizeUser(raw, {}, now);
      const assets = calculateAssets(guild, user);
      const stockProfit = Object.entries(user.stocks).reduce((sum, [symbol, holding]) => {
        return sum + safeInteger(holding.quantity) * safeInteger(guild.market.stocks[symbol]?.price) - safeInteger(holding.totalCost);
      }, 0);
      const value = type === 'wallet' ? user.wallet
        : type === 'fishing' ? user.stats.fishing
          : type === 'quests' ? user.stats.questsClaimed
            : type === 'stock' ? stockProfit
              : assets.total;
      return { userId, value, user, assets, hasStock: Object.keys(user.stocks).length > 0 };
    }).filter((row) => type === 'stock' ? row.hasStock : row.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
    data[guildId] = guild;
    await writeAllEconomy(data);
    return rows;
  });
}

function createAdminLog(adminId, action, values = {}, now = new Date()) {
  return {
    id: randomUUID(),
    adminId,
    action,
    createdAt: now.toISOString(),
    ...values
  };
}

function appendAdminLog(guild, log) {
  guild.adminLogs = [...guild.adminLogs, log].slice(-1000);
  return log;
}

export async function getEconomyConfig(guildId) {
  const data = await readAllEconomy();
  return structuredClone(normalizeGuild(data[guildId]).config);
}

export async function setEconomyLogChannel(guildId, adminId, channelId, now = new Date()) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    guild.config.logChannelId = String(channelId || '').trim() || null;
    const log = appendAdminLog(guild, createAdminLog(adminId, '경제 로그 채널 설정', { channelId: guild.config.logChannelId }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { config: guild.config, log };
  });
}

export async function adminAdjustWallet(guildId, adminId, userId, amount, reason, now = new Date()) {
  const delta = Math.trunc(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) throw new Error('조정 금액이 올바르지 않다멍!');
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const user = normalizeUser(guild.users[userId], {}, now);
    const before = user.wallet;
    user.wallet = Math.max(0, user.wallet + delta);
    user.updatedAt = now.toISOString();
    guild.users[userId] = user;
    const actual = user.wallet - before;
    const log = appendAdminLog(guild, createAdminLog(adminId, delta > 0 ? '듀코인 지급' : '듀코인 회수', {
      userId, amount: Math.abs(actual), reason: String(reason || '사유 없음').slice(0, 300), before, after: user.wallet
    }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { amount: Math.abs(actual), before, after: user.wallet, log };
  });
}

export async function adminResetEconomy(guildId, adminId, scope, userId, now = new Date()) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    if (scope === 'server') guild.users = {};
    else if (userId) delete guild.users[userId];
    else throw new Error('초기화할 유저를 선택해 달라멍!');
    const log = appendAdminLog(guild, createAdminLog(adminId, '경제 데이터 초기화', { scope, userId: userId || null }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { scope, userId, log };
  });
}

export async function adminSetStockPrice(guildId, adminId, symbol, price, reason, now = new Date()) {
  const nextPrice = Math.floor(Number(price));
  const stock = getVirtualStock(symbol);
  if (!stock || !Number.isFinite(nextPrice) || nextPrice < 10) throw new Error('종목 또는 가격이 올바르지 않다멍!');
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const current = guild.market.stocks[stock.symbol] || { price: stock.initialPrice, previousPrice: stock.initialPrice };
    guild.market.stocks[stock.symbol] = { previousPrice: current.price, price: nextPrice };
    const log = appendAdminLog(guild, createAdminLog(adminId, '가상 주가 조정', {
      symbol: stock.symbol, before: current.price, after: nextPrice, reason: String(reason || '사유 없음').slice(0, 300)
    }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { stock, before: current.price, after: nextPrice, log };
  });
}

export async function adminCreateNews(guildId, adminId, values, now = new Date()) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const time = getEconomyTime(now);
    const news = {
      id: `admin-${now.getTime()}`,
      title: String(values.title || '관리자 경제 뉴스').slice(0, 100),
      category: '관리자 뉴스',
      text: String(values.text || '').slice(0, 1000),
      stock: getVirtualStock(values.stock)?.symbol || null,
      stockEffect: Math.max(-0.3, Math.min(0.3, Number(values.stockEffect) || 0)),
      itemMultiplier: 1,
      fishingMultiplier: 1,
      createdAt: now.toISOString()
    };
    guild.market.newsDate = time.date;
    guild.market.news = news;
    guild.market.newsAppliedHour = null;
    guild.market.newsHistory = [...guild.market.newsHistory, news].slice(-30);
    const log = appendAdminLog(guild, createAdminLog(adminId, '경제 뉴스 생성', { newsId: news.id, title: news.title }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { news, log };
  });
}

export async function adminAddCustomItem(guildId, adminId, values, now = new Date()) {
  const id = String(values.id || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{2,32}$/.test(id)) throw new Error('아이템 ID는 영문 소문자, 숫자, 밑줄 2~32자로 입력해 달라멍!');
  if (!gradeOrder.includes(values.grade)) throw new Error('올바른 아이템 등급이 아니다멍!');
  const item = {
    id,
    name: String(values.name || '').trim().slice(0, 50),
    grade: values.grade,
    price: safeInteger(Number(values.price), 1, 1),
    weight: Math.max(0.01, Number(values.weight) || 1),
    description: String(values.description || '관리자가 추가한 아이템이다멍!').slice(0, 300)
  };
  if (!item.name) throw new Error('아이템 이름을 입력해 달라멍!');
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    if (getFishingItem(id, guild.customItems)) throw new Error('이미 존재하는 아이템 ID다멍!');
    guild.customItems[id] = item;
    const log = appendAdminLog(guild, createAdminLog(adminId, '낚시 아이템 추가', { itemId: id, itemName: item.name }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { item, log };
  });
}

export async function adminDeleteCustomItem(guildId, adminId, itemId, now = new Date()) {
  const id = String(itemId || '').trim().toLowerCase();
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const item = guild.customItems[id];
    if (!item) throw new Error('삭제할 사용자 정의 아이템을 찾지 못했다멍!');
    delete guild.customItems[id];
    let removedCount = 0;
    for (const user of Object.values(guild.users)) {
      removedCount += safeInteger(user.inventory?.[id]);
      if (user.inventory) delete user.inventory[id];
    }
    const log = appendAdminLog(guild, createAdminLog(adminId, '낚시 아이템 삭제', { itemId: id, itemName: item.name, removedCount }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { item, removedCount, log };
  });
}

export async function adminSetUserBlocked(guildId, adminId, userId, blocked, reason, now = new Date()) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const user = normalizeUser(guild.users[userId], {}, now);
    user.blocked = Boolean(blocked);
    guild.users[userId] = user;
    const log = appendAdminLog(guild, createAdminLog(adminId, blocked ? '경제 이용 제재' : '경제 이용 제재 해제', {
      userId, reason: String(reason || '사유 없음').slice(0, 300)
    }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { blocked: user.blocked, log };
  });
}

export async function adminUpdateEconomySettings(guildId, adminId, changes, now = new Date()) {
  return enqueueMutation(async (data) => {
    const guild = normalizeGuild(data[guildId]);
    const next = {};
    if (Number.isFinite(changes.mythicChanceMultiplier)) next.mythicChanceMultiplier = Math.max(0, Math.min(10, changes.mythicChanceMultiplier));
    if (Number.isFinite(changes.fishingCooldownSeconds)) next.fishingCooldownMs = Math.max(15, Math.min(3600, changes.fishingCooldownSeconds)) * 1000;
    if (Number.isFinite(changes.gameCooldownSeconds)) next.gameCooldownMs = Math.max(1, Math.min(300, changes.gameCooldownSeconds)) * 1000;
    guild.config = { ...guild.config, ...next };
    const log = appendAdminLog(guild, createAdminLog(adminId, '경제 확률·쿨타임 설정', { changes: next }, now));
    data[guildId] = guild;
    await writeAllEconomy(data);
    return { config: guild.config, changes: next, log };
  });
}

export async function getEconomyAdminLogs(guildId, limit = 1000) {
  const data = await readAllEconomy();
  return normalizeGuild(data[guildId]).adminLogs.slice(-Math.max(1, Math.min(1000, limit)));
}
