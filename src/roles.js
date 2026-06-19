import { PermissionsBitField } from 'discord.js';
import { config } from './config.js';

export const mbtiAxes = [
  ['I', 'E'],
  ['N', 'S'],
  ['T', 'F'],
  ['J', 'P']
];

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
