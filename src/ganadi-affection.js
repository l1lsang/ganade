import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ganadiAffectionMin = 50;
export const ganadiAffectionMax = 120;

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

function normalizeRecord(record = {}) {
  const rawScore = Number.isFinite(record.score) ? Math.floor(record.score) : ganadiAffectionMin;
  return {
    score: Math.max(ganadiAffectionMin, Math.min(ganadiAffectionMax, rawScore)),
    interactions: Number.isFinite(record.interactions)
      ? Math.max(0, Math.floor(record.interactions))
      : 0,
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

export async function addGanadiAffection(guildId, userId, amount = 1, profile = {}, now = Date.now()) {
  return enqueueMutation(async (data) => {
    const guildData = data[guildId] || { users: {} };
    const current = normalizeRecord(guildData.users?.[userId]);
    const increment = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
    const next = mergeProfile({
      ...current,
      score: Math.min(ganadiAffectionMax, current.score + increment),
      interactions: current.interactions + 1,
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
  const value = Math.max(ganadiAffectionMin, Math.min(ganadiAffectionMax, Math.floor(score)));
  if (value >= 120) return { name: '영원한 단짝', emoji: '💝', color: 0xeb459e };
  if (value >= 105) return { name: '가나디의 최애', emoji: '💖', color: 0xf06292 };
  if (value >= 90) return { name: '소중한 친구', emoji: '🧡', color: 0xff8a65 };
  if (value >= 75) return { name: '편한 친구', emoji: '💛', color: 0xffca28 };
  if (value >= 60) return { name: '조금 친해진 사이', emoji: '🐾', color: 0x66bb6a };
  return { name: '첫 만남부터 호감', emoji: '🌱', color: 0x57f287 };
}

export function buildGanadiAffectionBar(score, width = 12) {
  const value = Math.max(ganadiAffectionMin, Math.min(ganadiAffectionMax, Number(score) || ganadiAffectionMin));
  const filled = Math.max(0, Math.min(width, Math.round((value / ganadiAffectionMax) * width)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}
