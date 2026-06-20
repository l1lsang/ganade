import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import OpenAI from 'openai';
import {
  getAttendanceRanking,
  registerAttendance,
  resetGuildAttendance
} from './attendance.js';
import {
  getOrCreateAnonymousIdentity,
  normalizeAnonymousCode,
  recordAnonymousMessage,
  traceAnonymousCode
} from './anonymous.js';
import {
  configureBibleMessage,
  normalizeBibleSchedule,
  startBibleScheduler
} from './bible-scheduler.js';
import {
  birthdayCustomIds,
  handleBirthdayCommand,
  handleBirthdayModal,
  handleBirthdayRegisterButton,
  handleBirthdayRemoveButton,
  startBirthdayScheduler
} from './birthday.js';
import { commandNames } from './commands.js';
import { assertRequiredConfig, config } from './config.js';
import {
  buildEconomyRankingReply,
  handleEconomyCommand,
  isEconomyCommand
} from './economy-commands.js';
import { awardAttendanceEconomy } from './economy.js';
import { formatDuc } from './economy-catalog.js';
import {
  addGanadiAffection,
  buildGanadiAffectionBar,
  getGanadiAffection,
  getGanadiAffectionTier,
  getNextGanadiAffectionGoal
} from './ganadi-affection.js';
import { generateGanadiReply, shouldRespondToGanadi } from './ganadi-chat.js';
import { getRandomGanadiPhoto } from './ganadi-photo.js';
import { startHealthServer } from './health-server.js';
import {
  checkpointVoiceSessions,
  endVoiceSession,
  getLevelRanking,
  getUserLevelRank,
  getUserLevelStats,
  recordChatActivity,
  startVoiceSession
} from './level-system.js';
import {
  assertCanManageRoles,
  assertRoleAssignable,
  getMbtiAxis,
  getOrCreateMbtiRole,
  getOrCreateReligionRole,
  getOrCreateVerifiedRole,
  mbtiAxes,
  replaceMbtiAxisRole,
  replaceReligionRole,
  sanitizeReligionName
} from './roles.js';
import { getGuildSettings, updateGuildSettings } from './settings.js';
import {
  configureSelfIntroduction,
  refreshSelfIntroductionAfterMessage
} from './self-introduction.js';
import { ensureUpdateCommand, syncAllCommands } from './sync-commands.js';
import {
  addWarning,
  addWarningBanRecord,
  buildWarningHistoryText,
  getWarningConfig,
  getWarningHistory,
  getWarningSummary,
  removeWarnings,
  setWarningBanThreshold,
  setWarningLogChannel
} from './warnings.js';

assertRequiredConfig();

const openai = config.openaiApiKey
  ? new OpenAI({
      apiKey: config.openaiApiKey,
      timeout: 30_000,
      maxRetries: 2
    })
  : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

startHealthServer(client);

const customIds = {
  verifyGuide: 'verify:start',
  ticketApprove: 'ticket:approve',
  ticketClose: 'ticket:close',
  religionSelect: 'religion:select',
  religionCustomButton: 'religion:custom',
  religionCustomModal: 'religion:custom:modal',
  religionCustomInput: 'religion_name',
  mbtiPrefix: 'mbti:',
  levelRankingPrefix: 'level-ranking:'
};

const inviteCache = new Map();
const ganadiCooldowns = new Map();
const ganadiResponseQueues = new Map();
const customEmojiPattern = /^<(?<animated>a?):(?<name>[A-Za-z0-9_]{2,32}):(?<id>\d{16,22})>$/;
const anonymousWebhookName = '가나디 익명채팅';

async function fetchMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
}

function isGanadiChatTrigger(message) {
  const mentioned = Boolean(client.user?.id && message.mentions.users.has(client.user.id));
  return shouldRespondToGanadi(message.content, mentioned);
}

function startGanadiCooldown(message) {
  if (config.ganadiChatCooldownMs <= 0) return true;

  const cooldownKey = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const cooldownEndsAt = ganadiCooldowns.get(cooldownKey) || 0;

  if (cooldownEndsAt > now) return false;

  const nextCooldownEndsAt = now + config.ganadiChatCooldownMs;
  ganadiCooldowns.set(cooldownKey, nextCooldownEndsAt);

  const timer = setTimeout(() => {
    if (ganadiCooldowns.get(cooldownKey) === nextCooldownEndsAt) {
      ganadiCooldowns.delete(cooldownKey);
    }
  }, config.ganadiChatCooldownMs);
  timer.unref();

  return true;
}

async function replyAsGanadi(message) {
  if (!config.ganadiChatEnabled || !isGanadiChatTrigger(message)) return false;

  if (!openai) {
    console.warn('가나디 채팅이 호출되었지만 OPENAI_API_KEY가 설정되지 않았습니다.');
    return false;
  }

  if (!startGanadiCooldown(message)) return false;

  await message.channel.sendTyping().catch(() => null);
  const currentAffection = await getGanadiAffection(message.guildId, message.author.id);
  const result = await generateGanadiReply(openai, {
    content: message.content,
    model: config.openaiChatModel,
    affection: currentAffection.score,
    maxInputCharacters: config.ganadiChatMaxInputCharacters
  });

  await message.reply({
    content: result.reply,
    allowedMentions: {
      parse: [],
      repliedUser: false
    }
  });

  await addGanadiAffection(
    message.guildId,
    message.author.id,
    result.affectionDelta,
    buildLevelProfile(message.author, message.member)
  ).catch((error) => {
    console.error(`가나디 호감도 저장 실패 (${message.guildId}/${message.author.id}): ${error.message}`);
  });

  return true;
}

function enqueueGanadiReply(message) {
  if (!config.ganadiChatEnabled || !isGanadiChatTrigger(message)) {
    return Promise.resolve(false);
  }

  const queueKey = `${message.guildId}:${message.channelId}`;
  const previousQueue = ganadiResponseQueues.get(queueKey) || Promise.resolve();
  const nextQueue = previousQueue
    .catch(() => null)
    .then(() => replyAsGanadi(message));

  ganadiResponseQueues.set(queueKey, nextQueue);
  const cleanQueue = () => {
    if (ganadiResponseQueues.get(queueKey) === nextQueue) {
      ganadiResponseQueues.delete(queueKey);
    }
  };
  nextQueue.then(cleanQueue, cleanQueue);

  return nextQueue;
}

function isAllowedEmojiAttachment(attachment) {
  const contentType = attachment.contentType?.toLowerCase() || '';
  const filename = attachment.name?.toLowerCase() || '';

  return (
    contentType.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/.test(filename)
  );
}

function normalizeEmojiName(rawName) {
  const normalized = String(rawName || '')
    .normalize('NFKC')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  if (normalized.length < 2) {
    throw new Error('이모지 이름은 영문/숫자/밑줄만 사용해서 2~32자로 입력해 주세요.');
  }

  return normalized;
}

function parseEmojiSource(emojiInput, attachment) {
  if (attachment) {
    if (!isAllowedEmojiAttachment(attachment)) {
      throw new Error('이미지 첨부파일만 이모지로 추가할 수 있습니다.');
    }

    return {
      attachment: attachment.url,
      inferredName: attachment.name || 'emoji'
    };
  }

  const input = String(emojiInput || '').trim();
  if (!input) {
    throw new Error('외부 이모지 문자열, 이미지 URL, 또는 이미지 첨부파일 중 하나를 넣어 주세요.');
  }

  const emojiMatch = input.match(customEmojiPattern);
  if (emojiMatch?.groups) {
    const extension = emojiMatch.groups.animated ? 'gif' : 'png';

    return {
      attachment: `https://cdn.discordapp.com/emojis/${emojiMatch.groups.id}.${extension}?quality=lossless`,
      inferredName: emojiMatch.groups.name
    };
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('이모지 입력값은 `<:name:id>`, `<a:name:id>`, 또는 이미지 URL이어야 합니다.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('이미지 URL은 https 주소만 사용할 수 있습니다.');
  }

  if (!/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url.href)) {
    throw new Error('이미지 URL은 PNG, JPG, WEBP, GIF 파일 주소여야 합니다.');
  }

  return {
    attachment: url.href,
    inferredName: decodeURIComponent(url.pathname.split('/').pop() || 'emoji')
  };
}

function assertEmojiPermissions(interaction) {
  const userCanManage = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuildExpressions);
  if (!userCanManage) {
    throw new Error('서버 이모지 추가는 이모지/스티커 관리 권한이 필요합니다.');
  }

  const botPermissions = interaction.guild.members.me.permissions;
  const botCanCreate = botPermissions.any(
    PermissionsBitField.Flags.CreateGuildExpressions | PermissionsBitField.Flags.ManageGuildExpressions
  );

  if (!botCanCreate) {
    throw new Error('봇에 Create Expressions 또는 Manage Expressions 권한이 없습니다.');
  }
}

async function handleAddEmoji(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  assertEmojiPermissions(interaction);

  const emojiInput = interaction.options.getString('이모지');
  const attachment = interaction.options.getAttachment('이미지');
  const requestedName = interaction.options.getString('이름');
  const source = parseEmojiSource(emojiInput, attachment);
  const emojiName = normalizeEmojiName(requestedName || source.inferredName);

  const createdEmoji = await interaction.guild.emojis.create({
    attachment: source.attachment,
    name: emojiName,
    reason: `외부 이모지 추가: ${interaction.user.tag}`
  });

  await interaction.editReply(`이모지를 추가했습니다: ${createdEmoji} \`:${createdEmoji.name}:\``);
}

function buildVerifyPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('수동 인증 티켓')
    .setDescription([
      '아래 버튼을 누르면 본인과 관리자 역할만 볼 수 있는 인증 티켓이 생성됩니다.',
      '티켓 안에서 신분증 또는 학생증 사진을 올리면 관리자가 수동으로 확인합니다.'
    ].join('\n'))
    .setColor(0x57f287);

  const verifyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customIds.verifyGuide)
      .setLabel('인증 티켓 생성')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [verifyRow]
  };
}

function buildTicketControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customIds.ticketApprove)
        .setLabel('인증 승인')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customIds.ticketClose)
        .setLabel('티켓 닫기')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function buildReligionPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('종교 역할 선택')
    .setDescription('아래 드롭다운에서 종교를 선택하거나, 목록에 없으면 직접 입력하세요.')
    .setColor(0x5865f2);

  const religionOptions = config.religionChoices.map((name) => ({
    label: name,
    value: name
  }));

  const religionSelectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customIds.religionSelect)
      .setPlaceholder('종교 역할 선택')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(religionOptions)
  );

  const customReligionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customIds.religionCustomButton)
      .setLabel('종교 직접 입력')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [religionSelectRow, customReligionRow]
  };
}

function buildMbtiPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('MBTI 역할 선택')
    .setDescription('각 축에서 하나씩 선택하세요. 버튼을 누르면 반대 역할은 자동으로 제거됩니다.')
    .setColor(0xfee75c);

  const components = mbtiAxes.map((axis) =>
    new ActionRowBuilder().addComponents(
      ...axis.map((letter) =>
        new ButtonBuilder()
          .setCustomId(`${customIds.mbtiPrefix}${letter}`)
          .setLabel(letter)
          .setStyle(ButtonStyle.Secondary)
      )
    )
  );

  return {
    embeds: [embed],
    components
  };
}

function buildCustomReligionModal() {
  const input = new TextInputBuilder()
    .setCustomId(customIds.religionCustomInput)
    .setLabel('종교 이름')
    .setPlaceholder('목록에 없는 종교를 입력하세요')
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(30)
    .setStyle(TextInputStyle.Short);

  return new ModalBuilder()
    .setCustomId(customIds.religionCustomModal)
    .setTitle('종교 직접 입력')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function getConfiguredLogChannelId(guildSettings) {
  return guildSettings.logChannelId || config.logChannelId;
}

function getConfiguredAdminRoleId(guildSettings) {
  return guildSettings.adminRoleId || config.adminRoleId;
}

function formatConfiguredSettings(guildSettings) {
  const verifiedRoleId = guildSettings.verifiedRoleId || config.verifiedRoleId;
  const adminRoleId = getConfiguredAdminRoleId(guildSettings);
  const logChannelId = getConfiguredLogChannelId(guildSettings);

  return [
    `인증 역할: ${verifiedRoleId ? `<@&${verifiedRoleId}>` : `"${config.verifiedRoleName}" 자동 생성/사용`}`,
    `관리자 역할: ${adminRoleId ? `<@&${adminRoleId}>` : '설정 안 됨'}`,
    `로그 채널: ${logChannelId ? `<#${logChannelId}>` : '설정 안 됨'}`,
    `MBTI 채널: ${guildSettings.mbtiChannelId ? `<#${guildSettings.mbtiChannelId}>` : '설정 안 됨'}`,
    `익명채팅 채널: ${guildSettings.anonymousChannelId ? `<#${guildSettings.anonymousChannelId}>` : '설정 안 됨'}`
  ].join('\n');
}

function formatDiscordTimestamp(dateOrTimestamp, style = 'F') {
  const timestamp = dateOrTimestamp ? Math.floor(Number(dateOrTimestamp) / 1000) : Math.floor(Date.now() / 1000);
  return `<t:${timestamp}:${style}>`;
}

function getMemberDisplayName(member) {
  return member.displayName || member.user.globalName || member.user.username;
}

function buildLevelProfile(user, member = null) {
  return {
    username: user.username,
    displayName: member?.displayName || user.globalName || user.username,
    avatarUrl: user.displayAvatarURL({ extension: 'png', size: 128 })
  };
}

function isEligibleVoiceState(voiceState) {
  return Boolean(
    voiceState.channelId &&
    voiceState.channelId !== voiceState.guild.afkChannelId &&
    voiceState.member &&
    !voiceState.member.user.bot
  );
}

function startTrackedVoiceState(voiceState, now = Date.now()) {
  if (!isEligibleVoiceState(voiceState)) return false;
  return startVoiceSession(
    voiceState.guild.id,
    voiceState.id,
    buildLevelProfile(voiceState.member.user, voiceState.member),
    now
  );
}

function getInviterTokens(inviterInfo) {
  if (!inviterInfo) {
    return {
      inviter: '알 수 없음',
      inviterMention: '알 수 없음',
      inviterName: '알 수 없음',
      inviterTag: '알 수 없음'
    };
  }

  return {
    inviter: inviterInfo.mention || inviterInfo.tag || inviterInfo.username || '알 수 없음',
    inviterMention: inviterInfo.mention || '알 수 없음',
    inviterName: inviterInfo.username || inviterInfo.tag || '알 수 없음',
    inviterTag: inviterInfo.tag || inviterInfo.username || '알 수 없음'
  };
}

function buildMemberLogTokens(member, inviterInfo = null) {
  const now = Date.now();
  const joinedTimestamp = member.joinedTimestamp || now;
  const createdTimestamp = member.user.createdTimestamp || now;

  return {
    user: member.user.username,
    displayName: getMemberDisplayName(member),
    tag: member.user.tag,
    mention: `${member}`,
    server: member.guild.name,
    memberCount: String(member.guild.memberCount || ''),
    joinedAt: formatDiscordTimestamp(joinedTimestamp, 'F'),
    joinedRelative: formatDiscordTimestamp(joinedTimestamp, 'R'),
    leftAt: formatDiscordTimestamp(now, 'F'),
    leftRelative: formatDiscordTimestamp(now, 'R'),
    createdAt: formatDiscordTimestamp(createdTimestamp, 'F'),
    createdRelative: formatDiscordTimestamp(createdTimestamp, 'R'),
    ...getInviterTokens(inviterInfo)
  };
}

function replaceMemberLogTokens(value, tokens) {
  return Object.entries(tokens).reduce(
    (result, [token, replacement]) => result.replaceAll(`{${token}}`, replacement),
    value || ''
  );
}

function parseEmbedColor(value) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value || '')) return 0x57f287;
  return Number.parseInt(value.slice(1), 16);
}

function buildMemberLogPayload(member, settings, type, inviterInfo = null) {
  const tokens = buildMemberLogTokens(member, inviterInfo);
  const isWelcome = type === 'welcome';
  const defaultTitle = isWelcome ? '{memberCount}번째 멤버가 입장했어요' : '{user} 님이 서버를 떠났어요';
  const title = replaceMemberLogTokens(settings.embedTitle || defaultTitle, tokens);
  const extraMessage = replaceMemberLogTokens(settings.message || '', tokens);
  const contentParts = [settings.emojiText || ''];

  if (settings.mentionUser) {
    contentParts.push(tokens.mention);
  }

  const content = contentParts.filter(Boolean).join(' ');
  const allowedMentions = settings.mentionUser ? { users: [member.id], roles: [] } : { users: [], roles: [] };

  if (settings.useEmbed === false) {
    const plainLines = [
      title,
      extraMessage,
      `유저: ${tokens.mention} (${tokens.displayName})`,
      isWelcome
        ? `서버에 입장한 시간: ${tokens.joinedAt} (${tokens.joinedRelative})`
        : `서버에서 퇴장한 시간: ${tokens.leftAt} (${tokens.leftRelative})`,
      `계정 생성일: ${tokens.createdAt} (${tokens.createdRelative})`
    ];

    if (isWelcome && settings.showInviter !== false) {
      plainLines.push(`초대자: ${tokens.inviterMention} (${tokens.inviterName})`);
    }

    return {
      content: [content, ...plainLines].filter(Boolean).join('\n'),
      allowedMentions
    };
  }

  const embed = new EmbedBuilder()
    .setTitle(title || (isWelcome ? '입장 로그' : '퇴장 로그'))
    .setColor(parseEmbedColor(settings.embedColor))
    .addFields(
      {
        name: '유저',
        value: `${tokens.mention} (${tokens.displayName})`,
        inline: false
      },
      {
        name: isWelcome ? '서버에 입장한 시간' : '서버에서 퇴장한 시간',
        value: isWelcome
          ? `${tokens.joinedAt} (${tokens.joinedRelative})`
          : `${tokens.leftAt} (${tokens.leftRelative})`,
        inline: false
      },
      {
        name: '계정 생성일',
        value: `${tokens.createdAt} (${tokens.createdRelative})`,
        inline: false
      }
    )
    .setTimestamp();

  if (extraMessage) {
    embed.setDescription(extraMessage);
  }

  if (isWelcome && settings.showInviter !== false) {
    embed.addFields({
      name: '초대자',
      value: `${tokens.inviterMention} (${tokens.inviterName})`,
      inline: false
    });
  }

  if (settings.showProfileImage !== false) {
    embed.setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }));
  }

  const payload = {
    embeds: [embed],
    allowedMentions
  };

  if (content) {
    payload.content = content;
  }

  return payload;
}

async function sendMemberLog(member, settings, type, inviterInfo = null) {
  if (!settings?.enabled || !settings.channelId) return;

  const channel = await member.guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  await channel.send(buildMemberLogPayload(member, settings, type, inviterInfo));
}

