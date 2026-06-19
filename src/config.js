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
  discordToken: process.env.DISCORD_TOKEN,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordGuildId: process.env.DISCORD_GUILD_ID || null,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiVisionModel: process.env.OPENAI_VISION_MODEL || 'gpt-5.5',
  verifiedRoleId: process.env.VERIFIED_ROLE_ID || null,
  verifiedRoleName: process.env.VERIFIED_ROLE_NAME || '인증됨',
  adminRoleId: process.env.ADMIN_ROLE_ID || null,
  requiredPhrase: process.env.REQUIRED_PHRASE || '돌아갈래',
  verificationMinConfidence: readNumber(process.env.VERIFICATION_MIN_CONFIDENCE, 0.72),
  religionRolePrefix: process.env.RELIGION_ROLE_PREFIX || '종교 | ',
  religionChoices: readList(process.env.RELIGION_CHOICES, defaultReligions).slice(0, 25),
  religionExtraRoleId: process.env.RELIGION_EXTRA_ROLE_ID || '1517171553102467153',
  mbtiRolePrefix: process.env.MBTI_ROLE_PREFIX || 'MBTI | ',
  maxImageBytes: Math.round(readNumber(process.env.MAX_IMAGE_MB, 8) * 1024 * 1024),
  autoRegisterUpdateCommand: readBoolean(process.env.AUTO_REGISTER_UPDATE_COMMAND, true),
  logChannelId: process.env.LOG_CHANNEL_ID || null,
  webAdminToken: process.env.WEB_ADMIN_TOKEN || null
};

export function assertRequiredConfig({ forSyncOnly = false } = {}) {
  const missing = [];

  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.discordClientId) missing.push('DISCORD_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
