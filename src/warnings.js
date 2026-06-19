import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const warningsPath = path.join(process.cwd(), 'data', 'warnings.json');
const defaultBanThreshold = 3;

let warningsCache = null;

async function readAllWarnings() {
  if (warningsCache) return warningsCache;

  try {
    const raw = await readFile(warningsPath, 'utf8');
    warningsCache = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    warningsCache = {};
  }

  return warningsCache;
}

async function writeAllWarnings(warnings) {
  await mkdir(path.dirname(warningsPath), { recursive: true });
  await writeFile(warningsPath, `${JSON.stringify(warnings, null, 2)}\n`, 'utf8');
  warningsCache = warnings;
}

function createRecordId(now = new Date()) {
  return `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultGuildWarnings() {
  return {
    config: {
      banThreshold: defaultBanThreshold
    },
    users: {},
    events: []
  };
}

function normalizeGuildWarnings(guildWarnings = {}) {
  return {
    ...getDefaultGuildWarnings(),
    ...guildWarnings,
    config: {
      ...getDefaultGuildWarnings().config,
      ...(guildWarnings.config || {})
    },
    users: guildWarnings.users || {},
    events: guildWarnings.events || []
  };
}

function normalizeUserWarnings(userWarnings = {}) {
  return {
    activeCount: Number.isFinite(userWarnings.activeCount) ? userWarnings.activeCount : 0,
    totalIssued: Number.isFinite(userWarnings.totalIssued) ? userWarnings.totalIssued : 0,
    updatedAt: userWarnings.updatedAt || null
  };
}

function clampReason(reason) {
  return String(reason || '사유 없음').trim().slice(0, 300) || '사유 없음';
}

function createWarningEvent(type, values, now = new Date()) {
  return {
    id: createRecordId(now),
    type,
    createdAt: now.toISOString(),
    ...values
  };
}

async function updateGuildWarnings(guildId, updater) {
  const warnings = await readAllWarnings();
  const guildWarnings = normalizeGuildWarnings(warnings[guildId]);
  const nextGuildWarnings = updater(guildWarnings);

  warnings[guildId] = {
    ...nextGuildWarnings,
    updatedAt: new Date().toISOString()
  };

  await writeAllWarnings(warnings);
  return warnings[guildId];
}

export async function getWarningConfig(guildId) {
  const warnings = await readAllWarnings();
  return normalizeGuildWarnings(warnings[guildId]).config;
}

export async function getWarningSummary(guildId, userId) {
  const warnings = await readAllWarnings();
  const guildWarnings = normalizeGuildWarnings(warnings[guildId]);
  const userWarnings = normalizeUserWarnings(guildWarnings.users[userId]);

  return {
    ...userWarnings,
    threshold: guildWarnings.config.banThreshold
  };
}

export async function addWarning(guildId, userId, moderatorId, reason) {
  let result = null;

  await updateGuildWarnings(guildId, (guildWarnings) => {
    const current = normalizeUserWarnings(guildWarnings.users[userId]);
    const next = {
      activeCount: current.activeCount + 1,
      totalIssued: current.totalIssued + 1,
      updatedAt: new Date().toISOString()
    };
    const threshold = guildWarnings.config.banThreshold;
    const event = createWarningEvent('warn', {
      userId,
      moderatorId,
      reason: clampReason(reason),
      amount: 1,
      countAfter: next.activeCount,
      threshold
    });

    result = {
      event,
      activeCount: next.activeCount,
      totalIssued: next.totalIssued,
      threshold,
      shouldBan: threshold > 0 && next.activeCount >= threshold
    };

    return {
      ...guildWarnings,
      users: {
        ...guildWarnings.users,
        [userId]: next
      },
      events: [...guildWarnings.events, event]
    };
  });

  return result;
}

export async function removeWarnings(guildId, userId, moderatorId, amount, reason) {
  const requestedAmount = Math.max(1, Number(amount) || 1);
  let result = null;

  await updateGuildWarnings(guildId, (guildWarnings) => {
    const current = normalizeUserWarnings(guildWarnings.users[userId]);
    const removedAmount = Math.min(requestedAmount, current.activeCount);
    const next = {
      ...current,
      activeCount: current.activeCount - removedAmount,
      updatedAt: new Date().toISOString()
    };
    const event = createWarningEvent('remove', {
      userId,
      moderatorId,
      reason: clampReason(reason),
      amount: removedAmount,
      requestedAmount,
      countAfter: next.activeCount
    });

    result = {
      event,
      removedAmount,
      activeCount: next.activeCount,
      totalIssued: next.totalIssued,
      threshold: guildWarnings.config.banThreshold
    };

    return {
      ...guildWarnings,
      users: {
        ...guildWarnings.users,
        [userId]: next
      },
      events: [...guildWarnings.events, event]
    };
  });

  return result;
}

export async function setWarningBanThreshold(guildId, moderatorId, threshold) {
  const nextThreshold = Math.max(1, Number(threshold) || defaultBanThreshold);
  let result = null;

  await updateGuildWarnings(guildId, (guildWarnings) => {
    const event = createWarningEvent('config', {
      moderatorId,
      reason: `자동 밴 기준 ${nextThreshold}회로 설정`,
      threshold: nextThreshold
    });

    result = {
      event,
      threshold: nextThreshold
    };

    return {
      ...guildWarnings,
      config: {
        ...guildWarnings.config,
        banThreshold: nextThreshold
      },
      events: [...guildWarnings.events, event]
    };
  });

  return result;
}

export async function addWarningBanRecord(guildId, userId, moderatorId, reason, threshold) {
  await updateGuildWarnings(guildId, (guildWarnings) => {
    const event = createWarningEvent('ban', {
      userId,
      moderatorId,
      reason: clampReason(reason),
      threshold,
      countAfter: normalizeUserWarnings(guildWarnings.users[userId]).activeCount
    });

    return {
      ...guildWarnings,
      events: [...guildWarnings.events, event]
    };
  });
}

export async function getWarningHistory(guildId, userId = null) {
  const warnings = await readAllWarnings();
  const guildWarnings = normalizeGuildWarnings(warnings[guildId]);
  const events = userId
    ? guildWarnings.events.filter((event) => event.userId === userId)
    : guildWarnings.events;

  return {
    config: guildWarnings.config,
    users: guildWarnings.users,
    events
  };
}

function formatEventType(type) {
  const labels = {
    warn: '경고 지급',
    remove: '경고 회수',
    ban: '자동 밴',
    config: '설정 변경'
  };

  return labels[type] || type;
}

function formatEventLine(event, index) {
  const parts = [
    `${index + 1}. [${event.createdAt}] ${formatEventType(event.type)}`
  ];

  if (event.userId) parts.push(`대상: ${event.userId}`);
  if (event.moderatorId) parts.push(`처리자: ${event.moderatorId}`);
  if (Number.isFinite(event.amount)) parts.push(`수량: ${event.amount}`);
  if (Number.isFinite(event.countAfter)) parts.push(`현재 경고: ${event.countAfter}`);
  if (Number.isFinite(event.threshold)) parts.push(`자동 밴 기준: ${event.threshold}`);
  if (event.reason) parts.push(`사유: ${event.reason}`);

  return parts.join(' | ');
}

export function buildWarningHistoryText(guild, history, user = null) {
  const userRows = Object.entries(history.users)
    .map(([userId, userWarnings]) => ({
      userId,
      ...normalizeUserWarnings(userWarnings)
    }))
    .filter((entry) => (user ? entry.userId === user.id : entry.activeCount > 0 || entry.totalIssued > 0))
    .sort((a, b) => b.activeCount - a.activeCount || b.totalIssued - a.totalIssued);
  const lines = [
    `경고 기록`,
    `서버: ${guild.name} (${guild.id})`,
    `대상: ${user ? `${user.tag || user.username} (${user.id})` : '전체 유저'}`,
    `자동 밴 기준: ${history.config.banThreshold}회`,
    `생성 시각: ${new Date().toISOString()}`,
    '',
    '현재 경고 요약'
  ];

  if (userRows.length === 0) {
    lines.push('- 기록 없음');
  } else {
    for (const row of userRows) {
      lines.push(`- ${row.userId}: 현재 ${row.activeCount}회 / 누적 지급 ${row.totalIssued}회`);
    }
  }

  lines.push('', '전체 이벤트');

  if (history.events.length === 0) {
    lines.push('- 기록 없음');
  } else {
    history.events.forEach((event, index) => {
      lines.push(formatEventLine(event, index));
    });
  }

  return `${lines.join('\n')}\n`;
}
