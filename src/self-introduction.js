import { ChannelType, EmbedBuilder, PermissionsBitField } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from './settings.js';

export const defaultSelfIntroduction = Object.freeze({
  enabled: true,
  title: '👋 자기소개를 작성해 주세요!',
  description: [
    '아래 예시를 참고해 자유롭게 자기소개를 작성해 주세요.',
    '',
    '**이름/닉네임:**',
    '**나이:**',
    '**관심사:**',
    '**한마디:**'
  ].join('\n'),
  footer: '새 메시지가 올라오면 이 안내가 다시 표시됩니다.',
  color: '#5865f2'
});

const refreshQueues = new Map();

function normalizeText(value, fallback) {
  return String(value ?? fallback).trim();
}

export function normalizeSelfIntroductionSettings(body = {}, current = {}) {
  const enabled = body.enabled !== false;
  const channelId = normalizeText(body.channelId, current.channelId || '');
  const title = normalizeText(body.title, current.title ?? defaultSelfIntroduction.title);
  const description = normalizeText(
    body.description,
    current.description ?? defaultSelfIntroduction.description
  );
  const footer = normalizeText(body.footer, current.footer ?? defaultSelfIntroduction.footer);
  const color = normalizeText(body.color, current.color ?? defaultSelfIntroduction.color);

  if (enabled && !channelId) {
    throw new Error('자기소개 채널을 선택해 주세요.');
  }

  if (!title && !description) {
    throw new Error('임베드 제목이나 내용 중 하나는 입력해 주세요.');
  }

  if (title.length > 256) {
    throw new Error('자기소개 임베드 제목은 256자 이하로 입력해 주세요.');
  }

  if (description.length > 4096) {
    throw new Error('자기소개 예시 내용은 4096자 이하로 입력해 주세요.');
  }

  if (footer.length > 2048) {
    throw new Error('자기소개 임베드 하단 문구는 2048자 이하로 입력해 주세요.');
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error('자기소개 임베드 색상은 #5865f2 같은 HEX 색상이어야 합니다.');
  }

  return {
    enabled,
    channelId: channelId || null,
    title,
    description,
    footer,
    color: color.toLowerCase(),
    messageId: current.messageId || null
  };
}

export function buildSelfIntroductionEmbed(settings) {
  const embed = new EmbedBuilder().setColor(Number.parseInt(settings.color.slice(1), 16));

  if (settings.title) embed.setTitle(settings.title);
  if (settings.description) embed.setDescription(settings.description);
  if (settings.footer) embed.setFooter({ text: settings.footer });

  return embed;
}

async function getTextChannel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('선택한 자기소개 채널을 찾을 수 없습니다.');
  }

  return channel;
}

function assertChannelPermissions(guild, channel) {
  const permissions = channel.permissionsFor(guild.members.me);
  const requiredPermissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks
  ];

  if (!permissions?.has(requiredPermissions)) {
    throw new Error(`봇이 ${channel} 채널에서 채널 보기, 메시지 보내기, 링크 첨부 권한을 가져야 합니다.`);
  }
}

async function deletePreviousMessage(guild, settings, exceptMessageId = null) {
  if (!settings?.channelId || !settings.messageId || settings.messageId === exceptMessageId) return;

  const channel = guild.channels.cache.get(settings.channelId)
    || await guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.messages) return;

  await channel.messages.delete(settings.messageId).catch((error) => {
    if (error?.code !== 10008) {
      console.warn(`이전 자기소개 안내 삭제 실패 (${guild.id}/${settings.channelId}): ${error.message}`);
    }
  });
}

async function saveDisabledSettings(guild, next, previous) {
  await deletePreviousMessage(guild, previous);
  return updateGuildSettings(guild.id, {
    selfIntroduction: {
      ...next,
      messageId: null
    }
  });
}

async function publishSelfIntroduction(guild, next, previous) {
  const channel = await getTextChannel(guild, next.channelId);
  assertChannelPermissions(guild, channel);

  const sentMessage = await channel.send({
    embeds: [buildSelfIntroductionEmbed(next)],
    allowedMentions: { parse: [] }
  });

  await deletePreviousMessage(guild, previous, sentMessage.id);

  const saved = await updateGuildSettings(guild.id, {
    selfIntroduction: {
      ...next,
      messageId: sentMessage.id
    }
  });

  return {
    settings: saved.selfIntroduction,
    message: sentMessage
  };
}

export async function configureSelfIntroduction(guild, changes = {}) {
  const guildSettings = await getGuildSettings(guild.id);
  const previous = guildSettings.selfIntroduction || {};
  const next = normalizeSelfIntroductionSettings(changes, previous);

  if (!next.enabled) {
    const saved = await saveDisabledSettings(guild, next, previous);
    return { settings: saved.selfIntroduction, message: null };
  }

  return publishSelfIntroduction(guild, next, previous);
}

async function refreshSelfIntroduction(message) {
  const guildSettings = await getGuildSettings(message.guildId);
  const current = guildSettings.selfIntroduction;

  if (!current?.enabled || current.channelId !== message.channelId) return null;

  const next = normalizeSelfIntroductionSettings(current, current);
  return publishSelfIntroduction(message.guild, next, current);
}

export function refreshSelfIntroductionAfterMessage(message) {
  const queueKey = `${message.guildId}:${message.channelId}`;
  const previousQueue = refreshQueues.get(queueKey) || Promise.resolve();
  const nextQueue = previousQueue
    .catch(() => null)
    .then(() => refreshSelfIntroduction(message));

  refreshQueues.set(queueKey, nextQueue);
  const cleanQueue = () => {
    if (refreshQueues.get(queueKey) === nextQueue) {
      refreshQueues.delete(queueKey);
    }
  };
  nextQueue.then(cleanQueue, cleanQueue);

  return nextQueue;
}
