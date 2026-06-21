import { readFile } from 'node:fs/promises';
import { PermissionsBitField } from 'discord.js';
import { config } from './config.js';

export const mbtiAxes = [
  ['I', 'E'],
  ['N', 'S'],
  ['T', 'F'],
  ['J', 'P']
];

export const voiceActiveRoleName = '음성채팅 중';
const legacyVoiceActiveRoleName = '🔊 음성채팅 중';
const voiceActiveRoleIconUrl = new URL('./assets/voice-active-role-icon.png', import.meta.url);
const voiceActiveRoleCreation = new Map();
const voiceActiveRoleIconConfigured = new Set();
const preferenceRoleCreation = new Map();
let voiceActiveRoleIconDataPromise = null;

export const preferenceRoleChoices = Object.freeze({
  nsfw: Object.freeze({ name: 'NSFW', color: 0xed4245 }),
  menhera: Object.freeze({ name: '멘헤라', color: 0x9b59b6 })
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function assertCanManageRoles(guild) {
  const me = guild.members.me;

  if (!me?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    throw new Error('봇에 Manage Roles 권한이 없습니다.');
  }
}

export function assertRoleAssignable(guild, role) {
  const me = guild.members.me;

  if (!me) {
    throw new Error('봇 멤버 정보를 확인할 수 없습니다.');
  }

  if (role.managed) {
    throw new Error(`"${role.name}" 역할은 외부 연동 역할이라 지급할 수 없습니다.`);
  }

  if (role.position >= me.roles.highest.position) {
    throw new Error(`"${role.name}" 역할이 봇의 최고 역할보다 높거나 같아서 지급할 수 없습니다.`);
  }
}

function findRoleByName(guild, name) {
  const normalized = name.toLocaleLowerCase('ko-KR');
  return guild.roles.cache.find((role) => role.name.toLocaleLowerCase('ko-KR') === normalized) || null;
}

function getVoiceActiveRoleIconData() {
  if (!voiceActiveRoleIconDataPromise) {
    voiceActiveRoleIconDataPromise = readFile(voiceActiveRoleIconUrl)
      .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
      .catch((error) => {
        voiceActiveRoleIconDataPromise = null;
        throw error;
      });
  }

  return voiceActiveRoleIconDataPromise;
}

export async function getVoiceActiveRole(guild) {
  await guild.roles.fetch();

  const role = findRoleByName(guild, voiceActiveRoleName)
    || findRoleByName(guild, legacyVoiceActiveRoleName);
  if (role) assertRoleAssignable(guild, role);
  return role;
}

async function ensureVoiceActiveRoleDisplay(guild, role) {
  let updatedRole = role;
  const supportsRoleIcons = guild.features.includes('ROLE_ICONS');
  const needsNameMigration = updatedRole.name !== voiceActiveRoleName;
  const needsImageIcon = supportsRoleIcons && !voiceActiveRoleIconConfigured.has(guild.id);
  const needsUnicodeEmojiRemoval = Boolean(updatedRole.unicodeEmoji);

  if (needsNameMigration || needsImageIcon || needsUnicodeEmojiRemoval) {
    assertCanManageRoles(guild);
    updatedRole = await updatedRole.edit({
      ...(needsNameMigration ? { name: voiceActiveRoleName } : {}),
      ...(needsImageIcon ? { icon: await getVoiceActiveRoleIconData() } : {}),
      ...(needsUnicodeEmojiRemoval ? { unicodeEmoji: null } : {}),
      reason: '음성방 표시 역할 이름·아이콘 설정'
    });
  }

  if (supportsRoleIcons && updatedRole.icon) {
    voiceActiveRoleIconConfigured.add(guild.id);
  }

  const highestManageablePosition = guild.members.me.roles.highest.position - 1;
  if (highestManageablePosition > updatedRole.position) {
    assertCanManageRoles(guild);
    updatedRole = await updatedRole.setPosition(highestManageablePosition, {
      reason: '음성방 표시 역할 아이콘 우선순위 설정'
    });
  }

  return updatedRole;
}

export async function getOrCreateVoiceActiveRole(guild) {
  const existing = await getVoiceActiveRole(guild);
  if (existing) {
    return ensureVoiceActiveRoleDisplay(guild, existing);
  }

  const pending = voiceActiveRoleCreation.get(guild.id);
  if (pending) return pending;

  const creation = (async () => {
    assertCanManageRoles(guild);
    const supportsRoleIcons = guild.features.includes('ROLE_ICONS');
    const icon = supportsRoleIcons ? await getVoiceActiveRoleIconData() : null;
    const created = await guild.roles.create({
      name: voiceActiveRoleName,
      colors: { primaryColor: 0 },
      mentionable: false,
      permissions: [],
      ...(icon ? { icon } : {}),
      reason: '음성방 접속 표시 역할 자동 생성'
    });

    assertRoleAssignable(guild, created);
    if (icon) voiceActiveRoleIconConfigured.add(guild.id);
    return ensureVoiceActiveRoleDisplay(guild, created);
  })().finally(() => {
    voiceActiveRoleCreation.delete(guild.id);
  });

  voiceActiveRoleCreation.set(guild.id, creation);
  return creation;
}

export async function getOrCreatePreferenceRole(guild, roleKey) {
  const definition = preferenceRoleChoices[roleKey];
  if (!definition) throw new Error('지원하지 않는 취향 역할입니다.');

  await guild.roles.fetch();

  const existing = findRoleByName(guild, definition.name);
  if (existing) {
    assertRoleAssignable(guild, existing);
    return existing;
  }

  const creationKey = `${guild.id}:${roleKey}`;
  const pending = preferenceRoleCreation.get(creationKey);
  if (pending) return pending;

  const creation = (async () => {
    assertCanManageRoles(guild);
    const created = await guild.roles.create({
      name: definition.name,
      colors: { primaryColor: definition.color },
      mentionable: false,
      permissions: [],
      reason: `취향 선택 역할 자동 생성: ${definition.name}`
    });

    assertRoleAssignable(guild, created);
    return created;
  })().finally(() => {
    preferenceRoleCreation.delete(creationKey);
  });

  preferenceRoleCreation.set(creationKey, creation);
  return creation;
}

export async function getOrCreateVerifiedRole(guild, guildSettings = {}) {
  await guild.roles.fetch();

  const verifiedRoleId = guildSettings.verifiedRoleId || config.verifiedRoleId;

  if (verifiedRoleId) {
    const role = await guild.roles.fetch(verifiedRoleId);
    if (!role) throw new Error(`인증 역할을 찾을 수 없습니다: ${verifiedRoleId}`);
    assertRoleAssignable(guild, role);
    return role;
  }

  const existing = findRoleByName(guild, config.verifiedRoleName);
  if (existing) {
    assertRoleAssignable(guild, existing);
    return existing;
  }

  assertCanManageRoles(guild);
  const created = await guild.roles.create({
    name: config.verifiedRoleName,
    color: 0x57f287,
    mentionable: false,
    permissions: [],
    reason: '인증 통과 역할 자동 생성'
  });

  assertRoleAssignable(guild, created);
  return created;
}

export async function getConfiguredReligionVerifiedRole(guild, guildSettings = {}) {
  const roleId = guildSettings.religionVerifiedRoleId || config.religionVerifiedRoleId;
  if (!roleId) {
    throw new Error('먼저 `/설정 종교인증역할:<역할>`로 종교 패널용 인증 역할을 설정해 주세요.');
  }

  const role = await guild.roles.fetch(roleId);
  if (!role) {
    throw new Error(`종교 인증 역할을 찾을 수 없습니다: ${roleId}`);
  }

  assertRoleAssignable(guild, role);
  return role;
}

export function sanitizeReligionName(rawName) {
  const normalized = rawName
    .normalize('NFKC')
    .replace(/@everyone|@here/gi, '')
    .replace(/[<@#&!:>`*_~|\\]/g, '')
    .replace(/[^\p{L}\p{N}\s.'’+\-_/()]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length < 1) {
    throw new Error('종교 이름을 입력해 주세요.');
  }

  if (normalized.length > 30) {
    throw new Error('종교 이름은 30자 이하로 입력해 주세요.');
  }

  return normalized;
}

export function getReligionRoleName(religionName) {
  return `${config.religionRolePrefix}${religionName}`;
}

export function getMbtiRoleName(letter) {
  return `${config.mbtiRolePrefix}${letter}`;
}

export async function getOrCreateReligionRole(guild, religionName) {
  await guild.roles.fetch();

  const roleName = getReligionRoleName(religionName);
  const existing = findRoleByName(guild, roleName);

  if (existing) {
    assertRoleAssignable(guild, existing);
    return existing;
  }

  assertCanManageRoles(guild);
  const created = await guild.roles.create({
    name: roleName,
    color: 0x5865f2,
    mentionable: false,
    permissions: [],
    reason: `종교 역할 자동 생성: ${religionName}`
  });

  assertRoleAssignable(guild, created);
  return created;
}

export async function replaceReligionRole(member, newRole) {
  const prefixPattern = new RegExp(`^${escapeRegExp(config.religionRolePrefix)}`, 'i');
  const removableRoles = member.roles.cache.filter(
    (role) => role.id !== newRole.id && prefixPattern.test(role.name) && !role.managed
  );

  const manageableRoles = removableRoles.filter((role) => role.position < member.guild.members.me.roles.highest.position);

  if (manageableRoles.size > 0) {
    await member.roles.remove(
      [...manageableRoles.values()],
      `종교 역할 변경: ${member.user.tag}`
    );
  }

  if (!member.roles.cache.has(newRole.id)) {
    await member.roles.add(newRole, `종교 역할 선택: ${member.user.tag}`);
  }
}

export function getMbtiAxis(letter) {
  const normalized = letter.toUpperCase();
  return mbtiAxes.find((axis) => axis.includes(normalized)) || null;
}

export async function getOrCreateMbtiRole(guild, letter) {
  const normalized = letter.toUpperCase();
  const axis = getMbtiAxis(normalized);

  if (!axis) {
    throw new Error('올바른 MBTI 문자가 아닙니다.');
  }

  await guild.roles.fetch();

  const roleName = getMbtiRoleName(normalized);
  const existing = findRoleByName(guild, roleName);

  if (existing) {
    assertRoleAssignable(guild, existing);
    return existing;
  }

  assertCanManageRoles(guild);
  const created = await guild.roles.create({
    name: roleName,
    color: 0xfee75c,
    mentionable: false,
    permissions: [],
    reason: `MBTI 역할 자동 생성: ${normalized}`
  });

  assertRoleAssignable(guild, created);
  return created;
}

export async function replaceMbtiAxisRole(member, selectedRole, selectedLetter) {
  const axis = getMbtiAxis(selectedLetter);
  const axisRoleNames = axis.map(getMbtiRoleName);
  const removableRoles = member.roles.cache.filter(
    (role) => role.id !== selectedRole.id && axisRoleNames.includes(role.name) && !role.managed
  );
  const manageableRoles = removableRoles.filter((role) => role.position < member.guild.members.me.roles.highest.position);

  if (manageableRoles.size > 0) {
    await member.roles.remove([...manageableRoles.values()], `MBTI 역할 변경: ${member.user.tag}`);
  }

  if (!member.roles.cache.has(selectedRole.id)) {
    await member.roles.add(selectedRole, `MBTI 역할 선택: ${member.user.tag}`);
  }
}
