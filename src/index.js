import {
  ActionRowBuilder,
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
import { commandNames } from './commands.js';
import { assertRequiredConfig, config } from './config.js';
import { startHealthServer } from './health-server.js';
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
import { ensureUpdateCommand, syncAllCommands } from './sync-commands.js';

assertRequiredConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
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
  mbtiPrefix: 'mbti:'
};

async function fetchMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
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
    `MBTI 채널: ${guildSettings.mbtiChannelId ? `<#${guildSettings.mbtiChannelId}>` : '설정 안 됨'}`
  ].join('\n');
}

function replaceWelcomeTokens(value, member) {
  const replacements = {
    '{user}': member.user.username,
    '{tag}': member.user.tag,
    '{mention}': `${member}`,
    '{server}': member.guild.name,
    '{memberCount}': String(member.guild.memberCount || '')
  };

  return Object.entries(replacements).reduce(
    (result, [token, replacement]) => result.replaceAll(token, replacement),
    value || ''
  );
}

function parseEmbedColor(value) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value || '')) return 0x57f287;
  return Number.parseInt(value.slice(1), 16);
}

async function sendWelcomeMessage(member) {
  const guildSettings = await getGuildSettings(member.guild.id);
  const welcome = guildSettings.welcome;

  if (!welcome?.enabled || !welcome.channelId) return;

  const channel = await member.guild.channels.fetch(welcome.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const title = replaceWelcomeTokens(welcome.embedTitle || '{user} 님 환영합니다', member);
  const description = [
    replaceWelcomeTokens(welcome.message || '{mention} 님, {server}에 오신 것을 환영합니다!', member),
    welcome.emojiText || ''
  ].filter(Boolean).join('\n');
  const content = welcome.mentionUser ? `${member}` : '';
  const allowedMentions = welcome.mentionUser ? { users: [member.id], roles: [] } : { users: [], roles: [] };

  if (welcome.useEmbed === false) {
    await channel.send({
      content: [content, description].filter(Boolean).join('\n'),
      allowedMentions
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(title || '환영합니다')
    .setDescription(description || `${member} 님 환영합니다!`)
    .setColor(parseEmbedColor(welcome.embedColor))
    .setTimestamp();

  if (welcome.showProfileImage !== false) {
    embed.setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }));
  }

  await channel.send({
    content,
    embeds: [embed],
    allowedMentions
  });
}

async function sendVerificationLog(interaction, approved, result, roleName, guildSettings) {
  const logChannelId = getConfiguredLogChannelId(guildSettings);
  if (!logChannelId) return;

  const channel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  await channel.send({
    content: [
      `인증 ${approved ? '승인' : '거절'}: <@${interaction.user.id}>`,
      `문서: ${result.document_type}`,
      `판정: ${result.verification_path}`,
      `학생 구분: ${result.student_school_level}`,
      `문구: ${result.required_phrase_text_matches ? '일치' : '불일치'}`,
      `신뢰도: ${Number(result.confidence).toFixed(2)}`,
      approved ? `지급 역할: ${roleName}` : `사유: ${result.reason}`
    ].join('\n'),
    allowedMentions: { users: [] }
  });
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

  const role = await applyReligionRole(interaction, rawName);
  await interaction.editReply(`"${role.name}" 역할을 지급했습니다.`);
}

async function applyReligionRole(interaction, rawName) {
  const religionName = sanitizeReligionName(rawName);
  const role = await getOrCreateReligionRole(interaction.guild, religionName);
  const member = await fetchMember(interaction);

  await replaceReligionRole(member, role);
  return role;
}

async function handleReligionSelect(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const role = await applyReligionRole(interaction, interaction.values[0]);
  await interaction.editReply(`"${role.name}" 역할을 지급했습니다.`);
}

async function handleCustomReligionModal(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const rawName = interaction.fields.getTextInputValue(customIds.religionCustomInput);
  const role = await applyReligionRole(interaction, rawName);
  await interaction.editReply(`"${role.name}" 역할을 지급했습니다.`);
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

  await interaction.deferReply({ ephemeral: true });

  const scope = interaction.options.getString('범위') || 'guild';
  const result = await syncAllCommands({
    guildId: interaction.guildId,
    global: scope === 'global'
  });

  const target = result.scope === 'global' ? '전역' : '현재 서버';
  await interaction.editReply(`${target} 명령어 ${result.count}개를 동기화했습니다.`);
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

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`${readyClient.user.tag} 로그인 완료`);

  if (!config.autoRegisterUpdateCommand) return;

  try {
    const useGlobal = !config.discordGuildId;
    const result = await ensureUpdateCommand({ global: useGlobal });
    console.log(`/업데이트 명령어 확인 완료 (${result.scope}, ${result.created ? 'created' : 'updated'})`);
  } catch (error) {
    console.error(`/업데이트 자동 등록 실패: ${error.message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
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
    }

    if (interaction.isStringSelectMenu() && interaction.customId === customIds.religionSelect) {
      await handleReligionSelect(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === customIds.religionCustomModal) {
      await handleCustomReligionModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

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

    if (interaction.commandName === commandNames.ping) {
      await handlePing(interaction);
      return;
    }

    if (interaction.commandName === commandNames.update) {
      await handleUpdate(interaction);
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
    await sendWelcomeMessage(member);
  } catch (error) {
    console.error(`환영 메시지 전송 실패 (${member.guild.id}/${member.id}): ${error.message}`);
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
});

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