async function sendWelcomeMessage(member, inviterInfo = null) {
  const guildSettings = await getGuildSettings(member.guild.id);
  await sendMemberLog(member, guildSettings.welcome, 'welcome', inviterInfo);
}

async function sendLeaveMessage(member) {
  const guildSettings = await getGuildSettings(member.guild.id);
  await sendMemberLog(member, guildSettings.leave, 'leave');
}

function sanitizeTicketChannelName(user) {
  const safeName = user.username
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  return `인증-${safeName || user.id}`;
}

async function findOpenVerificationTicket(guild, userId) {
  await guild.channels.fetch();
  return guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.topic?.includes(`verification-ticket:${userId}:open`)
  ) || null;
}

function parseTicketOwnerId(channel) {
  const match = channel.topic?.match(/verification-ticket:(\d+):open/);
  return match?.[1] || null;
}

async function isVerificationAdmin(interaction, guildSettings) {
  const adminRoleId = getConfiguredAdminRoleId(guildSettings);
  if (!adminRoleId) return false;

  const member = await fetchMember(interaction);
  return member.roles.cache.has(adminRoleId) || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
}

async function createVerificationTicket(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildSettings = await getGuildSettings(interaction.guildId);
  const adminRoleId = getConfiguredAdminRoleId(guildSettings);

  if (!adminRoleId) {
    await interaction.editReply('먼저 `/설정 관리자역할:<역할>`로 인증 티켓을 볼 관리자 역할을 설정해 주세요.');
    return;
  }

  const adminRole = await interaction.guild.roles.fetch(adminRoleId);
  if (!adminRole) {
    await interaction.editReply('설정된 관리자 역할을 찾을 수 없습니다. `/설정 관리자역할:<역할>`로 다시 설정해 주세요.');
    return;
  }

  const existingTicket = await findOpenVerificationTicket(interaction.guild, interaction.user.id);
  if (existingTicket) {
    await interaction.editReply(`이미 열린 인증 티켓이 있습니다: ${existingTicket}`);
    return;
  }

  if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error('봇에 Manage Channels 권한이 없어 인증 티켓을 만들 수 없습니다.');
  }

  const parent = interaction.channel?.parentId || null;
  const channel = await interaction.guild.channels.create({
    name: sanitizeTicketChannelName(interaction.user),
    type: ChannelType.GuildText,
    ...(parent ? { parent } : {}),
    topic: `verification-ticket:${interaction.user.id}:open`,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      },
      {
        id: adminRole.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.ManageMessages
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageMessages
        ]
      }
    ],
    reason: `인증 티켓 생성: ${interaction.user.tag}`
  });

  const embed = new EmbedBuilder()
    .setTitle('인증 티켓')
    .setDescription([
      `${interaction.user} 님, 이 채널에 신분증 또는 학생증 사진을 올려 주세요.`,
      '관리자가 수동으로 확인한 뒤 인증 승인 버튼을 누르면 인증 역할이 지급됩니다.',
      '인증이 끝났거나 취소하려면 티켓 닫기 버튼을 누르세요.'
    ].join('\n'))
    .setColor(0x57f287);

  await channel.send({
    content: `${interaction.user} <@&${adminRole.id}>`,
    embeds: [embed],
    components: buildTicketControls(),
    allowedMentions: { users: [interaction.user.id], roles: [adminRole.id] }
  });

  await interaction.editReply(`인증 티켓을 만들었습니다: ${channel}`);
}

async function handleVerify(interaction) {
  await createVerificationTicket(interaction);
}

async function handleTicketApprove(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const ownerId = parseTicketOwnerId(interaction.channel);
  if (!ownerId) {
    await interaction.editReply('이 채널은 열린 인증 티켓이 아닙니다.');
    return;
  }

  const guildSettings = await getGuildSettings(interaction.guildId);
  if (!(await isVerificationAdmin(interaction, guildSettings))) {
    await interaction.editReply('인증 승인은 설정된 관리자 역할만 사용할 수 있습니다.');
    return;
  }

  const targetMember = await interaction.guild.members.fetch(ownerId);
  const verifiedRole = await getOrCreateVerifiedRole(interaction.guild, guildSettings);

  await targetMember.roles.add(verifiedRole, `수동 인증 승인: ${interaction.user.tag}`);
  await interaction.channel.send(`${targetMember} 님에게 "${verifiedRole.name}" 역할을 지급했습니다.`);
  await interaction.editReply('인증을 승인했습니다.');
}

async function handleTicketClose(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const ownerId = parseTicketOwnerId(interaction.channel);
  if (!ownerId) {
    await interaction.editReply('이 채널은 열린 인증 티켓이 아닙니다.');
    return;
  }

  const guildSettings = await getGuildSettings(interaction.guildId);
  const isAdmin = await isVerificationAdmin(interaction, guildSettings);
  const isOwner = interaction.user.id === ownerId;

  if (!isAdmin && !isOwner) {
    await interaction.editReply('이 티켓은 생성자 또는 관리자만 닫을 수 있습니다.');
    return;
  }

  await interaction.editReply('티켓을 닫습니다. 잠시 후 채널이 삭제됩니다.');
  await interaction.channel.send(`티켓이 ${interaction.user} 님에 의해 종료됩니다.`);

  setTimeout(() => {
    interaction.channel.delete(`인증 티켓 종료: ${interaction.user.tag}`).catch((error) => {
      console.error(`티켓 삭제 실패: ${error.message}`);
    });
  }, 2500);
}

async function handleReligion(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const selected = interaction.options.getString('종교');
  const custom = interaction.options.getString('직접입력');
  const rawName = custom || selected;

  if (!rawName) {
    await interaction.editReply('목록에서 종교를 선택하거나 직접 입력해 주세요.');
    return;
  }

  const result = await applyReligionRole(interaction, rawName);
  await interaction.editReply(formatReligionRoleReply(result));
}

async function applyReligionRole(interaction, rawName) {
  const religionName = sanitizeReligionName(rawName);
  const role = await getOrCreateReligionRole(interaction.guild, religionName);
  const member = await fetchMember(interaction);
  const extraRole = await getReligionExtraRole(interaction.guild);

  await replaceReligionRole(member, role);
  if (extraRole && extraRole.id !== role.id && !member.roles.cache.has(extraRole.id)) {
    await member.roles.add(extraRole, `종교 역할 선택 보조 역할: ${member.user.tag}`);
  }

  return {
    role,
    extraRole
  };
}

async function getReligionExtraRole(guild) {
  if (!config.religionExtraRoleId) return null;

  const role = await guild.roles.fetch(config.religionExtraRoleId);
  if (!role) {
    throw new Error(`종교 보조 역할을 찾을 수 없습니다: ${config.religionExtraRoleId}`);
  }

  assertRoleAssignable(guild, role);
  return role;
}

function formatReligionRoleReply({ role, extraRole }) {
  const roles = [`"${role.name}"`];
  if (extraRole && extraRole.id !== role.id) {
    roles.push(`"${extraRole.name}"`);
  }

  return `${roles.join(', ')} 역할을 지급했습니다.`;
}

async function handleReligionSelect(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await applyReligionRole(interaction, interaction.values[0]);
  await interaction.editReply(formatReligionRoleReply(result));
}

async function handleCustomReligionModal(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const rawName = interaction.fields.getTextInputValue(customIds.religionCustomInput);
  const result = await applyReligionRole(interaction, rawName);
  await interaction.editReply(formatReligionRoleReply(result));
}

function isUnknownInteractionError(error) {
  return error?.code === 10062 || error?.rawError?.code === 10062 || /Unknown interaction/i.test(error?.message || '');
}

async function deferInteractionSafely(interaction) {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferReply({ ephemeral: true });
    return true;
  } catch (error) {
    if (!isUnknownInteractionError(error)) {
      throw error;
    }

    console.warn('상호작용 응답 토큰이 만료되어 Discord 응답 대신 채널 fallback을 사용합니다.');
    return false;
  }
}

async function sendInteractionResult(interaction, content, acknowledged) {
  if (acknowledged || interaction.deferred || interaction.replied) {
    try {
      await interaction.editReply(content);
      return;
    } catch (error) {
      if (!isUnknownInteractionError(error)) {
        throw error;
      }

      console.warn('상호작용 결과 응답 토큰이 만료되어 채널 fallback을 사용합니다.');
    }
  }

  if (interaction.channel?.isTextBased()) {
    await interaction.channel.send({
      content,
      allowedMentions: { users: [], roles: [] }
    }).catch((error) => {
      console.error(`상호작용 fallback 메시지 전송 실패: ${error.message}`);
    });
  }
}

async function handleUpdate(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({ content: '명령어 동기화는 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  const acknowledged = await deferInteractionSafely(interaction);

  const scope = interaction.options.getString('범위') || 'guild';
  const result = await syncAllCommands({
    guildId: interaction.guildId,
    global: scope === 'global'
  });

  const target = result.scope === 'global' ? '전역' : '현재 서버';
  await sendInteractionResult(interaction, `${target} 명령어 ${result.count}개를 동기화했습니다.`, acknowledged);
}

async function getPanelTargetChannel(interaction) {
  const targetChannel = interaction.options.getChannel('채널') || interaction.channel;

  if (!targetChannel?.isTextBased()) {
    throw new Error('패널을 보낼 텍스트 채널을 찾을 수 없습니다.');
  }

  return targetChannel;
}

async function assertCanCreatePanel(interaction, permissionMessage) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return false;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({ content: permissionMessage, ephemeral: true });
    return false;
  }

  return true;
}

