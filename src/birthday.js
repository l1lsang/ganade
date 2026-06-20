import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { getGuildSettings, updateGuildSettings } from './settings.js';

export const birthdayCustomIds = Object.freeze({
  register: 'birthday:register',
  remove: 'birthday:remove',
  modal: 'birthday:modal',
  dateInput: 'birthday:date'
});

export const defaultBirthdayAnnouncementTime = '09:00';

const birthdayDataPath = process.env.BIRTHDAY_DATA_PATH
  || path.join(process.cwd(), 'data', 'birthdays.json');
const daysByMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const deliveredAnnouncements = new Set();
const koreanDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

let birthdayCache = null;
let mutationQueue = Promise.resolve();

function isValidBirthday(month, day) {
  return Number.isInteger(month)
    && Number.isInteger(day)
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= daysByMonth[month - 1];
}

export function formatBirthday(month, day) {
  return `${month}월 ${day}일`;
}

export function parseBirthdayInput(value) {
  const normalized = String(value || '').normalize('NFKC').trim();
  const match = /^(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*(?:일)?$/.exec(normalized);
  if (!match) {
    throw new Error('생일을 `3월 14일` 또는 `03-14` 형식으로 입력해 주세요.');
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!isValidBirthday(month, day)) {
    throw new Error('존재하는 월과 일을 입력해 주세요. 2월 29일도 등록할 수 있습니다.');
  }

  return { month, day };
}

function normalizeProfile(profile = {}) {
  return {
    username: typeof profile.username === 'string' ? profile.username.slice(0, 100) : null,
    displayName: typeof profile.displayName === 'string' ? profile.displayName.slice(0, 100) : null,
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.slice(0, 500) : null
  };
}

function normalizeBirthdayRecord(record = {}) {
  const month = Number(record.month);
  const day = Number(record.day);
  if (!isValidBirthday(month, day)) return null;

  return {
    month,
    day,
    ...normalizeProfile(record),
    lastAnnouncedDate: typeof record.lastAnnouncedDate === 'string'
      ? record.lastAnnouncedDate
      : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null
  };
}

async function readAllBirthdays() {
  if (birthdayCache) return birthdayCache;

  try {
    birthdayCache = JSON.parse(await readFile(birthdayDataPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    birthdayCache = {};
  }

  return birthdayCache;
}

async function writeAllBirthdays(data) {
  await mkdir(path.dirname(birthdayDataPath), { recursive: true });
  await writeFile(birthdayDataPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  birthdayCache = data;
}

function enqueueBirthdayMutation(mutator) {
  const task = mutationQueue.then(async () => mutator(await readAllBirthdays()));
  mutationQueue = task.catch(() => null);
  return task;
}

export async function getBirthday(guildId, userId) {
  const data = await readAllBirthdays();
  return normalizeBirthdayRecord(data[guildId]?.users?.[userId]);
}

export async function registerBirthday(guildId, userId, birthday, profile = {}, now = Date.now()) {
  if (!isValidBirthday(birthday?.month, birthday?.day)) {
    throw new Error('유효하지 않은 생일입니다.');
  }

  return enqueueBirthdayMutation(async (data) => {
    const guildData = data[guildId] || { users: {} };
    const current = normalizeBirthdayRecord(guildData.users?.[userId]);
    const nextProfile = normalizeProfile(profile);
    const next = {
      month: birthday.month,
      day: birthday.day,
      username: nextProfile.username || current?.username || null,
      displayName: nextProfile.displayName || current?.displayName || null,
      avatarUrl: nextProfile.avatarUrl || current?.avatarUrl || null,
      lastAnnouncedDate: current?.lastAnnouncedDate || null,
      updatedAt: new Date(now).toISOString()
    };

    data[guildId] = {
      ...guildData,
      users: {
        ...(guildData.users || {}),
        [userId]: next
      },
      updatedAt: new Date(now).toISOString()
    };
    await writeAllBirthdays(data);
    return next;
  });
}

export async function removeBirthday(guildId, userId, now = Date.now()) {
  return enqueueBirthdayMutation(async (data) => {
    const guildData = data[guildId];
    if (!guildData?.users?.[userId]) return false;

    const users = { ...guildData.users };
    delete users[userId];
    data[guildId] = {
      ...guildData,
      users,
      updatedAt: new Date(now).toISOString()
    };
    await writeAllBirthdays(data);
    return true;
  });
}

export async function getBirthdaysForDate(guildId, month, day) {
  const data = await readAllBirthdays();
  return Object.entries(data[guildId]?.users || {}).flatMap(([userId, rawRecord]) => {
    const record = normalizeBirthdayRecord(rawRecord);
    return record?.month === month && record.day === day ? [{ userId, ...record }] : [];
  });
}

export async function getBirthdayCount(guildId) {
  const data = await readAllBirthdays();
  return Object.values(data[guildId]?.users || {})
    .filter((record) => normalizeBirthdayRecord(record))
    .length;
}

async function markBirthdayAnnounced(guildId, userId, date, now = Date.now()) {
  return enqueueBirthdayMutation(async (data) => {
    const guildData = data[guildId];
    const current = normalizeBirthdayRecord(guildData?.users?.[userId]);
    if (!current) return null;

    const next = {
      ...current,
      lastAnnouncedDate: date,
      updatedAt: new Date(now).toISOString()
    };
    data[guildId] = {
      ...guildData,
      users: {
        ...guildData.users,
        [userId]: next
      },
      updatedAt: new Date(now).toISOString()
    };
    await writeAllBirthdays(data);
    return next;
  });
}

export function buildBirthdayRegistrationPayload({ disabled = false } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0xff78b4)
    .setTitle('🎂 듀 가나디의 생일 우체통')
    .setDescription([
      ...(disabled ? ['⏸️ **현재 생일 등록 기능이 잠시 중단되어 있어.**', ''] : []),
      '아래 버튼을 눌러 **월·일만** 등록하면 생일날 가나디가 모두에게 예쁘게 축하해 줄게!',
      '',
      '🎈 `생일 등록/수정` — 내 생일을 새로 등록하거나 바꾸기',
      '🗑️ `등록 해제` — 저장된 내 생일 지우기',
      '',
      '등록한 월·일은 이 서버의 생일 축하에만 사용돼. 2월 29일은 윤년에 축하해!'
    ].join('\n'))
    .setFooter({ text: '생년은 저장하지 않아듀 · 언제든 수정하거나 지울 수 있어!' });

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(birthdayCustomIds.register)
      .setLabel('생일 등록/수정')
      .setEmoji('🎂')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(birthdayCustomIds.remove)
      .setLabel('등록 해제')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  return { embeds: [embed], components: [controls] };
}

export function buildBirthdayModal(existingBirthday = null) {
  const input = new TextInputBuilder()
    .setCustomId(birthdayCustomIds.dateInput)
    .setLabel('생일 (월·일)')
    .setPlaceholder('예: 3월 14일 또는 03-14')
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(10)
    .setRequired(true);

  if (existingBirthday) {
    input.setValue(`${String(existingBirthday.month).padStart(2, '0')}-${String(existingBirthday.day).padStart(2, '0')}`);
  }

  return new ModalBuilder()
    .setCustomId(birthdayCustomIds.modal)
    .setTitle(existingBirthday ? '내 생일 수정하기' : '내 생일 등록하기')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function getBirthdayChannel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function assertBirthdayChannelPermissions(guild, channel) {
  const permissions = channel.permissionsFor(guild.members.me);
  const required = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ReadMessageHistory
  ];
  if (!permissions?.has(required)) {
    throw new Error(`봇이 ${channel} 채널에서 채널 보기, 메시지 보내기, 링크 첨부, 기록 보기 권한을 가져야 합니다.`);
  }
}

async function createBirthdayRegistrationChannel(guild, parentId = null) {
  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error('봇에 채널 관리 권한이 없어 생일 등록 채널을 만들 수 없습니다. 기존 채널을 직접 지정해 주세요.');
  }

  return guild.channels.create({
    name: '🎂ㆍ생일-등록',
    type: ChannelType.GuildText,
    ...(parentId ? { parent: parentId } : {}),
    topic: '듀 가나디 생일 등록 및 생일 축하 채널',
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
        deny: [PermissionsBitField.Flags.SendMessages]
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ],
    reason: '듀 가나디 생일 등록 UI 채널 생성'
  });
}

async function postOrRefreshBirthdayPanel(channel, panelMessageId = null) {
  const previous = panelMessageId
    ? await channel.messages.fetch(panelMessageId).catch(() => null)
    : null;
  return previous
    ? previous.edit(buildBirthdayRegistrationPayload())
    : channel.send(buildBirthdayRegistrationPayload());
}

async function disableBirthdayPanel(guild, settings) {
  if (!settings?.channelId || !settings.panelMessageId) return;
  const channel = await getBirthdayChannel(guild, settings.channelId);
  if (!channel) return;
  const panel = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
  if (panel) await panel.edit(buildBirthdayRegistrationPayload({ disabled: true })).catch(() => null);
}

async function isActiveBirthdayPanel(interaction) {
  if (!interaction.inGuild()) return false;
  const settings = await getGuildSettings(interaction.guildId);
  return settings.birthday?.enabled === true
    && settings.birthday.channelId === interaction.channelId;
}

function buildBirthdayProfile(interaction) {
  return {
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 })
  };
}

