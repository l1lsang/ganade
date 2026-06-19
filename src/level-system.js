import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const levelDataPath = process.env.LEVEL_DATA_PATH || path.join(process.cwd(), 'data', 'levels.json');
const activeVoiceSessions = new Map();

let levelDataCache = null;
let mutationQueue = Promise.resolve();

function voiceSessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function normalizeProfile(profile = {}) {
  return {
    username: typeof profile.username === 'string' ? profile.username.slice(0, 100) : null,
    displayName: typeof profile.displayName === 'string' ? profile.displayName.slice(0, 100) : null,
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 500) : null
  };
}

function normalizeUserStats(stats = {}) {
  return {
    chatCharacters: Number.isFinite(stats.chatCharacters) ? Math.max(0, Math.floor(stats.chatCharacters)) : 0,
    chatMessages: Number.isFinite(stats.chatMessages) ? Math.max(0, Math.floor(stats.chatMessages)) : 0,
    voiceSeconds: Number.isFinite(stats.voiceSeconds) ? Math.max(0, Math.floor(stats.voiceSeconds)) : 0,
    ...normalizeProfile(stats),
    updatedAt: typeof stats.updatedAt === 'string' ? stats.updatedAt : null
  };
}

async function readAllLevelData() {
  if (levelDataCache) return levelDataCache;

  try {
    const raw = await readFile(levelDataPath, 'utf8');
    levelDataCache = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    levelDataCache = {};
  }

  return levelDataCache;
}