async function handlePanel(interaction) {
  if (!(await assertCanCreatePanel(interaction, '패널 생성은 서버 관리 권한이 필요합니다.'))) return;

  await interaction.deferReply({ ephemeral: true });

  const targetChannel = await getPanelTargetChannel(interaction);

  await targetChannel.send(buildVerifyPanelPayload());
  await targetChannel.send(buildReligionPanelPayload());
  await interaction.editReply(`${targetChannel} 채널에 인증 패널과 종교 역할 패널을 따로 보냈습니다.`);
}

async function handleVerifyPanel(interaction) {
  if (!(await assertCanCreatePanel(interaction, '인증 패널 생성은 서버 관리 권한이 필요합니다.'))) return;

  await interaction.deferReply({ ephemeral: true });

  const targetChannel = await getPanelTargetChannel(interaction);

  await targetChannel.send(buildVerifyPanelPayload());
  await interaction.editReply(`${targetChannel} 채널에 인증 패널을 보냈습니다.`);
}

async function handleReligionPanel(interaction) {
  if (!(await assertCanCreatePanel(interaction, '종교 역할 패널 생성은 서버 관리 권한이 필요합니다.'))) return;

  await interaction.deferReply({ ephemeral: true });

  const targetChannel = await getPanelTargetChannel(interaction);

  await targetChannel.send(buildReligionPanelPayload());
  await interaction.editReply(`${targetChannel} 채널에 종교 역할 패널을 보냈습니다.`);
}

async function handleVerifyGuide(interaction) {
  await createVerificationTicket(interaction);
}

function formatMbtiStatus(member) {
  const selected = mbtiAxes.map((axis) => {
    const selectedLetter = axis.find((letter) => member.roles.cache.some((role) => role.name === `${config.mbtiRolePrefix}${letter}`));
    return selectedLetter || '-';
  });

  return selected.join('');
}

async function applyMbtiRole(interaction, letter) {
  const axis = getMbtiAxis(letter);
  if (!axis) {
    throw new Error('올바른 MBTI 버튼이 아닙니다.');
  }

  const member = await fetchMember(interaction);
  const role = await getOrCreateMbtiRole(interaction.guild, letter);

  await replaceMbtiAxisRole(member, role, letter);
  const updatedMember = await interaction.guild.members.fetch(interaction.user.id);

  return {
    role,
    status: formatMbtiStatus(updatedMember)
  };
}

async function handleMbtiButton(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const letter = interaction.customId.slice(customIds.mbtiPrefix.length).toUpperCase();
  const result = await applyMbtiRole(interaction, letter);

  await interaction.editReply(`"${result.role.name}" 역할을 지급했습니다. 현재 선택: ${result.status}`);
}

async function handleMbtiCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({ content: 'MBTI 패널 설정은 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== '설정') {
    await interaction.editReply('지원하지 않는 MBTI 명령입니다.');
    return;
  }

  const channel = interaction.options.getChannel('채널', true);
  if (!channel.isTextBased()) {
    throw new Error('MBTI 패널을 보낼 텍스트 채널을 선택해 주세요.');
  }

  const permissions = channel.permissionsFor(interaction.guild.members.me);
  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions.has(PermissionsBitField.Flags.SendMessages)) {
    throw new Error(`봇이 ${channel} 채널에 메시지를 보낼 권한이 없습니다.`);
  }

  const guildSettings = await updateGuildSettings(interaction.guildId, { mbtiChannelId: channel.id });
  await channel.send(buildMbtiPanelPayload());
  await interaction.editReply(`MBTI 패널을 ${channel} 채널에 보냈습니다.\n${formatConfiguredSettings(guildSettings)}`);
}

function getAttendanceDisplayName(interaction) {
  return interaction.member?.displayName || interaction.member?.nick || interaction.user.globalName || interaction.user.username;
}

function buildAttendanceEmbed(interaction, result, economyReward = null) {
  const displayName = getAttendanceDisplayName(interaction);
  const description = result.alreadyChecked
    ? [
        `${interaction.user} 오늘은 이미 발도장 콕 찍었듀!`,
        `${result.streak}일째 출석!! 내일도 또 와주면 꼬리 왕왕 흔들겠듀.`
      ]
    : [
        `${interaction.user} ${displayName}님, 오늘 출석 발도장 콕 찍었듀!`,
        `${result.streak}일째 출석!! 듀 가나디가 아주 뿌듯하듀.`
      ];

  const embed = new EmbedBuilder()
    .setTitle(result.alreadyChecked ? '이미 출석했듀' : '출석 완료했듀')
    .setDescription(description.join('\n'))
    .setColor(result.alreadyChecked ? 0xfee75c : 0x57f287)
    .addFields(
      {
        name: '누적 출석',
        value: `${result.total}회`,
        inline: true
      },
      {
        name: '연속 출석',
        value: `${result.streak}일`,
        inline: true
      },
      {
        name: '최고 연속',
        value: `${result.bestStreak}일`,
        inline: true
      }
    );

  if (economyReward && !economyReward.alreadyRewarded) {
    embed.addFields(
      {
        name: '오늘의 듀코인 보상',
        value: `**${formatDuc(economyReward.reward)}**`,
        inline: true
      },
      {
        name: '듀코인 잔액',
        value: formatDuc(economyReward.wallet),
        inline: true
      }
    );
  }

  return embed
    .setFooter({ text: `기준 날짜: ${result.date} (KST)` })
    .setTimestamp();
}

function buildAttendanceRankingEmbed(ranking) {
  const lines = ranking.map((entry, index) =>
    `**${index + 1}위** <@${entry.userId}> - 누적 ${entry.total}회 / 연속 ${entry.streak}일 / 최고 ${entry.bestStreak}일`
  );

  return new EmbedBuilder()
    .setTitle('출석 랭킹')
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: '누적 출석 횟수 기준 TOP 10' })
    .setTimestamp();
}

async function handleAttendanceCheck(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const result = await registerAttendance(interaction.guildId, interaction.user.id);
  const economyReward = await awardAttendanceEconomy(
    interaction.guildId,
    interaction.user.id,
    result,
    {
      username: interaction.user.username,
      displayName: getAttendanceDisplayName(interaction),
      avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 })
    }
  );
  await interaction.editReply({
    embeds: [buildAttendanceEmbed(interaction, result, economyReward)]
  });
}

async function handleAttendanceRanking(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const ranking = await getAttendanceRanking(interaction.guildId, 10);
  if (ranking.length === 0) {
    await interaction.editReply('아직 출석한 사람이 없듀. `/출석체크`로 첫 발도장을 찍어보듀!');
    return;
  }

  await interaction.editReply({
    embeds: [buildAttendanceRankingEmbed(ranking)],
    allowedMentions: { users: [], roles: [] }
  });
}

async function handleAttendanceReset(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({ content: '출석 초기화는 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  await resetGuildAttendance(interaction.guildId);
  await interaction.editReply('출석부를 초기화했듀. 오늘부터 다시 1일째 출석!! 시작할 수 있듀.');
}

async function handleAttendance(interaction) {
  const action = interaction.options.getString('작업') || 'check';

  if (action === 'ranking') {
    await handleAttendanceRanking(interaction);
    return;
  }

  if (action === 'reset') {
    await handleAttendanceReset(interaction);
    return;
  }

  await handleAttendanceCheck(interaction);
}

const levelRankingTypes = {
  overall: { label: '종합', color: 0x5865f2 },
  chat: { label: '채팅', color: 0x57f287 },
  voice: { label: '음성방', color: 0xeb459e }
};

function formatLevelNumber(value) {
  return Math.floor(Number(value) || 0).toLocaleString('ko-KR');
}

function formatVoiceDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];

  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}분`);
  return parts.join(' ');
}

function buildProgressBar(percent) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

function buildLevelEmbed(targetUser, stats, rank) {
  return new EmbedBuilder()
    .setTitle(`${targetUser.globalName || targetUser.username}님의 활동 레벨`)
    .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
    .setColor(0x5865f2)
    .setDescription([
      `## LEVEL ${stats.level}`,
      `${buildProgressBar(stats.progressPercent)} ${stats.progressPercent}%`,
      `${formatLevelNumber(stats.progressXp)} / ${formatLevelNumber(stats.requiredXp)} XP · 종합 ${rank ? `#${rank}` : '순위 없음'}`
    ].join('\n'))
    .addFields(
      {
        name: '종합 XP',
        value: `${formatLevelNumber(stats.totalXp)} XP`,
        inline: true
      },
      {
        name: '채팅 활동',
        value: `${formatLevelNumber(stats.chatCharacters)}자\n${formatLevelNumber(stats.chatMessages)}개 메시지`,
        inline: true
      },
      {
        name: '음성방 활동',
        value: `${formatVoiceDuration(stats.voiceSeconds)}\n${formatLevelNumber(stats.voiceXp)} XP`,
        inline: true
      }
    )
    .setFooter({ text: '채팅 글자수와 음성방 체류 시간을 함께 반영합니다.' })
    .setTimestamp();
}