export async function handleBirthdayRegisterButton(interaction) {
  if (!(await isActiveBirthdayPanel(interaction))) {
    await interaction.reply({ content: '지금 사용 중인 생일 등록 패널이 아니야. 관리자에게 새 패널을 확인해 달라고 해 줘!', ephemeral: true });
    return;
  }

  const birthday = await getBirthday(interaction.guildId, interaction.user.id);
  await interaction.showModal(buildBirthdayModal(birthday));
}

export async function handleBirthdayRemoveButton(interaction) {
  if (!(await isActiveBirthdayPanel(interaction))) {
    await interaction.reply({ content: '지금 사용 중인 생일 등록 패널이 아니야.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const removed = await removeBirthday(interaction.guildId, interaction.user.id);
  await interaction.editReply(removed
    ? '저장된 생일을 지웠어. 나중에 다시 등록하고 싶으면 언제든 버튼을 눌러 줘, 듀!'
    : '아직 등록된 생일이 없어듀!');
}

export async function handleBirthdayModal(interaction) {
  if (!(await isActiveBirthdayPanel(interaction))) {
    await interaction.reply({ content: '생일 등록 채널 설정이 바뀌었어. 새 패널에서 다시 등록해 줘!', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const birthday = parseBirthdayInput(
    interaction.fields.getTextInputValue(birthdayCustomIds.dateInput)
  );
  await registerBirthday(
    interaction.guildId,
    interaction.user.id,
    birthday,
    buildBirthdayProfile(interaction)
  );
  await interaction.editReply(
    `🎂 **${formatBirthday(birthday.month, birthday.day)}**로 등록했어! 그날이 오면 가나디가 신나게 축하해 줄게, 듀!`
  );
}

export async function handleBirthdayCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있습니다.', ephemeral: true });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await interaction.reply({ content: '생일 기능 설정은 서버 관리 권한이 필요합니다.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  const settings = await getGuildSettings(interaction.guildId);
  const current = settings.birthday || {};

  if (subcommand === '설정') {
    let channel = interaction.options.getChannel('채널');
    let created = false;

    if (!channel && current.channelId) {
      channel = await getBirthdayChannel(interaction.guild, current.channelId);
    }
    if (!channel) {
      channel = await createBirthdayRegistrationChannel(
        interaction.guild,
        interaction.channel?.parentId || null
      );
      created = true;
    }

    assertBirthdayChannelPermissions(interaction.guild, channel);
    const panel = await postOrRefreshBirthdayPanel(
      channel,
      current.channelId === channel.id ? current.panelMessageId : null
    );
    if (current.channelId && current.channelId !== channel.id) {
      await disableBirthdayPanel(interaction.guild, current);
    }
    await updateGuildSettings(interaction.guildId, {
      birthday: {
        ...current,
        enabled: true,
        channelId: channel.id,
        panelMessageId: panel.id
      }
    });

    await interaction.editReply({
      content: created
        ? `${channel} 생일 등록 채널을 만들고 Discord UI를 게시했어듀! 생일 축하도 이 채널로 보낼게.`
        : `${channel} 채널에 생일 등록 UI를 준비했어듀! 생일 축하도 이 채널로 보낼게.`,
      allowedMentions: { parse: [] }
    });
    return;
  }

  if (subcommand === '해제') {
    await updateGuildSettings(interaction.guildId, {
      birthday: { ...current, enabled: false }
    });
    await disableBirthdayPanel(interaction.guild, current);
    await interaction.editReply('생일 등록과 자동 축하를 중단했어. 저장된 생일은 나중에 다시 켤 수 있도록 유지할게!');
    return;
  }

  if (subcommand === '상태') {
    const count = await getBirthdayCount(interaction.guildId);
    await interaction.editReply({
      content: [
        `사용 여부: ${current.enabled ? '사용 중' : '사용 안 함'}`,
        `등록·축하 채널: ${current.channelId ? `<#${current.channelId}>` : '설정 안 됨'}`,
        `등록 인원: ${count.toLocaleString('ko-KR')}명`,
        '축하 시각: 한국 시간 오전 9시 이후'
      ].join('\n'),
      allowedMentions: { parse: [] }
    });
    return;
  }

  await interaction.editReply('지원하지 않는 생일 명령입니다.');
}

export function normalizeBirthdayAnnouncementTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return defaultBirthdayAnnouncementTime;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return defaultBirthdayAnnouncementTime;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getKoreanBirthdayDateTime(now = new Date()) {
  const parts = Object.fromEntries(
    koreanDateTimeFormatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

export function isBirthdayAnnouncementDue(now = new Date(), announcementTime = defaultBirthdayAnnouncementTime) {
  const koreanTime = getKoreanBirthdayDateTime(now);
  const [hour, minute] = normalizeBirthdayAnnouncementTime(announcementTime).split(':').map(Number);
  return koreanTime.hour * 60 + koreanTime.minute >= hour * 60 + minute;
}

export function buildBirthdayAnnouncementPayload(member, birthday) {
  const mention = `<@${member.id}>`;
  const displayName = member.displayName || member.user.globalName || member.user.username;
  const avatarUrl = typeof member.displayAvatarURL === 'function'
    ? member.displayAvatarURL({ extension: 'png', size: 256 })
    : member.user.displayAvatarURL?.({ extension: 'png', size: 256 });
  const embed = new EmbedBuilder()
    .setColor(0xff5fa2)
    .setTitle('🎉 듀아아아앙!! 생일 축하한다듀!! 🎂')
    .setDescription([
      `오늘의 주인공은 바로 **${displayName}**!`,
      '',
      '태어나 줘서 고맙고, 오늘 하루는 행복이 꼬리처럼 계속 따라다니길 바라듀! 🐾',
      '맛있는 것도 잔뜩 먹고 축하도 한가득 받자. 가나디가 제일 크게 축하할게! 🎁✨'
    ].join('\n'))
    .addFields({
      name: '🎈 가나디의 생일 도장',
      value: `**${formatBirthday(birthday.month, birthday.day)} · 오늘은 네가 주인공!**`
    })
    .setFooter({ text: '듀 가나디가 온 마음으로 생일 축하한다듀!' })
    .setTimestamp();
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return {
    content: `${mention} 듀아아아앙!! 생일 축하한다듀우우!! 🎊`,
    embeds: [embed],
    allowedMentions: { users: [member.id], roles: [] }
  };
}

export async function runBirthdaySchedulerTick(client, schedulerConfig = {}, now = new Date()) {
  if (!isBirthdayAnnouncementDue(now, schedulerConfig.announcementTime)) return [];

  const koreanTime = getKoreanBirthdayDateTime(now);
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const settings = await getGuildSettings(guild.id);
      const birthdaySettings = settings.birthday;
      if (!birthdaySettings?.enabled || !birthdaySettings.channelId) continue;

      const channel = await getBirthdayChannel(guild, birthdaySettings.channelId);
      if (!channel) throw new Error('설정된 생일 채널을 찾을 수 없습니다.');
      assertBirthdayChannelPermissions(guild, channel);

      const birthdays = await getBirthdaysForDate(guild.id, koreanTime.month, koreanTime.day);
      for (const birthday of birthdays) {
        const deliveryKey = `${guild.id}:${birthday.userId}:${koreanTime.date}`;
        if (birthday.lastAnnouncedDate === koreanTime.date || deliveredAnnouncements.has(deliveryKey)) {
          continue;
        }

        const member = await guild.members.fetch(birthday.userId).catch(() => null);
        if (!member || member.user.bot) continue;

        const message = await channel.send(buildBirthdayAnnouncementPayload(member, birthday));
        deliveredAnnouncements.add(deliveryKey);
        await markBirthdayAnnounced(guild.id, birthday.userId, koreanTime.date);
        results.push({ guildId: guild.id, userId: birthday.userId, messageId: message.id });
      }
    } catch (error) {
      console.error(`생일 축하 전송 실패 (${guild.id}): ${error.message}`);
    }
  }

  return results;
}

export function startBirthdayScheduler(client, schedulerConfig = {}) {
  let tickRunning = false;
  const tick = async () => {
    if (tickRunning || !client.isReady()) return;
    tickRunning = true;
    try {
      await runBirthdaySchedulerTick(client, schedulerConfig);
    } finally {
      tickRunning = false;
    }
  };

  tick().catch((error) => console.error(`생일 스케줄러 시작 실패: ${error.message}`));
  const timer = setInterval(() => {
    tick().catch((error) => console.error(`생일 스케줄러 실행 실패: ${error.message}`));
  }, schedulerConfig.intervalMs || 60_000);
  timer.unref();
  return timer;
}