async function writeAllLevelData(data) {
  await mkdir(path.dirname(levelDataPath), { recursive: true });
  await writeFile(levelDataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  levelDataCache = data;
}

function enqueueMutation(mutator) {
  const task = mutationQueue.then(async () => {
    const data = await readAllLevelData();
    return mutator(data);
  });

  mutationQueue = task.catch(() => null);
  return task;
}

function mergeProfile(stats, profile) {
  const normalized = normalizeProfile(profile);
  return {
    ...stats,
    username: normalized.username || stats.username,
    displayName: normalized.displayName || stats.displayName,
    avatarUrl: normalized.avatarUrl || stats.avatarUrl
  };
}

function getStoredUser(data, guildId, userId) {
  return normalizeUserStats(data[guildId]?.users?.[userId]);
}

function setStoredUser(data, guildId, userId, stats, now) {
  const guildData = data[guildId] || { users: {} };
  data[guildId] = {
    ...guildData,
    users: {
      ...(guildData.users || {}),
      [userId]: stats
    },
    updatedAt: new Date(now).toISOString()
  };
}

function getLiveVoiceSeconds(guildId, userId, now = Date.now()) {
  const session = activeVoiceSessions.get(voiceSessionKey(guildId, userId));
  if (!session) return 0;
  return Math.max(0, Math.floor((now - session.startedAt) / 1000));
}

export function countMessageCharacters(content) {
  return Array.from(String(content || '').normalize('NFKC').replace(/\s/gu, '')).length;
}

export function getLevelRules() {
  return {
    chatXpPerCharacter: config.levelChatXpPerCharacter,
    voiceXpPerMinute: config.levelVoiceXpPerMinute,
    levelXpStep: config.levelXpStep
  };
}

export function calculateLevelStats(rawStats = {}) {
  const stats = normalizeUserStats(rawStats);
  const chatXp = stats.chatCharacters * config.levelChatXpPerCharacter;
  const voiceMinutes = Math.floor(stats.voiceSeconds / 60);
  const voiceXp = voiceMinutes * config.levelVoiceXpPerMinute;
  const totalXp = chatXp + voiceXp;
  const level = Math.floor(Math.sqrt(totalXp / config.levelXpStep)) + 1;
  const currentLevelXp = config.levelXpStep * ((level - 1) ** 2);
  const nextLevelXp = config.levelXpStep * (level ** 2);
  const progressXp = totalXp - currentLevelXp;
  const requiredXp = nextLevelXp - currentLevelXp;

  return {
    ...stats,
    chatXp,
    voiceMinutes,
    voiceXp,
    totalXp,
    level,
    currentLevelXp,
    nextLevelXp,
    progressXp,
    requiredXp,
    progressPercent: requiredXp > 0 ? Math.min(100, Math.floor((progressXp / requiredXp) * 100)) : 100
  };
}

export async function recordChatActivity(guildId, userId, content, profile = {}, now = Date.now()) {
  const characters = countMessageCharacters(content);
  if (characters < 1) return null;

  return enqueueMutation(async (data) => {
    const current = mergeProfile(getStoredUser(data, guildId, userId), profile);
    const next = {
      ...current,
      chatCharacters: current.chatCharacters + characters,
      chatMessages: current.chatMessages + 1,
      updatedAt: new Date(now).toISOString()
    };

    setStoredUser(data, guildId, userId, next, now);
    await writeAllLevelData(data);
    return calculateLevelStats(next);
  });
}

export function startVoiceSession(guildId, userId, profile = {}, now = Date.now()) {
  const key = voiceSessionKey(guildId, userId);
  if (activeVoiceSessions.has(key)) return false;

  activeVoiceSessions.set(key, {
    guildId,
    userId,
    profile: normalizeProfile(profile),
    startedAt: now
  });
  return true;
}

export async function endVoiceSession(guildId, userId, now = Date.now()) {
  const key = voiceSessionKey(guildId, userId);
  const session = activeVoiceSessions.get(key);
  if (!session) return null;
  activeVoiceSessions.delete(key);

  const elapsedSeconds = Math.max(0, Math.floor((now - session.startedAt) / 1000));
  if (elapsedSeconds < 1) return null;

  return enqueueMutation(async (data) => {
    const current = mergeProfile(getStoredUser(data, guildId, userId), session.profile);
    const next = {
      ...current,
      voiceSeconds: current.voiceSeconds + elapsedSeconds,
      updatedAt: new Date(now).toISOString()
    };

    setStoredUser(data, guildId, userId, next, now);
    await writeAllLevelData(data);
    return calculateLevelStats(next);
  });
}

export async function checkpointVoiceSessions(now = Date.now()) {
  const elapsedSessions = [];

  for (const session of activeVoiceSessions.values()) {
    const elapsedSeconds = Math.max(0, Math.floor((now - session.startedAt) / 1000));
    if (elapsedSeconds < 1) continue;

    elapsedSessions.push({ ...session, elapsedSeconds });
    session.startedAt += elapsedSeconds * 1000;
  }

  if (elapsedSessions.length === 0) return 0;

  return enqueueMutation(async (data) => {
    for (const session of elapsedSessions) {
      const current = mergeProfile(getStoredUser(data, session.guildId, session.userId), session.profile);
      const next = {
        ...current,
        voiceSeconds: current.voiceSeconds + session.elapsedSeconds,
        updatedAt: new Date(now).toISOString()
      };
      setStoredUser(data, session.guildId, session.userId, next, now);
    }

    await writeAllLevelData(data);
    return elapsedSessions.length;
  });
}

export async function getUserLevelStats(guildId, userId, now = Date.now()) {
  await mutationQueue;
  const data = await readAllLevelData();
  const stored = getStoredUser(data, guildId, userId);
  const session = activeVoiceSessions.get(voiceSessionKey(guildId, userId));
  const profile = session ? mergeProfile(stored, session.profile) : stored;

  return calculateLevelStats({
    ...profile,
    voiceSeconds: stored.voiceSeconds + getLiveVoiceSeconds(guildId, userId, now)
  });
}

function compareRankingEntries(type, a, b) {
  if (type === 'chat') {
    return b.chatCharacters - a.chatCharacters || b.chatMessages - a.chatMessages || b.totalXp - a.totalXp;
  }

  if (type === 'voice') {
    return b.voiceSeconds - a.voiceSeconds || b.voiceXp - a.voiceXp || b.totalXp - a.totalXp;
  }

  return b.totalXp - a.totalXp || b.level - a.level || b.chatCharacters - a.chatCharacters || b.voiceSeconds - a.voiceSeconds;
}

export async function getLevelRanking(guildId, type = 'overall', limit = 50, now = Date.now()) {
  if (!['overall', 'chat', 'voice'].includes(type)) {
    throw new Error('지원하지 않는 랭킹 종류입니다.');
  }

  await mutationQueue;
  const data = await readAllLevelData();
  const storedUsers = data[guildId]?.users || {};
  const userIds = new Set(Object.keys(storedUsers));

  for (const session of activeVoiceSessions.values()) {
    if (session.guildId === guildId) userIds.add(session.userId);
  }

  const ranking = [...userIds]
    .map((userId) => {
      const stored = getStoredUser(data, guildId, userId);
      const session = activeVoiceSessions.get(voiceSessionKey(guildId, userId));
      const profile = session ? mergeProfile(stored, session.profile) : stored;
      return {
        userId,
        ...calculateLevelStats({
          ...profile,
          voiceSeconds: stored.voiceSeconds + getLiveVoiceSeconds(guildId, userId, now)
        })
      };
    })
    .filter((entry) => {
      if (type === 'chat') return entry.chatCharacters > 0;
      if (type === 'voice') return entry.voiceSeconds > 0;
      return entry.totalXp > 0;
    })
    .sort((a, b) => compareRankingEntries(type, a, b));

  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 50;
  return ranking.slice(0, safeLimit).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export async function getUserLevelRank(guildId, userId, type = 'overall', now = Date.now()) {
  const ranking = await getLevelRanking(guildId, type, Number.MAX_SAFE_INTEGER, now);
  return ranking.find((entry) => entry.userId === userId)?.rank || null;
}

export async function getLevelSummary(guildId, now = Date.now()) {
  await mutationQueue;
  const data = await readAllLevelData();
  const storedUsers = data[guildId]?.users || {};
  const userIds = new Set(Object.keys(storedUsers));

  for (const session of activeVoiceSessions.values()) {
    if (session.guildId === guildId) userIds.add(session.userId);
  }

  const entries = [...userIds]
    .map((userId) => {
      const stored = getStoredUser(data, guildId, userId);
      return {
        ...stored,
        voiceSeconds: stored.voiceSeconds + getLiveVoiceSeconds(guildId, userId, now)
      };
    })
    .filter((entry) => entry.chatCharacters > 0 || entry.voiceSeconds > 0);

  return entries.reduce(
    (summary, entry) => ({
      totalUsers: summary.totalUsers + 1,
      totalChatCharacters: summary.totalChatCharacters + entry.chatCharacters,
      totalChatMessages: summary.totalChatMessages + entry.chatMessages,
      totalVoiceSeconds: summary.totalVoiceSeconds + entry.voiceSeconds
    }),
    { totalUsers: 0, totalChatCharacters: 0, totalChatMessages: 0, totalVoiceSeconds: 0 }
  );
}