function buildLevelRankingComponents(activeType) {
  return [
    new ActionRowBuilder().addComponents(
      ...Object.entries(levelRankingTypes).map(([type, values]) =>
        new ButtonBuilder()
          .setCustomId(`${customIds.levelRankingPrefix}${type}`)
          .setLabel(`${values.label} 랭킹`)
          .setStyle(type === activeType ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    )
  ];
}

function formatLevelRankingLine(entry, type) {
  const medal = ['🥇', '🥈', '🥉'][entry.rank - 1] || `**${entry.rank}위**`;

  if (type === 'chat') {
    return `${medal} <@${entry.userId}> · **${formatLevelNumber(entry.chatCharacters)}자** (${formatLevelNumber(entry.chatMessages)}개) · Lv.${entry.level}`;
  }

  if (type === 'voice') {
    return `${medal} <@${entry.userId}> · **${formatVoiceDuration(entry.voiceSeconds)}** · ${formatLevelNumber(entry.voiceXp)} XP`;
  }

  return `${medal} <@${entry.userId}> · **Lv.${entry.level}** · ${formatLevelNumber(entry.totalXp)} XP`;
}

function buildLevelRankingEmbed(ranking, type) {
  const values = levelRankingTypes[type];
  const description = ranking.length > 0
    ? ranking.map((entry) => formatLevelRankingLine(entry, type)).join('\n')
    : `아직 ${values.label} 활동 기록이 없습니다.`;

  return new EmbedBuilder()
    .setTitle(`${values.label} 활동 랭킹`)
    .setDescription(description)
    .setColor(values.color)
    .setFooter({ text: type === 'voice' ? '음성방 누적 체류 시간 기준 TOP 10' : type === 'chat' ? '공백 제외 채팅 글자수 기준 TOP 10' : '채팅 XP + 음성방 XP 기준 TOP 10' })
    .setTimestamp();
}

async function buildLevelRankingReply(guildId, type) {
  const ranking = await getLevelRanking(guildId, type, 10);
  return {
    embeds: [buildLevelRankingEmbed(ranking, type)],
    components: buildLevelRankingComponents(type),
    allowedMentions: { users: [], roles: [] }
  };
}

async function handleLevel(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const targetUser = interaction.options.getUser('유저') || interaction.user;
  const [stats, rank] = await Promise.all([
    getUserLevelStats(interaction.guildId, targetUser.id),
    getUserLevelRank(interaction.guildId, targetUser.id)
  ]);

  await interaction.editReply({
    embeds: [buildLevelEmbed(targetUser, stats, rank)],
    allowedMentions: { users: [], roles: [] }
  });
}

async function handleLevelRanking(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const type = interaction.options.getString('종류') || 'overall';
  if (type === 'economy') {
    await interaction.editReply(await buildEconomyRankingReply(interaction.guildId, 'assets'));
    return;
  }
  await interaction.editReply(await buildLevelRankingReply(interaction.guildId, type));
}

async function handleLevelRankingButton(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const type = interaction.customId.slice(customIds.levelRankingPrefix.length);
  if (!levelRankingTypes[type]) throw new Error('올바른 랭킹 종류가 아닙니다.');

  await interaction.deferUpdate();
  await interaction.editReply(await buildLevelRankingReply(interaction.guildId, type));
}

async function assertWarningCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return false;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.BanMembers);
  if (!hasPermission) {
    await interaction.reply({ content: '경고 관리는 멤버 밴 권한이 필요합니다.', ephemeral: true });
    return false;
  }

  return true;
}

async function fetchTargetMember(interaction, user) {
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

async function assertCanModerateTarget(interaction, targetUser, targetMember) {
  if (targetUser.id === interaction.user.id) {
    throw new Error('자기 자신에게는 경고를 지급하거나 자동 밴할 수 없습니다.');
  }

  if (targetUser.id === interaction.guild.ownerId) {
    throw new Error('서버 소유자는 경고 자동 밴 대상으로 지정할 수 없습니다.');
  }

  const moderatorMember = await interaction.guild.members.fetch(interaction.user.id);
  if (
    targetMember &&
    interaction.guild.ownerId !== interaction.user.id &&
    targetMember.roles.highest.comparePositionTo(moderatorMember.roles.highest) >= 0
  ) {
    throw new Error('나와 같거나 더 높은 역할의 유저에게는 경고를 지급할 수 없습니다.');
  }
}

async function assertCanAutoBanTarget(interaction, targetUser, targetMember) {
  if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.BanMembers)) {
    throw new Error('봇에 Ban Members 권한이 없어 자동 영구 밴을 할 수 없습니다.');
  }

  if (targetUser.id === client.user.id) {
    throw new Error('봇 자신은 자동 밴 대상으로 지정할 수 없습니다.');
  }

  if (targetMember && !targetMember.bannable) {
    throw new Error('봇 역할이 대상보다 낮거나 권한이 부족해서 자동 영구 밴을 할 수 없습니다.');
  }
}

function buildWarningEmbed(targetUser, result, title, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      {
        name: '대상',
        value: `${targetUser} (${targetUser.tag || targetUser.username})`,
        inline: false
      },
      {
        name: '현재 경고',
        value: `${result.activeCount}/${result.threshold}회`,
        inline: true
      },
      {
        name: '누적 지급',
        value: `${result.totalIssued}회`,
        inline: true
      }
    )
    .setTimestamp();
}

async function sendWarningLog(interaction, {
  type,
  targetUser,
  reason,
  result
}) {
  const warningConfig = await getWarningConfig(interaction.guildId);
  if (!warningConfig.logChannelId) return false;

  const channel = interaction.guild.channels.cache.get(warningConfig.logChannelId)
    || await interaction.guild.channels.fetch(warningConfig.logChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.warn(`설정된 경고 로그 채널을 찾을 수 없습니다 (${interaction.guildId}/${warningConfig.logChannelId}).`);
    return false;
  }

  const isIssue = type === 'issue';
  const embed = new EmbedBuilder()
    .setColor(isIssue ? 0xfee75c : 0x57f287)
    .setTitle(isIssue ? '⚠️ 경고 지급 로그' : '✅ 경고 회수 로그')
    .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields(
      {
        name: isIssue ? '경고한 사람' : '경고를 회수한 사람',
        value: `${interaction.user} (${interaction.user.tag || interaction.user.username})`,
        inline: false
      },
      {
        name: '경고 받은 사람',
        value: `${targetUser} (${targetUser.tag || targetUser.username})`,
        inline: false
      },
      {
        name: '경고 사유',
        value: reason,
        inline: false
      },
      {
        name: '현재 경고',
        value: `${result.activeCount}/${result.threshold}회`,
        inline: true
      },
      {
        name: isIssue ? '누적 지급' : '이번 회수',
        value: isIssue ? `${result.totalIssued}회` : `${result.removedAmount}회`,
        inline: true
      }
    )
    .setFooter({ text: `처리자 ID: ${interaction.user.id} · 대상 ID: ${targetUser.id}` })
    .setTimestamp();

  if (isIssue && result.shouldBan) {
    embed.addFields({
      name: '자동 조치',
      value: `경고 ${result.threshold}회 기준에 도달해 자동 영구 밴을 진행합니다.`,
      inline: false
    });
  }

  await channel.send({
    embeds: [embed],
    allowedMentions: { users: [], roles: [] }
  });
  return true;
}

async function handleWarningIssue(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('유저', true);
  const reason = interaction.options.getString('사유') || '사유 없음';
  const targetMember = await fetchTargetMember(interaction, targetUser);

  await assertCanModerateTarget(interaction, targetUser, targetMember);

  const before = await getWarningSummary(interaction.guildId, targetUser.id);
  const willAutoBan = before.threshold > 0 && before.activeCount + 1 >= before.threshold;

  if (willAutoBan) {
    await assertCanAutoBanTarget(interaction, targetUser, targetMember);
  }

  const result = await addWarning(interaction.guildId, targetUser.id, interaction.user.id, reason);
  const embed = buildWarningEmbed(targetUser, result, '경고를 지급했습니다.', 0xfee75c)
    .addFields({
      name: '사유',
      value: reason,
      inline: false
    });

  await sendWarningLog(interaction, {
    type: 'issue',
    targetUser,
    reason,
    result
  }).catch((error) => {
    console.error(`경고 지급 로그 전송 실패 (${interaction.guildId}): ${error.message}`);
  });

  if (!result.shouldBan) {
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const banReason = `경고 ${result.activeCount}/${result.threshold}회 누적: ${reason} | 처리자: ${interaction.user.tag}`;
  await interaction.guild.members.ban(targetUser.id, { reason: banReason });
  await addWarningBanRecord(interaction.guildId, targetUser.id, interaction.user.id, banReason, result.threshold);

  embed
    .setTitle('경고 기준 도달로 영구 밴했습니다.')
    .setColor(0xed4245)
    .addFields({
      name: '자동 조치',
      value: `${result.threshold}회 기준에 도달해서 영구 밴했습니다.`,
      inline: false
    });

  await interaction.editReply({ embeds: [embed] });
}

async function handleWarningRemove(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('유저', true);
  const amount = interaction.options.getInteger('개수') || 1;
  const reason = interaction.options.getString('사유') || '사유 없음';
  const before = await getWarningSummary(interaction.guildId, targetUser.id);

  if (before.activeCount < 1) {
    await interaction.editReply(`${targetUser} 님은 현재 회수할 경고가 없습니다.`);
    return;
  }

  const result = await removeWarnings(interaction.guildId, targetUser.id, interaction.user.id, amount, reason);
  const embed = buildWarningEmbed(targetUser, result, '경고를 회수했습니다.', 0x57f287)
    .addFields(
      {
        name: '회수한 경고',
        value: `${result.removedAmount}회`,
        inline: true
      },
      {
        name: '사유',
        value: reason,
        inline: false
      }
    );

  await sendWarningLog(interaction, {
    type: 'remove',
    targetUser,
    reason,
    result
  }).catch((error) => {
    console.error(`경고 회수 로그 전송 실패 (${interaction.guildId}): ${error.message}`);
  });

  await interaction.editReply({ embeds: [embed] });
}

async function handleWarningHistory(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('유저');
  const history = await getWarningHistory(interaction.guildId, targetUser?.id || null);
  const historyText = buildWarningHistoryText(interaction.guild, history, targetUser);
  const suffix = targetUser ? targetUser.id : 'all';
  const attachment = new AttachmentBuilder(Buffer.from(historyText, 'utf8'), {
    name: `warning-history-${interaction.guildId}-${suffix}.txt`
  });

  await interaction.editReply({
    content: targetUser ? `${targetUser} 님의 경고 기록입니다.` : '서버 전체 경고 기록입니다.',
    files: [attachment],
    allowedMentions: { users: [], roles: [] }
  });
}

async function handleWarningSettings(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const threshold = interaction.options.getInteger('자동밴횟수', true);
  const result = await setWarningBanThreshold(interaction.guildId, interaction.user.id, threshold);

  await interaction.editReply(`경고 자동 영구 밴 기준을 ${result.threshold}회로 설정했습니다.`);
}

async function handleWarningLogChannel(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('채널', true);
  const permissions = channel.permissionsFor(interaction.guild.members.me);
  const required = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks
  ];
  if (!permissions?.has(required)) {
    throw new Error(`봇이 ${channel} 채널에서 채널 보기, 메시지 보내기, 링크 첨부 권한을 가져야 합니다.`);
  }

  await setWarningLogChannel(interaction.guildId, interaction.user.id, channel.id);
  await interaction.editReply({
    content: `${channel} 채널을 경고 로그 채널로 설정했습니다.`,
    allowedMentions: { parse: [] }
  });
}

