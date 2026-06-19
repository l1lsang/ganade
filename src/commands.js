import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';

export const commandNames = {
  update: '업데이트',
  verify: '인증',
  religion: '종교선택',
  settings: '설정',
  panel: '패널',
  verifyPanel: '인증패널',
  religionPanel: '종교패널',
  ping: '핑'
};

export function buildUpdateCommand() {
  return new SlashCommandBuilder()
    .setName(commandNames.update)
    .setDescription('봇 슬래시 명령어를 동기화합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('범위')
        .setDescription('명령어를 동기화할 범위')
        .setRequired(false)
        .addChoices(
          { name: '현재 서버', value: 'guild' },
          { name: '전역', value: 'global' }
        )
    );
}

export function buildCommands() {
  const religionChoices = config.religionChoices.map((name) => ({ name, value: name }));

  return [
    buildUpdateCommand(),
    new SlashCommandBuilder()
      .setName(commandNames.settings)
      .setDescription('인증 역할과 인증 로그 채널을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addRoleOption((option) =>
        option
          .setName('인증역할')
          .setDescription('인증 통과 시 지급할 역할')
          .setRequired(false)
      )
      .addChannelOption((option) =>
        option
          .setName('로그채널')
          .setDescription('인증 결과 로그를 보낼 채널')
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.panel)
      .setDescription('인증 패널과 종교 역할 패널을 따로 보냅니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName('채널')
          .setDescription('패널을 보낼 채널')
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.verifyPanel)
      .setDescription('인증 전용 UI 패널을 보냅니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName('채널')
          .setDescription('인증 패널을 보낼 채널')
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.religionPanel)
      .setDescription('종교 역할 선택 전용 UI 패널을 보냅니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName('채널')
          .setDescription('종교 역할 패널을 보낼 채널')
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.ping)
      .setDescription('봇 응답 상태를 확인합니다.'),
    new SlashCommandBuilder()
      .setName(commandNames.verify)
      .setDescription('주민등록증 또는 고등학생 학생증과 인증 문구 종이를 제출합니다.')
      .addAttachmentOption((option) =>
        option
          .setName('사진')
          .setDescription('주민등록증/고등학생 학생증과 인증 문구 종이가 함께 보이는 사진')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.religion)
      .setDescription('자신의 종교 역할을 선택하거나 직접 입력합니다.')
      .addStringOption((option) =>
        option
          .setName('종교')
          .setDescription('목록에서 종교를 선택합니다.')
          .setRequired(false)
          .addChoices(...religionChoices)
      )
      .addStringOption((option) =>
        option
          .setName('직접입력')
          .setDescription('목록에 없는 종교를 입력합니다.')
          .setRequired(false)
          .setMaxLength(30)
      )
  ].map((command) => command.toJSON());
}
