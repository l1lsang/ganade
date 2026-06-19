import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const attendancePath = path.join(process.cwd(), 'data', 'attendance.json');
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const oneDayMs = 24 * 60 * 60 * 1000;

let attendanceCache = null;

async function readAllAttendance() {
  if (attendanceCache) return attendanceCache;

  try {
    const raw = await readFile(attendancePath, 'utf8');
    attendanceCache = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    attendanceCache = {};
  }

  return attendanceCache;
}

async function writeAllAttendance(attendance) {
  await mkdir(path.dirname(attendancePath), { recursive: true });
  await writeFile(attendancePath, `${JSON.stringify(attendance, null, 2)}\n`, 'utf8');
  attendanceCache = attendance;
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
  const attendance = await readAllAttendance();
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
}

export async function getAttendanceRanking(guildId, limit = 10) {
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
  const attendance = await readAllAttendance();

  attendance[guildId] = {
    users: {},
    updatedAt: new Date().toISOString()
  };

  await writeAllAttendance(attendance);
}