async function handleWarningLogDisable(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await setWarningLogChannel(interaction.guildId, interaction.user.id, null);
  await interaction.editReply('경고 로그 채널 설정을 해제했습니다.');
}

async function handleWarning(interaction) {
  if (!(await assertWarningCommand(interaction))) return;

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === '지급') {
    await handleWarningIssue(interaction);
    return;
  }

  if (subcommand === '회수') {
    await handleWarningRemove(interaction);
    return;
  }

  if (subcommand === '기록') {
    await handleWarningHistory(interaction);
    return;
  }

  if (subcommand === '설정') {
    await handleWarningSettings(interaction);
    return;
  }

  if (subcommand === '로그채널') {
    await handleWarningLogChannel(interaction);
    return;
  }

  if (subcommand === '로그해제') {
    await handleWarningLogDisable(interaction);
    return;
  }

  await interaction.reply({ content: '지원하지 않는 경고 명령입니다.', ephemeral: true });
}

async function assertAnonymousCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return false;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({ content: '익명채팅방 설정은 서버 관리 권한이 필요합니다.', ephemeral: true });
    return false;
  }

  return true;
}

async function canTraceAnonymousUser(interaction) {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    return true;
  }

  const guildSettings = await getGuildSettings(interaction.guildId);
  const adminRoleId = getConfiguredAdminRoleId(guildSettings);
  if (!adminRoleId) return false;

  const member = await fetchMember(interaction);
  return member.roles.cache.has(adminRoleId);
}

function assertAnonymousChannelPermissions(channel) {
  const permissions = channel.permissionsFor(channel.guild.members.me);
  const requiredPermissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ManageWebhooks,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks
  ];
  const missingPermissions = requiredPermissions.filter((permission) => !permissions?.has(permission));

  if (missingPermissions.length > 0) {
    throw new Error(`봇이 ${channel} 채널에서 메시지 보기, 메시지 보내기, 웹훅 관리, 파일 첨부, 링크 임베드 권한을 모두 가져야 합니다.`);
  }
}

function truncateAnonymousText(value, maxLength = 1800) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 20)}\n...내용이 길어 잘렸습니다.`;
}

async function getAnonymousWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  const existingWebhook = webhooks.find(
    (webhook) => webhook.name === anonymousWebhookName && webhook.owner?.id === client.user.id
  );

  if (existingWebhook) return existingWebhook;

  return channel.createWebhook({
    name: anonymousWebhookName,
    reason: '익명채팅방 메시지 전송용 웹훅 생성'
  });
}

function buildAnonymousRelayPayload(content, identity, attachment = null) {
  const cleanContent = truncateAnonymousText(content);
  const contentParts = [];

  if (cleanContent) {
    contentParts.push(cleanContent);
  }

  if (contentParts.length === 0 && attachment) {
    contentParts.push('첨부파일');
  }

  const files = attachment
    ? [{
        attachment: attachment.url,
        name: attachment.name || 'attachment'
      }]
    : [];

  return {
    username: `ㅇㅇ(${identity.code})`,
    content: contentParts.join('\n') || '빈 메시지',
    files,
    allowedMentions: { parse: [], users: [], roles: [] }
  };
}

function buildAnonymousTraceEmbed(guildId, traceResult, user) {
  const { code, identity, messages } = traceResult;
  const recentMessages = messages.slice(-5).reverse();
  const recentLines = recentMessages.map((message, index) => {
    const link = `https://discord.com/channels/${guildId}/${message.channelId}/${message.relayMessageId}`;
    const preview = message.contentPreview ? ` - ${message.contentPreview}` : '';

    return `${index + 1}. [메시지 보기](${link})${preview}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('익명 작성자 추적')
    .setColor(0x5865f2)
    .addFields(
      {
        name: '익명 코드',
        value: code,
        inline: true
      },
      {
        name: '실제 유저',
        value: identity
          ? `${user ? `${user}` : `<@${identity.userId}>`} (${identity.userId})`
          : '찾을 수 없음',
        inline: false
      }
    )
    .setTimestamp();

  if (identity) {
    embed.addFields(
      {
        name: '저장된 태그',
        value: identity.tag || identity.username || '알 수 없음',
        inline: true
      },
      {
        name: '저장된 메시지 수',
        value: `${messages.length}개`,
        inline: true
      }
    );
  }

  embed.addFields({
    name: '최근 메시지',
    value: recentLines.length > 0 ? recentLines.join('\n') : '저장된 메시지가 없습니다.',
    inline: false
  });

  return embed;
}

async function handleAnonymousMessage(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildSettings = await getGuildSettings(interaction.guildId);
  if (!guildSettings.anonymousChannelId) {
    await interaction.editReply('아직 익명채팅방이 설정되지 않았습니다. 관리자에게 `/익명채팅 설정`을 요청해 주세요.');
    return;
  }

  if (interaction.channelId !== guildSettings.anonymousChannelId) {
    await interaction.editReply(`이 명령어는 지정된 익명채팅방 <#${guildSettings.anonymousChannelId}> 에서만 사용할 수 있습니다.`);
    return;
  }

  const content = interaction.options.getString('전달내용', true);
  const attachment = interaction.options.getAttachment('첨부파일');
  const identity = await getOrCreateAnonymousIdentity(interaction.guildId, interaction.user);
  const webhook = await getAnonymousWebhook(interaction.channel);
  const relayMessage = await webhook.send(buildAnonymousRelayPayload(content, identity, attachment));

  await recordAnonymousMessage(interaction.guildId, {
    userId: interaction.user.id,
    code: identity.code,
    channelId: interaction.channelId,
    interactionId: interaction.id,
    relayMessageId: relayMessage.id,
    contentPreview: truncateAnonymousText(content, 120),
    attachmentCount: attachment ? 1 : 0
  });

  await recordChatActivity(
    interaction.guildId,
    interaction.user.id,
    content,
    buildLevelProfile(interaction.user, interaction.member)
  );

  await interaction.editReply('익명 메시지를 전달했습니다.');
}

async function handleAnonymousCommand(interaction) {
  if (!(await assertAnonymousCommand(interaction))) return;

  await interaction.deferReply({ ephemeral: true });

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === '설정') {
    const channel = interaction.options.getChannel('채널', true);
    if (channel.type !== ChannelType.GuildText) {
      throw new Error('익명채팅방은 텍스트 채널만 설정할 수 있습니다.');
    }

    assertAnonymousChannelPermissions(channel);

    await updateGuildSettings(interaction.guildId, { anonymousChannelId: channel.id });
    await interaction.editReply(`${channel} 채널을 익명채팅방으로 설정했습니다. 이제 ${channel} 채널에서만 \`/익명 전달내용:<내용>\`을 사용할 수 있습니다.`);
    return;
  }

  if (subcommand === '해제') {
    await updateGuildSettings(interaction.guildId, { anonymousChannelId: null });
    await interaction.editReply('익명채팅방 설정을 해제했습니다.');
    return;
  }

  if (subcommand === '상태') {
    const guildSettings = await getGuildSettings(interaction.guildId);
    await interaction.editReply(`현재 익명채팅방: ${guildSettings.anonymousChannelId ? `<#${guildSettings.anonymousChannelId}>` : '설정 안 됨'}`);
    return;
  }

  if (subcommand === '추적') {
    if (!(await canTraceAnonymousUser(interaction))) {
      await interaction.editReply('익명 작성자 추적은 서버 관리자 또는 설정된 관리자 역할만 사용할 수 있습니다.');
      return;
    }

    const rawCode = interaction.options.getString('코드', true);
    const traceResult = await traceAnonymousCode(interaction.guildId, rawCode);

    if (!traceResult.identity) {
      await interaction.editReply(`익명 코드 \`${normalizeAnonymousCode(rawCode)}\`에 연결된 유저를 찾을 수 없습니다.`);
      return;
    }

    const user = await client.users.fetch(traceResult.identity.userId).catch(() => null);
    await interaction.editReply({
      embeds: [buildAnonymousTraceEmbed(interaction.guildId, traceResult, user)],
      allowedMentions: { users: [], roles: [] }
    });
    return;
  }

  await interaction.editReply('지원하지 않는 익명채팅 명령입니다.');
}

