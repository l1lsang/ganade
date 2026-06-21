import { EmbedBuilder } from 'discord.js';

export const defaultWelcomeMessage =
  '환영한다듀...!!!!';

export const joinDirectMessageTitle = '환영한다듀... 나는 가나디 봇이야아앙듀..';

export function buildJoinDirectMessagePayload({ guildName, guildIconUrl = null }) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(joinDirectMessageTitle)
    .setDescription([
      `**${guildName}** 서버에 온 걸 환영해!`,
      '',
      '**서버에서 할 것**',
      '1. 종교 카테고리에서 종교 역할 받기',
      '2. 자기소개 하기'
    ].join('\n'))
    .setFooter({ text: `${guildName}에서 기다리고 있을게듀!` })
    .setTimestamp();

  if (guildIconUrl) {
    embed.setThumbnail(guildIconUrl);
  }

  return {
    embeds: [embed],
    allowedMentions: { parse: [], users: [], roles: [] }
  };
}

export function buildWelcomePayload({
  guildName,
  targetUser,
  targetDisplayName,
  welcomerName,
  message
}) {
  const welcomeMessage = message?.trim() || defaultWelcomeMessage;
  const displayName = targetDisplayName || targetUser.globalName || targetUser.username;

  const embed = new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setTitle(`🎉 ${displayName}님, 환영해요!`)
    .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
    .setDescription([
      `<@${targetUser.id}>님, **${guildName}**에 오신 걸 진심으로 환영해요!`,
      '',
      welcomeMessage
    ].join('\n'))
    .setFooter({ text: `${welcomerName}님이 보내는 환영 인사` })
    .setTimestamp();

  return {
    content: `<@${targetUser.id}>`,
    embeds: [embed],
    allowedMentions: {
      parse: [],
      users: [targetUser.id],
      roles: [],
      repliedUser: false
    }
  };
}
