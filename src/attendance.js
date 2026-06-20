import path from 'node:path';
import { createJsonDataStore } from './data-store.js';

const explicitAttendancePath = process.env.ATTENDANCE_DATA_PATH;
const attendancePath = explicitAttendancePath || path.join(process.cwd(), 'data', 'attendance.json');
const attendanceStore = createJsonDataStore({
  name: 'attendance',
  localPath: attendancePath
});
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const oneDayMs = 24 * 60 * 60 * 1000;

let attendanceCache = null;
let mutationQueue = Promise.resolve();

async function readAllAttendance() {
  if (attendanceCache) return attendanceCache;

  attendanceCache = await attendanceStore.read();

  return attendanceCache;
}

async function writeAllAttendance(attendance) {
  await attendanceStore.write(attendance);
  attendanceCache = attendance;
}

function enqueueAttendanceMutation(mutator) {
  const task = mutationQueue.then(async () => mutator(await readAllAttendance()));
  mutationQueue = task.catch(() => null);
  return task;
}

function getKstDateKey(date = new Date()) {
  const parts = Object.fromEntries(
    dateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeStats(stats = {}) {
  return {
    total: Number.isFinite(stats.total) ? stats.total : 0,
    streak: Number.isFinite(stats.streak) ? stats.streak : 0,
    bestStreak: Number.isFinite(stats.bestStreak) ? stats.bestStreak : 0,
    lastDate: typeof stats.lastDate === 'string' ? stats.lastDate : null
  };
}

export async function registerAttendance(guildId, userId, now = new Date()) {
  return enqueueAttendanceMutation(async (attendance) => {
    const guildAttendance = attendance[guildId] || { users: {} };
    const users = guildAttendance.users || {};
    const currentStats = normalizeStats(users[userId]);
    const today = getKstDateKey(now);

    if (currentStats.lastDate === today) {
      return {
        ...currentStats,
        date: today,
        alreadyChecked: true
      };
    }

    const yesterday = getKstDateKey(new Date(now.getTime() - oneDayMs));
    const streak = currentStats.lastDate === yesterday ? currentStats.streak + 1 : 1;
    const total = currentStats.total + 1;
    const bestStreak = Math.max(currentStats.bestStreak, streak);
    const nextStats = {
      total,
      streak,
      bestStreak,
      lastDate: today,
      updatedAt: now.toISOString()
    };

    attendance[guildId] = {
      ...guildAttendance,
      users: {
        ...users,
        [userId]: nextStats
      },
      updatedAt: now.toISOString()
    };

    await writeAllAttendance(attendance);

    return {
      ...nextStats,
      date: today,
      alreadyChecked: false
    };
  });
}

export async function getAttendanceRanking(guildId, limit = 10) {
  await mutationQueue;
  const attendance = await readAllAttendance();
  const users = attendance[guildId]?.users || {};

  return Object.entries(users)
    .map(([userId, stats]) => ({
      userId,
      ...normalizeStats(stats)
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) =>
      b.total - a.total ||
      b.streak - a.streak ||
      b.bestStreak - a.bestStreak ||
      String(b.lastDate || '').localeCompare(String(a.lastDate || ''))
    )
    .slice(0, limit);
}

export async function resetGuildAttendance(guildId) {
  return enqueueAttendanceMutation(async (attendance) => {
    attendance[guildId] = {
      users: {},
      updatedAt: new Date().toISOString()
    };

    await writeAllAttendance(attendance);
  });
}
