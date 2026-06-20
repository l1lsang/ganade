import crypto from 'node:crypto';
import path from 'node:path';
import { createJsonDataStore } from './data-store.js';

const explicitAnonymousPath = process.env.ANONYMOUS_DATA_PATH;
const anonymousPath = explicitAnonymousPath || path.join(process.cwd(), 'data', 'anonymous-chat.json');
const anonymousStore = createJsonDataStore({
  name: 'anonymous-chat',
  localPath: anonymousPath
});
const maxStoredMessages = 1000;

let anonymousCache = null;
let mutationQueue = Promise.resolve();

async function readAllAnonymousData() {
  if (anonymousCache) return anonymousCache;

  anonymousCache = await anonymousStore.read();

  return anonymousCache;
}

async function writeAllAnonymousData(data) {
  await anonymousStore.write(data);
  anonymousCache = data;
}

function enqueueAnonymousMutation(mutator) {
  const task = mutationQueue.then(async () => mutator(await readAllAnonymousData()));
  mutationQueue = task.catch(() => null);
  return task;
}

function normalizeGuildAnonymousData(guildData = {}) {
  return {
    users: guildData.users || {},
    messages: Array.isArray(guildData.messages) ? guildData.messages : []
  };
}

function buildPseudoIp(guildId, userId, salt = 0) {
  const hash = crypto
    .createHash('sha256')
    .update(`${guildId}:${userId}:${salt}`)
    .digest();

  return `10.${(hash[0] % 254) + 1}.${(hash[1] % 254) + 1}.${(hash[2] % 254) + 1}`;
}

function getUsedCodes(guildData, exceptUserId = null) {
  return new Set(
    Object.values(guildData.users)
      .filter((identity) => identity.userId !== exceptUserId)
      .map((identity) => identity.code)
  );
}

function createUniquePseudoIp(guildId, userId, guildData) {
  const usedCodes = getUsedCodes(guildData, userId);

  for (let salt = 0; salt < 100; salt += 1) {
    const code = buildPseudoIp(guildId, userId, salt);
    if (!usedCodes.has(code)) return code;
  }

  return buildPseudoIp(guildId, `${userId}:${Date.now()}`, 0);
}

export function normalizeAnonymousCode(rawCode) {
  const value = String(rawCode || '')
    .trim()
    .replace(/^ㅇㅇ\s*\(/, '')
    .replace(/[()]/g, '')
    .trim();
  const match = value.match(/\d{1,3}(?:\.\d{1,3}){1,3}/);

  return match?.[0] || value;
}

export async function getOrCreateAnonymousIdentity(guildId, user) {
  return enqueueAnonymousMutation(async (data) => {
    const guildData = normalizeGuildAnonymousData(data[guildId]);
    const existing = guildData.users[user.id];
    const now = new Date().toISOString();
    const identity = {
      userId: user.id,
      code: existing?.code || createUniquePseudoIp(guildId, user.id, guildData),
      username: user.username,
      tag: user.tag,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    data[guildId] = {
      ...guildData,
      users: {
        ...guildData.users,
        [user.id]: identity
      },
      updatedAt: now
    };

    await writeAllAnonymousData(data);
    return identity;
  });
}

export async function recordAnonymousMessage(guildId, values) {
  return enqueueAnonymousMutation(async (data) => {
    const guildData = normalizeGuildAnonymousData(data[guildId]);
    const now = new Date().toISOString();
    const messageRecord = {
      createdAt: now,
      ...values
    };

    data[guildId] = {
      ...guildData,
      messages: [...guildData.messages, messageRecord].slice(-maxStoredMessages),
      updatedAt: now
    };

    await writeAllAnonymousData(data);
    return messageRecord;
  });
}

export async function traceAnonymousCode(guildId, rawCode) {
  await mutationQueue;
  const code = normalizeAnonymousCode(rawCode);
  const data = await readAllAnonymousData();
  const guildData = normalizeGuildAnonymousData(data[guildId]);
  const identity = Object.values(guildData.users).find((entry) => entry.code === code) || null;
  const messages = guildData.messages.filter((message) => message.code === code);

  return {
    code,
    identity,
    messages
  };
}
