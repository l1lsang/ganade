import 'dotenv/config';

function readBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function readNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const defaultReligions = [
  '무교',
  '기독교',
  '천주교',
  '불교',
  '이슬람교',
  '힌두교',
  '원불교',
  '유교',
  '도교',
  '유대교',
  '기타'
];

export const config = {
  dataStorageDriver: (process.env.DATA_STORAGE_DRIVER || 'firebase').trim().toLowerCase(),
  firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || null,
  firebaseDatabaseRoot: process.env.FIREBASE_DATABASE_ROOT || 'ganadi-bot',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || null,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || null,
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || null,
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY || null,
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID || null,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiVisionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
  ganadiChatEnabled: readBoolean(process.env.GANADI_CHAT_ENABLED, true),
  ganadiChatCooldownMs: Math.max(0, readNumber(process.env.GANADI_CHAT_COOLDOWN_SECONDS, 5) * 1000),
  ganadiChatMaxInputCharacters: Math.max(
    100,
    Math.min(4000, Math.floor(readNumber(process.env.GANADI_CHAT_MAX_INPUT_CHARS, 1200)))
  ),
  bibleSchedule: {
    morning: process.env.BIBLE_MORNING_TIME || '08:00',
    lunch: process.env.BIBLE_LUNCH_TIME || '12:00',
    evening: process.env.BIBLE_EVENING_TIME || '19:00'
  },
  bibleSchedulerGraceMinutes: Math.max(
    0,
    Math.min(60, Math.floor(readNumber(process.env.BIBLE_SCHEDULER_GRACE_MINUTES, 20)))
  ),
  bibleSchedulerIntervalMs: Math.max(
    10,
    Math.min(300, readNumber(process.env.BIBLE_SCHEDULER_INTERVAL_SECONDS, 30))
  ) * 1000,
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || null,
  verifiedRoleName: process.env.VERIFIED_ROLE_NAME || '인증됨',
  adminRoleId: process.env.ADMIN_ROLE_ID || null,
  requiredPhrase: process.env.REQUIRED_PHRASE || '돌아갈래',
  verificationMinConfidence: readNumber(process.env.VERIFICATION_MIN_CONFIDENCE, 0.72),
  religionRolePrefix: process.env.RELIGION_ROLE_PREFIX || '종교 | ',
  religionChoices: readList(process.env.RELIGION_CHOICES, defaultReligions).slice(0, 25),
  mbtiRolePrefix: process.env.MBTI_ROLE_PREFIX || 'MBTI | ',
  maxImageBytes: Math.round(readNumber(process.env.MAX_IMAGE_MB, 8) * 1024 * 1024),
  autoRegisterUpdateCommand: readBoolean(process.env.AUTO_REGISTER_UPDATE_COMMAND, true),
  logChannelId: process.env.LOG_CHANNEL_ID || null,
  webAdminToken: process.env.WEB_ADMIN_TOKEN || null,
  levelChatXpPerCharacter: Math.max(1, Math.floor(readNumber(process.env.LEVEL_CHAT_XP_PER_CHARACTER, 1))),
  levelVoiceXpPerMinute: Math.max(1, Math.floor(readNumber(process.env.LEVEL_VOICE_XP_PER_MINUTE, 10))),
  levelXpStep: Math.max(1, Math.floor(readNumber(process.env.LEVEL_XP_STEP, 250)))
};

export function assertRequiredConfig({ forSyncOnly = false } = {}) {
  const missing = [];

  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.discordClientId) missing.push('DISCORD_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
