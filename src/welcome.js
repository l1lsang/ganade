import { EmbedBuilder } from 'discord.js';

export const defaultWelcomeMessage =
  '환영한다듀...!!!!';

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
