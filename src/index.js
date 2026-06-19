import OpenAI from 'openai';
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
  analyzeVerificationImage,
  getVerificationApprovalLabel,
  isVerificationApproved
} from './openaiVerify.js';
import {
  assertCanManageRoles,
  assertRoleAssignable,
  getOrCreateReligionRole,
  getOrCreateVerifiedRole,
  replaceReligionRole,
  sanitizeReligionName
} from './roles.js';
import { getGuildSettings, updateGuildSettings } from './settings.js';
import { ensureUpdateCommand, syncAllCommands } from './sync-commands.js';

assertRequiredConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

startHealthServer(client);

const openai = new OpenAI({
  apiKey: config.openaiApiKey
});

const customIds = {
  verifyGuide: 'verify:start',
  religionSelect: 'religion:select',
  religionCustomButton: 'religion:custom',
  religionCustomModal: 'religion:custom:modal',
  religionCustomInput: 'religion_name'
};

function isAllowedImage(attachment) {
  const contentType = attachment.contentType?.toLowerCase() || '';
  const filename = attachment.name?.toLowerCase() || '';

  return (
    contentType.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/.test(filename)
  );
}

function getMimeType(attachment) {
  if (attachment.contentType?.startsWith('image/')) {
    return attachment.contentType.split(';')[0];
  }

  const filename = attachment.name?.toLowerCase() || '';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.webp')) return 'image/webp';
  if (filename.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

async function attachmentToDataUrl(attachment) {
  if (!isAllowedImage(attachment)) {
    throw new Error('PNG, JPG, WEBP, GIF 이미지 파일만 사용할 수 있습니다.');
  }

  if (attachment.size > config.maxImageBytes) {
    const maxMb = Math.round(config.maxImageBytes / 1024 / 1024);
    throw new Error(`이미지는 ${maxMb}MB 이하로 올려 주세요.`);
  }

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error('첨부 이미지를 다운로드하지 못했습니다.');
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > config.maxImageBytes) {
    const maxMb = Math.round(config.maxImageBytes / 1024 / 1024);
    throw new Error(`이미지는 ${maxMb}MB 이하로 올려 주세요.`);
  }

  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return `data:${getMimeType(attachment)};base64,${base64}`;
}

async function fetchMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
}

function buildPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('인증 및 역할 선택')
    .setDescription([
      `주민등록증 또는 고등학생 학생증과 "${config.requiredPhrase}" 문구 종이를 준비해 주세요.`,
      '아래에서 인증 안내를 확인하고, 종교 역할은 드롭다운 또는 직접 입력으로 선택할 수 있습니다.'
    ].join('\n'))
    .setColor(0x5865f2);

  const verifyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customIds.verifyGuide)
      .setLabel('인증 시작')
      .setStyle(ButtonStyle.Primary)
  );

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
    components: [verifyRow, religionSelectRow, customReligionRow]
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

function formatConfiguredSettings(guildSettings) {
  const verifiedRoleId = guildSettings.verifiedRoleId || config.verifiedRoleId;
  const logChannelId = getConfiguredLogChannelId(guildSettings);

  return [
    `인증 역할: ${verifiedRoleId ? `<@&${verifiedRoleId}>` : `"${config.verifiedRoleName}" 자동 생성/사용`}`,
    `로그 채널: ${logChannelId ? `<#${logChannelId}>` : '설정 안 됨'}`
  ].join('\n');
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

function formatApprovalFailure(result) {
  return [
    '인증 조건을 통과하지 못했습니다.',
    `사유: ${result.reason || '필수 요소를 확인하지 못했습니다.'}`,
    '',
    `주민등록증은 하이패스 대상이고, 학생증은 고등학생 학생증만 통과합니다.`,
    `사진 안에 대상 신분증과 "${config.requiredPhrase}" 문구가 적힌 종이가 함께 보이도록 다시 촬영해 주세요.`
  ].join('\n');
}

async function handleVerify(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildSettings = await getGuildSettings(interaction.guildId);
  const attachment = interaction.options.getAttachment('사진', true);
  const dataUrl = await attachmentToDataUrl(attachment);
  const result = await analyzeVerificationImage(openai, {
    dataUrl,
    model: config.openaiVisionModel,
    requiredPhrase: config.requiredPhrase
  });
  const approved = isVerificationApproved(result, config.verificationMinConfidence);

  if (!approved) {
    await sendVerificationLog(interaction, false, result, null, guildSettings);
    await interaction.editReply(formatApprovalFailure(result));
    return;
  }

  const member = await fetchMember(interaction);
  const role = await getOrCreateVerifiedRole(interaction.guild, guildSettings);

  await member.roles.add(role, `OpenAI 인증 통과: ${member.user.tag}`);
  await sendVerificationLog(interaction, true, result, role.name, guildSettings);
  await interaction.editReply(`${getVerificationApprovalLabel(result)}으로 인증이 완료되어 "${role.name}" 역할을 지급했습니다.`);
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

async function handlePanel(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({ content: '패널 생성은 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const targetChannel = interaction.options.getChannel('채널') || interaction.channel;

  if (!targetChannel?.isTextBased()) {
    throw new Error('패널을 보낼 텍스트 채널을 찾을 수 없습니다.');
  }

  await targetChannel.send(buildPanelPayload());
  await interaction.editReply(`${targetChannel} 채널에 인증 UI 패널을 보냈습니다.`);
}

async function handleVerifyGuide(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  await interaction.reply({
    content: [
      '인증 사진 제출은 개인정보 보호를 위해 슬래시 명령어 첨부 방식으로 진행합니다.',
      `1. 주민등록증 또는 고등학생 학생증과 "${config.requiredPhrase}" 문구가 적힌 종이를 함께 촬영해 주세요.`,
      '2. `/인증` 명령어를 선택하고 `사진` 옵션에 이미지를 첨부해 주세요.',
      '3. 통과하면 설정된 인증 역할이 자동으로 지급됩니다.',
      '',
      '사진 파일은 봇이 저장하지 않고 분석에만 사용합니다.'
    ].join('\n'),
    ephemeral: true
  });
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
  const channel = interaction.options.getChannel('로그채널');

  if (!role && !channel) {
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

      if (interaction.customId === customIds.religionCustomButton) {
        await interaction.showModal(buildCustomReligionModal());
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
