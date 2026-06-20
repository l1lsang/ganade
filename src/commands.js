import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';
import { buildEconomyCommands } from './economy-commands.js';

export const commandNames = {
  update: '업데이트',
  verify: '인증',
  inquiry: '문의',
  religion: '종교선택',
  settings: '설정',
  panel: '패널',
  verifyPanel: '인증패널',
  inquiryPanel: '문의패널',
  religionPanel: '종교패널',
  preferenceRolePanel: '취향역할패널',
  mbti: 'mbti',
  addEmoji: '이모지추가',
  attendance: '출석체크',
  warning: '경고',
  anonymous: '익명채팅',
  anonymousMessage: '익명',
  selfIntroduction: '자기소개',
  bibleMessage: '성경말씀',
  birthday: '생일',
  ganadi: '가나디',
  level: '레벨',
  levelRanking: '랭킹',
  clean: '청소',
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
      .setDescription('인증 역할, 티켓 관리자 역할, 인증 로그 채널을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addRoleOption((option) =>
        option
          .setName('인증역할')
          .setDescription('인증 통과 시 지급할 역할')
          .setRequired(false)
      )
      .addRoleOption((option) =>
        option
          .setName('관리자역할')
          .setDescription('인증·문의 티켓을 확인할 관리자 역할')
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
      .setDescription('인증·문의 티켓과 종교 역할 패널을 따로 보냅니다.')
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
      .setName(commandNames.inquiryPanel)
      .setDescription('문의 티켓 전용 UI 패널을 보냅니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName('채널')
          .setDescription('문의 패널을 보낼 채널')
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
      .setName(commandNames.preferenceRolePanel)
      .setDescription('NSFW·멘헤라 역할을 선택할 수 있는 UI 패널을 보냅니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName('채널')
          .setDescription('취향 역할 패널을 보낼 채널')
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.mbti)
      .setDescription('MBTI 역할 패널을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('설정')
          .setDescription('MBTI 토글 패널을 보낼 채널을 지정합니다.')
          .addChannelOption((option) =>
            option
              .setName('채널')
              .setDescription('MBTI 패널을 보낼 채널')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText)
          )
      ),
    new SlashCommandBuilder()
      .setName(commandNames.addEmoji)
      .setDescription('외부 이모지나 이미지를 서버 이모지로 추가합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
      .addStringOption((option) =>
        option
          .setName('이모지')
          .setDescription('외부 이모지 <:name:id>, <a:name:id> 또는 이미지 URL')
          .setRequired(false)
          .setMaxLength(300)
      )
      .addAttachmentOption((option) =>
        option
          .setName('이미지')
          .setDescription('서버 이모지로 추가할 이미지 파일')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('이름')
          .setDescription('새 이모지 이름, 영문/숫자/밑줄만 가능')
          .setRequired(false)
          .setMinLength(2)
          .setMaxLength(32)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.attendance)
      .setDescription('출석체크를 하고 출석 랭킹을 확인합니다.')
      .addStringOption((option) =>
        option
          .setName('작업')
          .setDescription('실행할 작업, 비워두면 바로 출석합니다.')
          .setRequired(false)
          .addChoices(
            { name: '출석하기', value: 'check' },
            { name: '출석 랭킹', value: 'ranking' },
            { name: '출석 초기화', value: 'reset' }
          )
      ),
    new SlashCommandBuilder()
      .setName(commandNames.warning)
      .setDescription('경고를 지급, 회수, 조회하고 자동 밴 기준을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('지급')
          .setDescription('유저에게 경고를 1회 지급합니다.')
          .addUserOption((option) =>
            option
              .setName('유저')
              .setDescription('경고를 지급할 유저')
              .setRequired(true)
          )
          .addStringOption((option) =>
            option
              .setName('사유')
              .setDescription('경고 사유')
              .setRequired(false)
              .setMaxLength(300)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('회수')
          .setDescription('유저의 경고를 회수합니다.')
          .addUserOption((option) =>
            option
              .setName('유저')
              .setDescription('경고를 회수할 유저')
              .setRequired(true)
          )
          .addIntegerOption((option) =>
            option
              .setName('개수')
              .setDescription('회수할 경고 수, 기본값은 1회')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(50)
          )
          .addStringOption((option) =>
            option
              .setName('사유')
              .setDescription('회수 사유')
              .setRequired(false)
              .setMaxLength(300)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('기록')
          .setDescription('경고 전체 기록 또는 특정 유저 기록을 파일로 확인합니다.')
          .addUserOption((option) =>
            option
              .setName('유저')
              .setDescription('특정 유저만 확인하려면 선택하세요.')
              .setRequired(false)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('설정')
          .setDescription('경고 자동 영구 밴 기준 횟수를 설정합니다.')
          .addIntegerOption((option) =>
            option
              .setName('자동밴횟수')
              .setDescription('이 횟수 이상 경고가 쌓이면 영구 밴합니다.')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(100)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('로그채널')
          .setDescription('경고 지급·회수 로그를 보낼 채널을 설정합니다.')
          .addChannelOption((option) =>
            option
              .setName('채널')
              .setDescription('경고 처리 내역을 기록할 채널')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('로그해제')
          .setDescription('경고 로그 채널 설정을 해제합니다.')
      ),
    new SlashCommandBuilder()
      .setName(commandNames.anonymous)
      .setDescription('익명채팅방을 설정하거나 해제합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('설정')
          .setDescription('/익명 명령어를 사용할 채널을 지정합니다.')
          .addChannelOption((option) =>
            option
              .setName('채널')
              .setDescription('익명채팅방으로 사용할 텍스트 채널')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('해제')
          .setDescription('익명채팅방 설정을 해제합니다.')
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('상태')
          .setDescription('현재 익명채팅방 설정을 확인합니다.')
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('추적')
          .setDescription('익명 작성자 코드를 실제 유저와 연결해 확인합니다.')
          .addStringOption((option) =>
            option
              .setName('코드')
              .setDescription('예: 10.12.34.56 또는 ㅇㅇ(10.12.34.56)')
              .setRequired(true)
              .setMaxLength(40)
          )
      ),
    new SlashCommandBuilder()
      .setName(commandNames.anonymousMessage)
      .setDescription('지정된 익명채팅방에서 익명 메시지를 보냅니다.')
      .addStringOption((option) =>
        option
          .setName('전달내용')
          .setDescription('익명으로 보낼 내용')
          .setRequired(true)
          .setMaxLength(1800)
      )
      .addAttachmentOption((option) =>
        option
          .setName('첨부파일')
          .setDescription('익명 메시지에 함께 보낼 파일')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.selfIntroduction)
      .setDescription('자기소개 예시 임베드를 항상 아래에 표시할 채널을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName('채널')
          .setDescription('자기소개 예시 임베드를 표시할 채널')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.bibleMessage)
      .setDescription('가나디의 세 번 안부와 하루 한 번 말씀 채널을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('설정')
          .setDescription('@everyone 가나디 안부를 보낼 채널을 설정합니다.')
          .addChannelOption((option) =>
            option
              .setName('채널')
              .setDescription('예약 안부와 하루 말씀을 보낼 채널')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('해제')
          .setDescription('예약 가나디 안부 전송을 중단합니다.')
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('상태')
          .setDescription('현재 안부 채널과 한국 시간 예약을 확인합니다.')
      ),
    new SlashCommandBuilder()
      .setName(commandNames.birthday)
      .setDescription('생일 등록 UI와 자동 축하 기능을 설정합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((subcommand) =>
        subcommand
          .setName('설정')
          .setDescription('생일 등록 채널과 버튼 UI를 준비합니다.')
          .addChannelOption((option) =>
            option
              .setName('채널')
              .setDescription('기존 채널을 사용하려면 선택, 비워두면 새 채널 생성')
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText)
          )
          .addChannelOption((option) =>
            option
              .setName('축하채널')
              .setDescription('생일 축하 메시지를 보낼 채널, 비우면 등록 채널 사용')
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('해제')
          .setDescription('생일 등록과 자동 축하를 중단합니다.')
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('상태')
          .setDescription('생일 채널과 등록 인원을 확인합니다.')
      ),
    new SlashCommandBuilder()
      .setName(commandNames.ganadi)
      .setDescription('가나디와의 관계를 확인합니다.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('호감도')
          .setDescription('나 또는 다른 멤버와 가나디의 호감도를 확인합니다.')
          .addUserOption((option) =>
            option
              .setName('유저')
              .setDescription('호감도를 확인할 멤버, 비워두면 본인')
              .setRequired(false)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('사진')
          .setDescription('가나디 사진 중 한 장을 무작위로 보여 줍니다.')
      ),
    new SlashCommandBuilder()
      .setName(commandNames.level)
      .setDescription('나 또는 다른 유저의 채팅·음성 활동 레벨을 확인합니다.')
      .addUserOption((option) =>
        option
          .setName('유저')
          .setDescription('레벨을 확인할 유저, 비워두면 본인')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.levelRanking)
      .setDescription('종합·채팅·음성 활동 랭킹을 확인합니다.')
      .addStringOption((option) =>
        option
          .setName('종류')
          .setDescription('확인할 랭킹 종류')
          .setRequired(false)
          .addChoices(
            { name: '종합 랭킹', value: 'overall' },
            { name: '채팅 랭킹', value: 'chat' },
            { name: '음성방 랭킹', value: 'voice' },
            { name: '듀코인 부자 랭킹', value: 'economy' }
          )
      ),
    new SlashCommandBuilder()
      .setName(commandNames.clean)
      .setDescription('현재 채널의 최근 메시지를 청소합니다.')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((option) =>
        option
          .setName('개수')
          .setDescription('삭제할 최근 메시지 수')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100)
      )
      .addUserOption((option) =>
        option
          .setName('유저')
          .setDescription('특정 유저 메시지만 삭제하려면 선택하세요.')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName(commandNames.ping)
      .setDescription('봇 응답 상태를 확인합니다.'),
    new SlashCommandBuilder()
      .setName(commandNames.inquiry)
      .setDescription('관리자와 이야기할 수 있는 문의 티켓을 생성합니다.'),
    new SlashCommandBuilder()
      .setName(commandNames.verify)
      .setDescription('수동 인증 티켓을 생성합니다.'),
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
      ),
    ...buildEconomyCommands()
  ].map((command) => command.toJSON());
}
