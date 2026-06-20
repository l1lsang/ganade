import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ganadiAffectionInitial = 50;
export const ganadiAffectionMin = -99999;
export const ganadiAffectionChangeLimit = 99999;

const affectionTiers = [
  { min: -99999, name: '마음을 완전히 닫음', emoji: '💔', color: 0x2b2d31 },
  { min: -10000, name: '아주 깊은 상처', emoji: '🖤', color: 0x4e342e },
  { min: -1000, name: '단단히 삐짐', emoji: '💢', color: 0x8b0000 },
  { min: -100, name: '많이 서운한 사이', emoji: '😠', color: 0xd32f2f },
  { min: 0, name: '조금 어색한 사이', emoji: '😶', color: 0x78909c },
  { min: 30, name: '첫 만남부터 호감', emoji: '🌱', color: 0x57f287 },
  { min: 60, name: '조금 친해진 사이', emoji: '🐾', color: 0x66bb6a },
  { min: 75, name: '편한 친구', emoji: '💛', color: 0xffca28 },
  { min: 90, name: '소중한 친구', emoji: '🧡', color: 0xff8a65 },
  { min: 105, name: '가나디의 최애', emoji: '💖', color: 0xf06292 },
  { min: 120, name: '영원한 단짝', emoji: '💝', color: 0xeb459e },
  { min: 500, name: '깊이 믿는 사이', emoji: '🫶', color: 0xd65db1 },
  { min: 2000, name: '운명 같은 단짝', emoji: '🌠', color: 0x9c6ade },
  { min: 10000, name: '끝없이 깊은 유대', emoji: '✨', color: 0x7c4dff }
];

const affectionDataPath = process.env.GANADI_AFFECTION_DATA_PATH
  || path.join(process.cwd(), 'data', 'ganadi-affection.json');

let affectionCache = null;
let mutationQueue = Promise.resolve();

function normalizeProfile(profile = {}) {
  return {
    username: typeof profile.username === 'string' ? profile.username.slice(0, 100) : null,
    displayName: typeof profile.displayName === 'string' ? profile.displayName.slice(0, 100) : null,
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 500) : null
  };
}

function normalizeScore(score, fallback = ganadiAffectionInitial) {
  const value = Number.isFinite(score) ? Math.floor(score) : fallback;
  return Math.max(ganadiAffectionMin, value);
}

function normalizeRecord(record = {}) {
  return {
    score: normalizeScore(record.score),
    interactions: Number.isFinite(record.interactions)
      ? Math.max(0, Math.floor(record.interactions))
      : 0,
    lastChange: Number.isFinite(record.lastChange) ? Math.trunc(record.lastChange) : 0,
    ...normalizeProfile(record),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null
  };
}

async function readAllAffection() {
  if (affectionCache) return affectionCache;

  try {
    const raw = await readFile(affectionDataPath, 'utf8');
    affectionCache = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    affectionCache = {};
  }

  return affectionCache;
}

async function writeAllAffection(data) {
  await mkdir(path.dirname(affectionDataPath), { recursive: true });
  await writeFile(affectionDataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  affectionCache = data;
}

function enqueueMutation(mutator) {
  const task = mutationQueue.then(async () => {
    const data = await readAllAffection();
    return mutator(data);
  });

  mutationQueue = task.catch(() => null);
  return task;
}

function mergeProfile(record, profile) {
  const nextProfile = normalizeProfile(profile);
  return {
    ...record,
    username: nextProfile.username || record.username,
    displayName: nextProfile.displayName || record.displayName,
    avatarUrl: nextProfile.avatarUrl || record.avatarUrl
  };
}

export async function getGanadiAffection(guildId, userId) {
  const data = await readAllAffection();
  return normalizeRecord(data[guildId]?.users?.[userId]);
}

export async function addGanadiAffection(guildId, userId, amount = 0, profile = {}, now = Date.now()) {
  return enqueueMutation(async (data) => {
    const guildData = data[guildId] || { users: {} };
    const current = normalizeRecord(guildData.users?.[userId]);
    const requestedChange = Number.isFinite(amount) ? Math.trunc(amount) : 0;
    const change = Math.max(
      -ganadiAffectionChangeLimit,
      Math.min(ganadiAffectionChangeLimit, requestedChange)
    );
    const score = normalizeScore(current.score + change);
    const next = mergeProfile({
      ...current,
      score,
      interactions: current.interactions + 1,
      lastChange: score - current.score,
      updatedAt: new Date(now).toISOString()
    }, profile);

    data[guildId] = {
      ...guildData,
      users: {
        ...(guildData.users || {}),
        [userId]: next
      },
      updatedAt: new Date(now).toISOString()
    };

    await writeAllAffection(data);
    return next;
  });
}

export function getGanadiAffectionTier(score) {
  const value = normalizeScore(score);
  return [...affectionTiers].reverse().find((tier) => value >= tier.min) || affectionTiers[0];
}

export function getNextGanadiAffectionGoal(score) {
  const value = normalizeScore(score);
  return affectionTiers.find((tier) => tier.min > value)?.min ?? null;
}

export function buildGanadiAffectionBar(score, width = 12) {
  const value = normalizeScore(score);
  const tierIndex = affectionTiers.findLastIndex((tier) => value >= tier.min);
  const currentGoal = affectionTiers[Math.max(0, tierIndex)].min;
  const nextGoal = affectionTiers[tierIndex + 1]?.min;
  const filled = nextGoal === undefined
    ? width
    : Math.round(((value - currentGoal) / (nextGoal - currentGoal)) * width);
  const normalizedFilled = Math.max(0, Math.min(width, filled));
  return `${'▰'.repeat(normalizedFilled)}${'▱'.repeat(width - normalizedFilled)}`;
}