async function handleClean(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages);
  if (!hasPermission) {
    await interaction.reply({ content: '청소 명령어는 메시지 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  if (!interaction.channel?.isTextBased() || !interaction.channel.messages) {
    await interaction.reply({ content: '메시지를 청소할 수 있는 텍스트 채널에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const botPermissions = interaction.channel.permissionsFor(interaction.guild.members.me);
  if (
    !botPermissions?.has(PermissionsBitField.Flags.ViewChannel) ||
    !botPermissions.has(PermissionsBitField.Flags.ManageMessages) ||
    !botPermissions.has(PermissionsBitField.Flags.ReadMessageHistory)
  ) {
    await interaction.reply({ content: '봇에 채널 보기, 메시지 관리, 메시지 기록 보기 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const amount = interaction.options.getInteger('개수', true);
  const targetUser = interaction.options.getUser('유저');
  const fetchedMessages = await interaction.channel.messages.fetch({ limit: 100 });
  const candidates = targetUser
    ? fetchedMessages.filter((message) => message.author.id === targetUser.id)
    : fetchedMessages;
  const messagesToDelete = [...candidates.values()].slice(0, amount);

  if (messagesToDelete.length === 0) {
    await interaction.editReply(targetUser ? `${targetUser} 님의 최근 메시지를 찾지 못했습니다.` : '삭제할 최근 메시지를 찾지 못했습니다.');
    return;
  }

  const deletedMessages = await interaction.channel.bulkDelete(messagesToDelete, true);
  const skippedCount = messagesToDelete.length - deletedMessages.size;
  const targetText = targetUser ? `${targetUser} 님의 ` : '';
  const skippedText = skippedCount > 0 ? ` 14일이 지난 메시지 등 ${skippedCount}개는 삭제하지 못했습니다.` : '';

  await interaction.editReply(`${targetText}메시지 ${deletedMessages.size}개를 청소했습니다.${skippedText}`);
}

async function handlePing(interaction) {
  await interaction.reply({
    content: `퐁! Discord 연결 정상입니다. 업타임 ${Math.round(process.uptime())}초`,
    ephemeral: true
  });
}

async function handleSettings(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({ content: '설정 변경은 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const role = interaction.options.getRole('인증역할');
  const adminRole = interaction.options.getRole('관리자역할');
  const channel = interaction.options.getChannel('로그채널');

  if (!role && !adminRole && !channel) {
    const guildSettings = await getGuildSettings(interaction.guildId);
    await interaction.editReply(`현재 설정입니다.\n${formatConfiguredSettings(guildSettings)}`);
    return;
  }

  const changes = {};

  if (role) {
    assertCanManageRoles(interaction.guild);
    assertRoleAssignable(interaction.guild, role);
    changes.verifiedRoleId = role.id;
  }

  if (adminRole) {
    if (adminRole.id === interaction.guild.roles.everyone.id) {
      throw new Error('@everyone은 인증 티켓 관리자 역할로 사용할 수 없습니다.');
    }

    changes.adminRoleId = adminRole.id;
  }

  if (channel) {
    const permissions = channel.permissionsFor(interaction.guild.members.me);

    if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions.has(PermissionsBitField.Flags.SendMessages)) {
      throw new Error(`봇이 ${channel} 채널에 메시지를 보낼 권한이 없습니다.`);
    }

    changes.logChannelId = channel.id;
  }

  const guildSettings = await updateGuildSettings(interaction.guildId, changes);
  await interaction.editReply(`설정을 저장했습니다.\n${formatConfiguredSettings(guildSettings)}`);
}

async function handleSelfIntroduction(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({ content: '자기소개 채널 설정은 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const channel = interaction.options.getChannel('채널', true);
  await configureSelfIntroduction(interaction.guild, {
    enabled: true,
    channelId: channel.id
  });

  await interaction.editReply(
    `${channel} 채널에 자기소개 예시 임베드를 표시했습니다. `
    + '이제 멤버가 메시지를 작성할 때마다 안내가 채널 맨 아래에 다시 표시됩니다.'
  );
}

async function handleBibleMessage(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({ content: '가나디 예약 안부 설정은 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  const schedule = normalizeBibleSchedule(config.bibleSchedule);
  const scheduleText = `아침 ${schedule.morning} · 점심 ${schedule.lunch} · 저녁 ${schedule.evening} (한국 시간)`;

  if (subcommand === '설정') {
    const channel = interaction.options.getChannel('채널', true);
    await configureBibleMessage(interaction.guild, {
      enabled: true,
      channelId: channel.id
    });
    await interaction.editReply({
      content: `${channel} 채널에 가나디의 예약 안부를 보냅니다.\n${scheduleText}\n매번 @everyone을 호출하고, 하루 첫 안부에만 성경 말씀을 포함합니다.`,
      allowedMentions: { parse: [] }
    });
    return;
  }

  if (subcommand === '해제') {
    await configureBibleMessage(interaction.guild, { enabled: false });
    await interaction.editReply('가나디의 예약 안부와 성경 말씀 전송을 중단했습니다.');
    return;
  }

  if (subcommand === '상태') {
    const guildSettings = await getGuildSettings(interaction.guildId);
    const bibleSettings = guildSettings.bibleMessage;
    await interaction.editReply({
      content: [
        `사용 여부: ${bibleSettings?.enabled ? '사용 중' : '사용 안 함'}`,
        `전송 채널: ${bibleSettings?.channelId ? `<#${bibleSettings.channelId}>` : '설정 안 됨'}`,
        `예약 시간: ${scheduleText}`,
        '호출 대상: @everyone',
        '성경 말씀: 하루 첫 안부에만 1회'
      ].join('\n'),
      allowedMentions: { parse: [] }
    });
    return;
  }

  await interaction.editReply('지원하지 않는 성경 말씀 명령입니다.');
}

function buildGanadiAffectionEmbed(targetUser, affection) {
  const tier = getGanadiAffectionTier(affection.score);
  const nextGoal = getNextGanadiAffectionGoal(affection.score);
  const displayName = targetUser.globalName || targetUser.username;
  const progressText = nextGoal
    ? `다음 관계까지 **${nextGoal - affection.score}** 남았어!`
    : '가나디와의 관계는 **상한 없이 계속 깊어질 수 있어!**';
  const latestChange = affection.lastChange > 0
    ? `+${affection.lastChange.toLocaleString('ko-KR')}`
    : affection.lastChange.toLocaleString('ko-KR');

  return new EmbedBuilder()
    .setColor(tier.color)
    .setTitle(`💗 ${displayName} × 가나디 호감도`)
    .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
    .setDescription([
      `## ${tier.emoji} ${tier.name}`,
      `${buildGanadiAffectionBar(affection.score)}  **호감도 ${affection.score.toLocaleString('ko-KR')}**`,
      progressText
    ].join('\n'))
    .addFields(
      {
        name: '가나디와 나눈 대화',
        value: `총 **${affection.interactions.toLocaleString('ko-KR')}회**`,
        inline: true
      },
      {
        name: '최근 변화',
        value: affection.interactions > 0 ? `**${latestChange}**` : '**아직 없음**',
        inline: true
      }
    )
    .setFooter({ text: '50에서 시작 · 최저 -99,999 · 상한 없음 · 말의 의도와 강도에 따라 변해듀!' })
    .setTimestamp();
}

async function handleGanadiCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === '사진') {
    const photo = await getRandomGanadiPhoto();
    if (!photo) {
      await interaction.editReply('아직 보여 줄 가나디 사진이 없어듀! `src/ㄱㄴㄷ` 폴더에 이미지를 넣어 줘.');
      return;
    }

    await interaction.editReply({
      content: '가나디 사진 한 장 투척한다듀! 🐶📸',
      files: [new AttachmentBuilder(photo.path, { name: photo.name })],
      allowedMentions: { parse: [] }
    });
    return;
  }

  if (subcommand !== '호감도') {
    await interaction.editReply('지원하지 않는 가나디 명령입니다.');
    return;
  }

  const targetUser = interaction.options.getUser('유저') || interaction.user;
  const affection = await getGanadiAffection(interaction.guildId, targetUser.id);
  await interaction.editReply({
    embeds: [buildGanadiAffectionEmbed(targetUser, affection)],
    allowedMentions: { parse: [] }
  });
}

function serializeInvite(invite) {
  return {
    code: invite.code,
    uses: invite.uses || 0,
    inviterId: invite.inviter?.id || null,
    inviterTag: invite.inviter?.tag || invite.inviter?.username || null,
    inviterUsername: invite.inviter?.username || null
  };
}

async function refreshInviteCache(guild) {
  try {
    const invites = await guild.invites.fetch();
    const inviteMap = new Map();

    invites.forEach((invite) => {
      inviteMap.set(invite.code, serializeInvite(invite));
    });

    inviteCache.set(guild.id, inviteMap);
    return inviteMap;
  } catch (error) {
    console.warn(`초대 목록을 불러오지 못했습니다 (${guild.id}): ${error.message}`);
    if (!inviteCache.has(guild.id)) inviteCache.set(guild.id, new Map());
    return inviteCache.get(guild.id);
  }
}

async function resolveInviteUse(guild) {
  const previousInvites = inviteCache.get(guild.id) || new Map();

  try {
    const currentInvites = await guild.invites.fetch();
    let usedInvite = null;
    const nextInvites = new Map();

    currentInvites.forEach((invite) => {
      const serialized = serializeInvite(invite);
      const previous = previousInvites.get(invite.code);

      if (!usedInvite && previous && serialized.uses > previous.uses) {
        usedInvite = serialized;
      }

      nextInvites.set(invite.code, serialized);
    });

    inviteCache.set(guild.id, nextInvites);

    if (!usedInvite) return null;

    return {
      id: usedInvite.inviterId,
      username: usedInvite.inviterUsername,
      tag: usedInvite.inviterTag,
      mention: usedInvite.inviterId ? `<@${usedInvite.inviterId}>` : null
    };
  } catch (error) {
    console.warn(`초대 사용자를 확인하지 못했습니다 (${guild.id}): ${error.message}`);
    return null;
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`${readyClient.user.tag} 로그인 완료`);

  await Promise.all([...readyClient.guilds.cache.values()].map((guild) => refreshInviteCache(guild)));

  for (const guild of readyClient.guilds.cache.values()) {
    for (const voiceState of guild.voiceStates.cache.values()) {
      startTrackedVoiceState(voiceState);
    }
  }

  const bibleSchedule = normalizeBibleSchedule(config.bibleSchedule);
  startBibleScheduler(readyClient, openai, {
    model: config.openaiChatModel,
    schedule: bibleSchedule,
    graceMinutes: config.bibleSchedulerGraceMinutes,
    intervalMs: config.bibleSchedulerIntervalMs
  });
  console.log(
    `가나디 안부 스케줄러 시작 (KST 아침 ${bibleSchedule.morning}, 점심 ${bibleSchedule.lunch}, 저녁 ${bibleSchedule.evening}, 말씀 1일 1회)`
  );

  startBirthdayScheduler(readyClient);
  console.log('생일 축하 스케줄러 시작 (KST 오전 09:00 이후, 하루 1회)');

  if (!config.autoRegisterUpdateCommand) return;

  try {
    const useGlobal = !config.discordGuildId;
    const result = await ensureUpdateCommand({ global: useGlobal });
    console.log(`/업데이트 명령어 확인 완료 (${result.scope}, ${result.created ? 'created' : 'updated'})`);
  } catch (error) {
    console.error(`/업데이트 자동 등록 실패: ${error.message}`);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot || message.webhookId) return;

  try {
    await recordChatActivity(
      message.guildId,
      message.author.id,
      message.content,
      buildLevelProfile(message.author, message.member)
    );
  } catch (error) {
    console.error(`채팅 레벨 기록 실패 (${message.guildId}/${message.author.id}): ${error.message}`);
  }

  try {
    await enqueueGanadiReply(message);
  } catch (error) {
    console.error(`가나디 캐릭터 응답 실패 (${message.guildId}/${message.channelId}): ${error.message}`);
    await message.reply({
      content: '듀… 지금 생각이 살짝 꼬였어. 조금 뒤에 다시 불러줘!',
      allowedMentions: { parse: [], repliedUser: false }
    }).catch(() => null);
  }

  try {
    await refreshSelfIntroductionAfterMessage(message);
  } catch (error) {
    console.error(`자기소개 안내 갱신 실패 (${message.guildId}/${message.channelId}): ${error.message}`);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (newState.member?.user.bot || oldState.member?.user.bot) return;

  try {
    const wasEligible = isEligibleVoiceState(oldState);
    const isEligible = isEligibleVoiceState(newState);

    if (!wasEligible && isEligible) {
      startTrackedVoiceState(newState);
      return;
    }

    if (wasEligible && !isEligible) {
      await endVoiceSession(oldState.guild.id, oldState.id);
    }
  } catch (error) {
    const guildId = newState.guild?.id || oldState.guild?.id || 'unknown';
    const userId = newState.id || oldState.id || 'unknown';
    console.error(`음성방 레벨 기록 실패 (${guildId}/${userId}): ${error.message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId === birthdayCustomIds.register) {
        await handleBirthdayRegisterButton(interaction);
        return;
      }

      if (interaction.customId === birthdayCustomIds.remove) {
        await handleBirthdayRemoveButton(interaction);
        return;
      }

      if (interaction.customId === customIds.verifyGuide) {
        await handleVerifyGuide(interaction);
        return;
      }

      if (interaction.customId === customIds.ticketApprove) {
        await handleTicketApprove(interaction);
        return;
      }

      if (interaction.customId === customIds.ticketClose) {
        await handleTicketClose(interaction);
        return;
      }

      if (interaction.customId === customIds.religionCustomButton) {
        await interaction.showModal(buildCustomReligionModal());
        return;
      }

      if (interaction.customId.startsWith(customIds.mbtiPrefix)) {
        await handleMbtiButton(interaction);
        return;
      }

      if (interaction.customId.startsWith(customIds.levelRankingPrefix)) {
        await handleLevelRankingButton(interaction);
        return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === customIds.religionSelect) {
      await handleReligionSelect(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === customIds.religionCustomModal) {
      await handleCustomReligionModal(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === birthdayCustomIds.modal) {
      await handleBirthdayModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === commandNames.update) {
      await handleUpdate(interaction);
      return;
    }

    if (interaction.commandName === commandNames.verify) {
      await handleVerify(interaction);
      return;
    }

    if (interaction.commandName === commandNames.religion) {
      await handleReligion(interaction);
      return;
    }

    if (interaction.commandName === commandNames.settings) {
      await handleSettings(interaction);
      return;
    }

    if (interaction.commandName === commandNames.panel) {
      await handlePanel(interaction);
      return;
    }

    if (interaction.commandName === commandNames.verifyPanel) {
      await handleVerifyPanel(interaction);
      return;
    }

    if (interaction.commandName === commandNames.religionPanel) {
      await handleReligionPanel(interaction);
      return;
    }

    if (interaction.commandName === commandNames.mbti) {
      await handleMbtiCommand(interaction);
      return;
    }

    if (interaction.commandName === commandNames.addEmoji) {
      await handleAddEmoji(interaction);
      return;
    }

    if (interaction.commandName === commandNames.attendance) {
      await handleAttendance(interaction);
      return;
    }

    if (interaction.commandName === commandNames.warning) {
      await handleWarning(interaction);
      return;
    }

    if (interaction.commandName === commandNames.anonymous) {
      await handleAnonymousCommand(interaction);
      return;
    }

    if (interaction.commandName === commandNames.anonymousMessage) {
      await handleAnonymousMessage(interaction);
      return;
    }

    if (interaction.commandName === commandNames.selfIntroduction) {
      await handleSelfIntroduction(interaction);
      return;
    }

    if (interaction.commandName === commandNames.bibleMessage) {
      await handleBibleMessage(interaction);
      return;
    }

    if (interaction.commandName === commandNames.birthday) {
      await handleBirthdayCommand(interaction);
      return;
    }

    if (interaction.commandName === commandNames.ganadi) {
      await handleGanadiCommand(interaction);
      return;
    }

    if (interaction.commandName === commandNames.level) {
      await handleLevel(interaction);
      return;
    }

    if (interaction.commandName === commandNames.levelRanking) {
      await handleLevelRanking(interaction);
      return;
    }

    if (interaction.commandName === commandNames.clean) {
      await handleClean(interaction);
      return;
    }

    if (interaction.commandName === commandNames.ping) {
      await handlePing(interaction);
      return;
    }

    if (isEconomyCommand(interaction.commandName)) {
      await handleEconomyCommand(interaction);
      return;
    }

  } catch (error) {
    const interactionName = interaction.commandName || interaction.customId || interaction.type;
    console.error(`상호작용 처리 실패 (${interactionName}): ${error.message}`);

    const message = error.message || '처리 중 오류가 발생했습니다.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`오류: ${message}`).catch(() => null);
    } else if (interaction.isRepliable()) {
      await interaction.reply({ content: `오류: ${message}`, ephemeral: true }).catch(() => null);
    }
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const inviterInfo = await resolveInviteUse(member.guild);
    await sendWelcomeMessage(member, inviterInfo);
  } catch (error) {
    console.error(`환영 메시지 전송 실패 (${member.guild.id}/${member.id}): ${error.message}`);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await sendLeaveMessage(member);
  } catch (error) {
    console.error(`퇴장 로그 전송 실패 (${member.guild.id}/${member.id}): ${error.message}`);
  }
});

client.on(Events.InviteCreate, async (invite) => {
  if (invite.guild) {
    await refreshInviteCache(invite.guild);
  }
});

client.on(Events.InviteDelete, async (invite) => {
  if (invite.guild) {
    await refreshInviteCache(invite.guild);
  }
});

client.on(Events.Error, (error) => {
  console.error(`Discord client error: ${error.message}`);
});

client.on(Events.Warn, (warning) => {
  console.warn(`Discord client warning: ${warning}`);
});

client.on(Events.ShardDisconnect, (event) => {
  console.error(`Discord gateway disconnected: ${event.code} ${event.reason || ''}`.trim());
  checkpointVoiceSessions().catch((error) => {
    console.error(`음성방 체크포인트 저장 실패: ${error.message}`);
  });
});

const voiceCheckpointTimer = setInterval(() => {
  checkpointVoiceSessions().catch((error) => {
    console.error(`음성방 체크포인트 저장 실패: ${error.message}`);
  });
}, 60 * 1000);
voiceCheckpointTimer.unref();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exitCode = 1;
});

client.login(config.discordToken).catch((error) => {
  console.error(`Discord login failed: ${error.message}`);
  process.exitCode = 1;
});
