import { createServer } from 'node:http';
import { ChannelType, PermissionsBitField } from 'discord.js';
import { config } from './config.js';
import { getLevelRanking, getLevelRules, getLevelSummary } from './level-system.js';
import {
  configureSelfIntroduction,
  defaultSelfIntroduction
} from './self-introduction.js';
import { getGuildSettings, updateGuildSettings } from './settings.js';

function readEnabled() {
  const value = process.env.ENABLE_HEALTH_SERVER;
  if (!value) return true;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function readPort() {
  const rawPort = process.env.PORT || process.env.HEALTH_PORT || '10000';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid health server port: ${rawPort}`);
  }

  return port;
}

function buildHealthBody(client) {
  return JSON.stringify({
    ok: true,
    service: 'discord-verification-bot',
    discordReady: client.isReady(),
    uptimeSeconds: Math.round(process.uptime())
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8'
  });
  response.end(html);
}

function isAuthorized(request) {
  if (!config.webAdminToken) return false;

  const headerToken = request.headers['x-admin-token'];
  const authHeader = request.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  return headerToken === config.webAdminToken || bearerToken === config.webAdminToken;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.on('data', (chunk) => {
      body += chunk;

      if (body.length > 64 * 1024) {
        request.destroy();
        reject(new Error('Request body is too large.'));
      }
    });

    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body is not valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

function getGuildIconUrl(guild) {
  return guild.iconURL({ extension: 'png', size: 128 });
}

function serializeGuild(guild) {
  return {
    id: guild.id,
    name: guild.name,
    iconUrl: getGuildIconUrl(guild)
  };
}

async function serializeChannels(guild) {
  await guild.channels.fetch();

  return [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildText)
    .sort((a, b) => a.rawPosition - b.rawPosition || a.name.localeCompare(b.name, 'ko-KR'))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      parentId: channel.parentId || null,
      parentName: channel.parent?.name || null
    }));
}

function normalizeMemberLogSettings(body, defaults) {
  const message = String(body.message || '').trim();
  const embedTitle = String(body.embedTitle || defaults.embedTitle).trim();
  const embedColor = String(body.embedColor || defaults.embedColor).trim();
  const emojiText = String(body.emojiText || '').trim();

  if (!body.channelId) {
    throw new Error(`${defaults.label} 채널을 선택해 주세요.`);
  }

  if (message.length > 1800) {
    throw new Error(`${defaults.label} 메시지는 1800자 이하로 입력해 주세요.`);
  }

  if (embedTitle.length > 200) {
    throw new Error('임베드 제목은 200자 이하로 입력해 주세요.');
  }

  if (emojiText.length > 300) {
    throw new Error('추가 이모지/문구는 300자 이하로 입력해 주세요.');
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(embedColor)) {
    throw new Error('임베드 색상은 #57f287 같은 HEX 색상이어야 합니다.');
  }

  return {
    enabled: body.enabled !== false,
    channelId: String(body.channelId),
    message,
    embedTitle,
    embedColor,
    emojiText,
    useEmbed: body.useEmbed !== false,
    showProfileImage: body.showProfileImage !== false,
    mentionUser: body.mentionUser === true,
    showInviter: body.showInviter !== false
  };
}

function normalizeWelcomeSettings(body) {
  return normalizeMemberLogSettings(body, {
    label: '환영',
    embedTitle: '{memberCount}번째 멤버가 입장했어요',
    embedColor: '#3498db'
  });
}

function normalizeLeaveSettings(body) {
  return normalizeMemberLogSettings(body, {
    label: '퇴장',
    embedTitle: '{user} 님이 서버를 떠났어요',
    embedColor: '#ed4245'
  });
}

async function handleGuildsApi(client, response) {
  const guilds = [...client.guilds.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'))
    .map(serializeGuild);

  sendJson(response, 200, { ok: true, guilds });
}

async function handleGuildDetailApi(client, guildId, response) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    sendJson(response, 404, { ok: false, error: 'guild_not_found' });
    return;
  }

  const [channels, settings] = await Promise.all([
    serializeChannels(guild),
    getGuildSettings(guild.id)
  ]);

  sendJson(response, 200, {
    ok: true,
    guild: serializeGuild(guild),
    channels,
    welcome: settings.welcome || null,
    leave: settings.leave || null,
    selfIntroduction: settings.selfIntroduction || null,
    selfIntroductionDefaults: defaultSelfIntroduction
  });
}

function serializeLevelRankingEntry(guild, entry) {
  const member = guild.members.cache.get(entry.userId);
  const user = member?.user || guild.client.users.cache.get(entry.userId);

  return {
    ...entry,
    username: user?.username || entry.username || '알 수 없는 유저',
    displayName: member?.displayName || entry.displayName || user?.globalName || user?.username || '알 수 없는 유저',
    avatarUrl: user?.displayAvatarURL({ extension: 'png', size: 128 }) || entry.avatarUrl || null
  };
}

async function handleLevelRankingsApi(client, guildId, response, url) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    sendJson(response, 404, { ok: false, error: 'guild_not_found' });
    return;
  }

  const type = url.searchParams.get('type') || 'overall';
  const rawLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(100, Math.floor(rawLimit))) : 50;
  const [ranking, summary] = await Promise.all([
    getLevelRanking(guildId, type, limit),
    getLevelSummary(guildId)
  ]);

  sendJson(response, 200, {
    ok: true,
    guild: serializeGuild(guild),
    type,
    ranking: ranking.map((entry) => serializeLevelRankingEntry(guild, entry)),
    summary,
    rules: getLevelRules()
  });
}

async function handleWelcomeSaveApi(client, guildId, request, response) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    sendJson(response, 404, { ok: false, error: 'guild_not_found' });
    return;
  }

  const body = await readJsonBody(request);
  const welcome = normalizeWelcomeSettings(body);
  const channel = await guild.channels.fetch(welcome.channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('선택한 환영 채널을 찾을 수 없습니다.');
  }

  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions.has(PermissionsBitField.Flags.SendMessages)) {
    throw new Error('봇이 선택한 채널에 메시지를 보낼 권한이 없습니다.');
  }

  const settings = await updateGuildSettings(guild.id, { welcome });
  sendJson(response, 200, { ok: true, welcome: settings.welcome });
}

async function handleLeaveSaveApi(client, guildId, request, response) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    sendJson(response, 404, { ok: false, error: 'guild_not_found' });
    return;
  }

  const body = await readJsonBody(request);
  const leave = normalizeLeaveSettings(body);
  const channel = await guild.channels.fetch(leave.channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('선택한 퇴장 로그 채널을 찾을 수 없습니다.');
  }

  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(PermissionsBitField.Flags.ViewChannel) || !permissions.has(PermissionsBitField.Flags.SendMessages)) {
    throw new Error('봇이 선택한 채널에 메시지를 보낼 권한이 없습니다.');
  }

  const settings = await updateGuildSettings(guild.id, { leave });
  sendJson(response, 200, { ok: true, leave: settings.leave });
}

async function handleSelfIntroductionSaveApi(client, guildId, request, response) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    sendJson(response, 404, { ok: false, error: 'guild_not_found' });
    return;
  }

  const body = await readJsonBody(request);
  const result = await configureSelfIntroduction(guild, body);
  sendJson(response, 200, {
    ok: true,
    selfIntroduction: result.settings
  });
}

async function handleApiRequest(client, request, response, url) {
  if (!isAuthorized(request)) {
    sendJson(response, config.webAdminToken ? 401 : 503, {
      ok: false,
      error: config.webAdminToken ? 'unauthorized' : 'web_admin_token_not_configured'
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/guilds') {
    await handleGuildsApi(client, response);
    return;
  }

  const detailMatch = url.pathname.match(/^\/api\/guilds\/(\d+)$/);
  if (request.method === 'GET' && detailMatch) {
    await handleGuildDetailApi(client, detailMatch[1], response);
    return;
  }

  const rankingMatch = url.pathname.match(/^\/api\/guilds\/(\d+)\/rankings$/);
  if (request.method === 'GET' && rankingMatch) {
    await handleLevelRankingsApi(client, rankingMatch[1], response, url);
    return;
  }

  const welcomeMatch = url.pathname.match(/^\/api\/guilds\/(\d+)\/welcome$/);
  if (request.method === 'POST' && welcomeMatch) {
    await handleWelcomeSaveApi(client, welcomeMatch[1], request, response);
    return;
  }

  const leaveMatch = url.pathname.match(/^\/api\/guilds\/(\d+)\/leave$/);
  if (request.method === 'POST' && leaveMatch) {
    await handleLeaveSaveApi(client, leaveMatch[1], request, response);
    return;
  }

  const selfIntroductionMatch = url.pathname.match(/^\/api\/guilds\/(\d+)\/self-introduction$/);
  if (request.method === 'POST' && selfIntroductionMatch) {
    await handleSelfIntroductionSaveApi(client, selfIntroductionMatch[1], request, response);
    return;
  }

  sendJson(response, 404, { ok: false, error: 'not_found' });
}

export function buildAdminHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>봇 웹 설정</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --line: #d9e2ef;
      --accent: #5865f2;
      --accent-dark: #4752c4;
      --ok: #168a4a;
      --danger: #c2410c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    }
    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 16px; font-size: 18px; letter-spacing: 0; }
    p { margin: 0; color: var(--muted); line-height: 1.55; }
    .grid {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 16px;
      margin-top: 24px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      box-shadow: 0 10px 24px rgba(31, 41, 55, 0.06);
    }
    label {
      display: block;
      margin: 14px 0 6px;
      font-size: 13px;
      font-weight: 700;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 11px 12px;
      color: var(--text);
      background: #fff;
      font: inherit;
    }
    textarea { min-height: 96px; resize: vertical; }
    input[type="checkbox"] { width: auto; margin-right: 8px; }
    input[type="color"] { height: 42px; padding: 4px; }
    button {
      border: 0;
      border-radius: 6px;
      padding: 11px 14px;
      background: var(--accent);
      color: #fff;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: var(--accent-dark); }
    button.secondary { background: #e5e7eb; color: var(--text); }
    button.secondary:hover { background: #d1d5db; }
    .row { display: flex; gap: 10px; align-items: center; }
    .row > * { flex: 1; }
    .check-row {
      display: flex;
      align-items: center;
      margin-top: 12px;
      color: var(--text);
    }
    .server-list {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }
    .server {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      background: #fff;
      color: var(--text);
      text-align: left;
    }
    .server.active { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.14); }
    .server img {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #e5e7eb;
    }
    .status {
      min-height: 22px;
      margin-top: 14px;
      font-size: 13px;
      color: var(--muted);
    }
    .status.ok { color: var(--ok); }
    .status.error { color: var(--danger); }
    .split {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .subpanel {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      background: #fbfdff;
    }
    .subpanel + .subpanel { margin-top: 16px; }
    .preview {
      margin-top: 18px;
      border-left: 4px solid var(--accent);
      border-radius: 6px;
      background: #f8fafc;
      padding: 14px;
    }
    .preview-head {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 10px;
    }
    .preview-head img {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: #e5e7eb;
    }
    .preview-title { font-weight: 800; }
    .preview-message { white-space: pre-wrap; }
    .preview-footer { margin-top: 12px; font-size: 12px; }
    .ranking-panel { margin-top: 16px; }
    .ranking-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }
    .ranking-head button { flex: 0 0 auto; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin: 18px 0;
    }
    .summary-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #f8fafc;
    }
    .summary-card span {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .summary-card strong { font-size: 20px; }
    .ranking-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 4px 0 14px;
    }
    .ranking-tab { background: #e5e7eb; color: var(--text); }
    .ranking-tab:hover { background: #d1d5db; }
    .ranking-tab.active { background: var(--accent); color: #fff; }
    .table-wrap { overflow-x: auto; }
    .ranking-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 680px;
    }
    .ranking-table th,
    .ranking-table td {
      padding: 12px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
    }
    .ranking-table th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    .ranking-table tbody tr:hover { background: #f8fafc; }
    .rank-number { width: 72px; font-weight: 800; }
    .rank-member { display: flex; align-items: center; gap: 10px; min-width: 200px; }
    .rank-member img {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #e5e7eb;
    }
    .rank-member strong,
    .rank-member small { display: block; }
    .rank-member small { margin-top: 2px; color: var(--muted); }
    .empty-ranking { padding: 28px !important; text-align: center !important; color: var(--muted); }
    .hidden { display: none; }
    @media (max-width: 840px) {
      main { width: min(100% - 20px, 640px); padding-top: 20px; }
      .grid { grid-template-columns: 1fr; }
      .split { grid-template-columns: 1fr; }
      .summary-grid { grid-template-columns: 1fr 1fr; }
      .ranking-head { align-items: stretch; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main>
    <h1>봇 웹 설정</h1>
    <p>서버를 고른 뒤 입장/퇴장 로그를 설정하고, 채팅·음성방 활동 레벨과 랭킹을 확인하세요.</p>

    <section class="grid">
      <aside class="panel">
        <h2>접속</h2>
        <label for="token">관리 토큰</label>
        <div class="row">
          <input id="token" type="password" placeholder="WEB_ADMIN_TOKEN" />
          <button id="saveToken" class="secondary" type="button">저장</button>
        </div>
        <button id="loadGuilds" type="button" style="width:100%; margin-top:12px;">서버 불러오기</button>
        <div id="serverList" class="server-list"></div>
        <div id="leftStatus" class="status"></div>
      </aside>

      <section class="panel">
        <h2>입장/퇴장 로그</h2>
        <p id="selectedGuild">서버를 먼저 선택하세요.</p>

        <div id="logForms" class="hidden">
          <div class="split">
            <form id="welcomeForm" class="subpanel">
              <h2>입장 로그</h2>
              <label for="welcomeChannel">입장 로그 채널</label>
              <select id="welcomeChannel" required></select>

              <label class="check-row"><input id="welcomeEnabled" type="checkbox" checked /> 입장 로그 사용</label>
              <label class="check-row"><input id="welcomeUseEmbed" type="checkbox" checked /> 임베드로 보내기</label>
              <label class="check-row"><input id="welcomeShowProfileImage" type="checkbox" checked /> 가입자 프로필 이미지 표시</label>
              <label class="check-row"><input id="welcomeMentionUser" type="checkbox" /> 가입자 멘션 포함</label>
              <label class="check-row"><input id="welcomeShowInviter" type="checkbox" checked /> 초대자 표시</label>

              <label for="welcomeEmbedTitle">임베드 제목</label>
              <input id="welcomeEmbedTitle" maxlength="200" />

              <label for="welcomeMessage">추가 메시지</label>
              <textarea id="welcomeMessage" maxlength="1800"></textarea>

              <label for="welcomeEmojiText">외부 이모지/상단 문구</label>
              <input id="welcomeEmojiText" maxlength="300" placeholder="<:welcome:123456789012345678>" />

              <p>가입자의 Discord 프로필 배너가 임베드 하단에 자동 표시됩니다.</p>

              <label for="welcomeEmbedColor">임베드 색상</label>
              <input id="welcomeEmbedColor" type="color" value="#3498db" />

              <div class="row" style="margin-top:16px;">
                <button type="submit">입장 로그 저장</button>
                <button id="welcomePreviewButton" class="secondary" type="button">미리보기</button>
              </div>
            </form>

            <form id="leaveForm" class="subpanel">
              <h2>퇴장 로그</h2>
              <label for="leaveChannel">퇴장 로그 채널</label>
              <select id="leaveChannel" required></select>

              <label class="check-row"><input id="leaveEnabled" type="checkbox" checked /> 퇴장 로그 사용</label>
              <label class="check-row"><input id="leaveUseEmbed" type="checkbox" checked /> 임베드로 보내기</label>
              <label class="check-row"><input id="leaveShowProfileImage" type="checkbox" checked /> 퇴장자 프로필 이미지 표시</label>
              <label class="check-row"><input id="leaveMentionUser" type="checkbox" /> 퇴장자 멘션 포함</label>

              <label for="leaveEmbedTitle">임베드 제목</label>
              <input id="leaveEmbedTitle" maxlength="200" />

              <label for="leaveMessage">추가 메시지</label>
              <textarea id="leaveMessage" maxlength="1800"></textarea>

              <label for="leaveEmojiText">외부 이모지/상단 문구</label>
              <input id="leaveEmojiText" maxlength="300" placeholder="<:bye:123456789012345678>" />

              <p>퇴장자의 Discord 프로필 배너가 임베드 하단에 자동 표시됩니다.</p>

              <label for="leaveEmbedColor">임베드 색상</label>
              <input id="leaveEmbedColor" type="color" value="#ed4245" />

              <div class="row" style="margin-top:16px;">
                <button type="submit">퇴장 로그 저장</button>
                <button id="leavePreviewButton" class="secondary" type="button">미리보기</button>
              </div>
            </form>
          </div>
        </div>

        <div id="preview" class="preview hidden">
          <div class="preview-head">
            <img id="previewAvatar" alt="" />
            <div>
              <div id="previewTitle" class="preview-title"></div>
              <p id="previewGuild"></p>
            </div>
          </div>
          <p id="previewMessage"></p>
        </div>
        <div id="rightStatus" class="status"></div>
      </section>
    </section>

    <section id="selfIntroductionPanel" class="panel ranking-panel hidden">
      <div class="ranking-head">
        <div>
          <h2>자기소개 예시 임베드</h2>
          <p>자기소개 채널의 안내 문구를 꾸밉니다. 저장하면 안내가 즉시 새 내용으로 다시 게시됩니다.</p>
        </div>
      </div>

      <div class="split" style="margin-top:18px;">
        <form id="selfIntroductionForm" class="subpanel">
          <label for="selfIntroductionChannel">자기소개 채널</label>
          <select id="selfIntroductionChannel" required></select>

          <label class="check-row"><input id="selfIntroductionEnabled" type="checkbox" checked /> 반복 안내 사용</label>

          <label for="selfIntroductionTitle">임베드 제목</label>
          <input id="selfIntroductionTitle" maxlength="256" />

          <label for="selfIntroductionDescription">자기소개 예시 내용</label>
          <textarea id="selfIntroductionDescription" maxlength="4096" style="min-height:190px;"></textarea>

          <label for="selfIntroductionFooter">하단 안내 문구</label>
          <input id="selfIntroductionFooter" maxlength="2048" />

          <label for="selfIntroductionColor">임베드 색상</label>
          <input id="selfIntroductionColor" type="color" value="#5865f2" />

          <div class="row" style="margin-top:16px;">
            <button type="submit">자기소개 설정 저장</button>
            <button id="selfIntroductionPreviewButton" class="secondary" type="button">미리보기</button>
          </div>
        </form>

        <div class="subpanel">
          <h2>Discord 미리보기</h2>
          <div id="selfIntroductionPreview" class="preview">
            <div id="selfIntroductionPreviewTitle" class="preview-title"></div>
            <p id="selfIntroductionPreviewDescription" class="preview-message"></p>
            <p id="selfIntroductionPreviewFooter" class="preview-footer"></p>
          </div>
          <p style="margin-top:12px;">멤버가 이 채널에 메시지를 올릴 때마다 기존 안내는 지워지고 이 임베드가 맨 아래에 다시 표시됩니다.</p>
        </div>
      </div>
      <div id="selfIntroductionStatus" class="status"></div>
    </section>

    <section id="rankingPanel" class="panel ranking-panel hidden">
      <div class="ranking-head">
        <div>
          <h2>활동 레벨 랭킹</h2>
          <p id="rankingDescription">서버를 선택하면 실시간 활동 랭킹을 불러옵니다.</p>
        </div>
        <button id="refreshRanking" class="secondary" type="button">랭킹 새로고침</button>
      </div>

      <div class="summary-grid">
        <div class="summary-card"><span>참여 멤버</span><strong id="summaryUsers">0명</strong></div>
        <div class="summary-card"><span>누적 채팅</span><strong id="summaryCharacters">0자</strong></div>
        <div class="summary-card"><span>채팅 메시지</span><strong id="summaryMessages">0개</strong></div>
        <div class="summary-card"><span>누적 음성방</span><strong id="summaryVoice">0분</strong></div>
      </div>

      <div class="ranking-tabs" role="tablist" aria-label="랭킹 종류">
        <button class="ranking-tab active" type="button" data-ranking-type="overall">종합 랭킹</button>
        <button class="ranking-tab" type="button" data-ranking-type="chat">채팅 랭킹</button>
        <button class="ranking-tab" type="button" data-ranking-type="voice">음성방 랭킹</button>
      </div>

      <div class="table-wrap">
        <table class="ranking-table">
          <thead>
            <tr>
              <th>순위</th>
              <th>멤버</th>
              <th>레벨</th>
              <th id="rankingScoreHeading">종합 XP</th>
              <th id="rankingDetailHeading">활동 상세</th>
            </tr>
          </thead>
          <tbody id="rankingBody"></tbody>
        </table>
      </div>
      <div id="rankingStatus" class="status"></div>
    </section>
  </main>

  <script>
    const state = {
      guilds: [],
      guild: null,
      channels: [],
      selfIntroductionDefaults: null,
      rankingType: 'overall',
      rankingRequestId: 0
    };
    const els = {
      token: document.getElementById('token'),
      saveToken: document.getElementById('saveToken'),
      loadGuilds: document.getElementById('loadGuilds'),
      serverList: document.getElementById('serverList'),
      leftStatus: document.getElementById('leftStatus'),
      rightStatus: document.getElementById('rightStatus'),
      selectedGuild: document.getElementById('selectedGuild'),
      logForms: document.getElementById('logForms'),
      welcomeForm: document.getElementById('welcomeForm'),
      leaveForm: document.getElementById('leaveForm'),
      welcomeChannel: document.getElementById('welcomeChannel'),
      leaveChannel: document.getElementById('leaveChannel'),
      welcomeEnabled: document.getElementById('welcomeEnabled'),
      leaveEnabled: document.getElementById('leaveEnabled'),
      welcomeUseEmbed: document.getElementById('welcomeUseEmbed'),
      leaveUseEmbed: document.getElementById('leaveUseEmbed'),
      welcomeShowProfileImage: document.getElementById('welcomeShowProfileImage'),
      leaveShowProfileImage: document.getElementById('leaveShowProfileImage'),
      welcomeMentionUser: document.getElementById('welcomeMentionUser'),
      leaveMentionUser: document.getElementById('leaveMentionUser'),
      welcomeShowInviter: document.getElementById('welcomeShowInviter'),
      welcomeEmbedTitle: document.getElementById('welcomeEmbedTitle'),
      leaveEmbedTitle: document.getElementById('leaveEmbedTitle'),
      welcomeMessage: document.getElementById('welcomeMessage'),
      leaveMessage: document.getElementById('leaveMessage'),
      welcomeEmojiText: document.getElementById('welcomeEmojiText'),
      leaveEmojiText: document.getElementById('leaveEmojiText'),
      welcomeEmbedColor: document.getElementById('welcomeEmbedColor'),
      leaveEmbedColor: document.getElementById('leaveEmbedColor'),
      preview: document.getElementById('preview'),
      previewAvatar: document.getElementById('previewAvatar'),
      previewTitle: document.getElementById('previewTitle'),
      previewGuild: document.getElementById('previewGuild'),
      previewMessage: document.getElementById('previewMessage'),
      welcomePreviewButton: document.getElementById('welcomePreviewButton'),
      leavePreviewButton: document.getElementById('leavePreviewButton'),
      selfIntroductionPanel: document.getElementById('selfIntroductionPanel'),
      selfIntroductionForm: document.getElementById('selfIntroductionForm'),
      selfIntroductionChannel: document.getElementById('selfIntroductionChannel'),
      selfIntroductionEnabled: document.getElementById('selfIntroductionEnabled'),
      selfIntroductionTitle: document.getElementById('selfIntroductionTitle'),
      selfIntroductionDescription: document.getElementById('selfIntroductionDescription'),
      selfIntroductionFooter: document.getElementById('selfIntroductionFooter'),
      selfIntroductionColor: document.getElementById('selfIntroductionColor'),
      selfIntroductionPreview: document.getElementById('selfIntroductionPreview'),
      selfIntroductionPreviewTitle: document.getElementById('selfIntroductionPreviewTitle'),
      selfIntroductionPreviewDescription: document.getElementById('selfIntroductionPreviewDescription'),
      selfIntroductionPreviewFooter: document.getElementById('selfIntroductionPreviewFooter'),
      selfIntroductionPreviewButton: document.getElementById('selfIntroductionPreviewButton'),
      selfIntroductionStatus: document.getElementById('selfIntroductionStatus'),
      rankingPanel: document.getElementById('rankingPanel'),
      rankingDescription: document.getElementById('rankingDescription'),
      refreshRanking: document.getElementById('refreshRanking'),
      summaryUsers: document.getElementById('summaryUsers'),
      summaryCharacters: document.getElementById('summaryCharacters'),
      summaryMessages: document.getElementById('summaryMessages'),
      summaryVoice: document.getElementById('summaryVoice'),
      rankingScoreHeading: document.getElementById('rankingScoreHeading'),
      rankingDetailHeading: document.getElementById('rankingDetailHeading'),
      rankingBody: document.getElementById('rankingBody'),
      rankingStatus: document.getElementById('rankingStatus'),
      rankingTabs: [...document.querySelectorAll('[data-ranking-type]')]
    };

    els.token.value = localStorage.getItem('webAdminToken') || '';

    function setStatus(target, message, type = '') {
      target.textContent = message;
      target.className = 'status ' + type;
    }

    function getToken() {
      return els.token.value.trim();
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          'content-type': 'application/json',
          'x-admin-token': getToken(),
          ...(options.headers || {})
        }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.message || data.error || '요청에 실패했습니다.');
      }
      return data;
    }

    function renderGuilds() {
      els.serverList.innerHTML = '';
      state.guilds.forEach((guild) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'server' + (state.guild?.id === guild.id ? ' active' : '');
        button.innerHTML = '<img alt="" src="' + (guild.iconUrl || '') + '"><span></span>';
        button.querySelector('span').textContent = guild.name;
        button.addEventListener('click', () => loadGuild(guild.id));
        els.serverList.appendChild(button);
      });
    }

    function applyLog(prefix, settings, defaults) {
      els[prefix + 'Enabled'].checked = settings?.enabled !== false;
      els[prefix + 'UseEmbed'].checked = settings?.useEmbed !== false;
      els[prefix + 'ShowProfileImage'].checked = settings?.showProfileImage !== false;
      els[prefix + 'MentionUser'].checked = settings?.mentionUser === true;
      if (els[prefix + 'ShowInviter']) els[prefix + 'ShowInviter'].checked = settings?.showInviter !== false;
      els[prefix + 'Channel'].value = settings?.channelId || '';
      els[prefix + 'EmbedTitle'].value = settings?.embedTitle || defaults.title;
      els[prefix + 'Message'].value = settings?.message || defaults.message;
      els[prefix + 'EmojiText'].value = settings?.emojiText || '';
      els[prefix + 'EmbedColor'].value = settings?.embedColor || defaults.color;
    }

    function collectLog(prefix) {
      return {
        enabled: els[prefix + 'Enabled'].checked,
        channelId: els[prefix + 'Channel'].value,
        useEmbed: els[prefix + 'UseEmbed'].checked,
        showProfileImage: els[prefix + 'ShowProfileImage'].checked,
        mentionUser: els[prefix + 'MentionUser'].checked,
        showInviter: els[prefix + 'ShowInviter'] ? els[prefix + 'ShowInviter'].checked : false,
        embedTitle: els[prefix + 'EmbedTitle'].value,
        message: els[prefix + 'Message'].value,
        emojiText: els[prefix + 'EmojiText'].value,
        embedColor: els[prefix + 'EmbedColor'].value
      };
    }

    function applySelfIntroduction(settings) {
      const defaults = state.selfIntroductionDefaults || {};
      els.selfIntroductionEnabled.checked = settings?.enabled !== false;
      els.selfIntroductionChannel.value = settings?.channelId || '';
      els.selfIntroductionTitle.value = settings?.title ?? defaults.title ?? '';
      els.selfIntroductionDescription.value = settings?.description ?? defaults.description ?? '';
      els.selfIntroductionFooter.value = settings?.footer ?? defaults.footer ?? '';
      els.selfIntroductionColor.value = settings?.color || defaults.color || '#5865f2';
      els.selfIntroductionChannel.required = els.selfIntroductionEnabled.checked;
      renderSelfIntroductionPreview();
    }

    function collectSelfIntroduction() {
      return {
        enabled: els.selfIntroductionEnabled.checked,
        channelId: els.selfIntroductionChannel.value,
        title: els.selfIntroductionTitle.value,
        description: els.selfIntroductionDescription.value,
        footer: els.selfIntroductionFooter.value,
        color: els.selfIntroductionColor.value
      };
    }

    function renderSelfIntroductionPreview() {
      const data = collectSelfIntroduction();
      els.selfIntroductionPreview.style.borderLeftColor = data.color;
      els.selfIntroductionPreviewTitle.textContent = data.title || '제목 없음';
      els.selfIntroductionPreviewDescription.textContent = data.description || '내용 없음';
      els.selfIntroductionPreviewFooter.textContent = data.footer;
    }

    function renderPreview(prefix = 'welcome') {
      if (!state.guild) return;
      const user = prefix === 'welcome' ? '오도방구' : '떠난멤버';
      const mention = '@' + user;
      const replacements = {
        '{user}': user,
        '{tag}': user + '#0000',
        '{mention}': mention,
        '{server}': state.guild.name,
        '{memberCount}': prefix === 'welcome' ? '121' : '120',
        '{joinedAt}': '2026년 6월 19일 오후 5:03',
        '{joinedRelative}': '3시간 전',
        '{createdAt}': '2026년 5월 2일 오후 5:25',
        '{createdRelative}': '2달 전',
        '{leftAt}': '2026년 6월 19일 오후 8:12',
        '{leftRelative}': '방금 전',
        '{inviterMention}': '@DISBOARD',
        '{inviterName}': 'DISBOARD',
        '{inviterTag}': 'DISBOARD'
      };
      const replaceTokens = (value) => Object.entries(replacements).reduce((result, [key, val]) => result.replaceAll(key, val), value || '');
      const data = collectLog(prefix);
      const title = replaceTokens(data.embedTitle);
      const message = [
        data.emojiText,
        replaceTokens(data.message),
        '',
        '**유저**',
        mention + ' (' + user + ')',
        prefix === 'welcome' ? '**서버에 입장한 시간**' : '**서버에서 퇴장한 시간**',
        prefix === 'welcome' ? '2026년 6월 19일 오후 5:03 (3시간 전)' : '2026년 6월 19일 오후 8:12 (방금 전)',
        '**계정 생성일**',
        '2026년 5월 2일 오후 5:25 (2달 전)',
        prefix === 'welcome' && data.showInviter ? '**초대자**\\n@DISBOARD (DISBOARD)' : ''
      ].filter(Boolean).join('\\n');

      els.preview.classList.remove('hidden');
      els.preview.style.borderLeftColor = data.embedColor;
      els.previewAvatar.src = data.showProfileImage
        ? 'https://cdn.discordapp.com/embed/avatars/0.png'
        : (state.guild.iconUrl || 'https://cdn.discordapp.com/embed/avatars/1.png');
      els.previewTitle.textContent = title || (prefix === 'welcome' ? '입장 로그' : '퇴장 로그');
      els.previewGuild.textContent = state.guild.name;
      els.previewMessage.textContent = message || '메시지가 비어 있습니다.';
    }

    function formatNumber(value) {
      return Math.floor(Number(value) || 0).toLocaleString('ko-KR');
    }

    function formatDuration(totalSeconds) {
      const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const parts = [];
      if (days > 0) parts.push(days + '일');
      if (hours > 0) parts.push(hours + '시간');
      if (minutes > 0 || parts.length === 0) parts.push(minutes + '분');
      return parts.join(' ');
    }

    function getRankingLabels(type) {
      if (type === 'chat') return { score: '채팅 글자수', description: '공백을 제외한 누적 채팅 글자수 순위입니다.' };
      if (type === 'voice') return { score: '누적 체류 시간', description: 'Discord AFK 채널을 제외한 음성방 누적 체류 시간 순위입니다.' };
      return { score: '종합 XP', description: '채팅 글자수와 음성방 체류 XP를 합산한 종합 순위입니다.' };
    }

    function buildRankingMemberCell(entry) {
      const wrapper = document.createElement('div');
      const image = document.createElement('img');
      const text = document.createElement('div');
      const name = document.createElement('strong');
      const username = document.createElement('small');

      wrapper.className = 'rank-member';
      image.alt = '';
      image.src = entry.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
      name.textContent = entry.displayName;
      username.textContent = '@' + entry.username;
      text.append(name, username);
      wrapper.append(image, text);
      return wrapper;
    }

    function renderRanking(data) {
      const type = data.type;
      const labels = getRankingLabels(type);
      state.rankingType = type;
      els.rankingDescription.textContent = state.guild.name + ' · ' + labels.description;
      els.rankingScoreHeading.textContent = labels.score;
      els.rankingDetailHeading.textContent = type === 'overall' ? '채팅 / 음성방' : '활동 상세';
      els.summaryUsers.textContent = formatNumber(data.summary.totalUsers) + '명';
      els.summaryCharacters.textContent = formatNumber(data.summary.totalChatCharacters) + '자';
      els.summaryMessages.textContent = formatNumber(data.summary.totalChatMessages) + '개';
      els.summaryVoice.textContent = formatDuration(data.summary.totalVoiceSeconds);

      els.rankingTabs.forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.rankingType === type);
      });

      els.rankingBody.innerHTML = '';
      if (data.ranking.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.className = 'empty-ranking';
        cell.textContent = '아직 이 랭킹에 표시할 활동 기록이 없습니다.';
        row.appendChild(cell);
        els.rankingBody.appendChild(row);
      }

      data.ranking.forEach((entry) => {
        const row = document.createElement('tr');
        const rankCell = document.createElement('td');
        const memberCell = document.createElement('td');
        const levelCell = document.createElement('td');
        const scoreCell = document.createElement('td');
        const detailCell = document.createElement('td');
        const medals = ['🥇', '🥈', '🥉'];

        rankCell.className = 'rank-number';
        rankCell.textContent = medals[entry.rank - 1] || entry.rank + '위';
        memberCell.appendChild(buildRankingMemberCell(entry));
        levelCell.textContent = 'LV.' + entry.level;

        if (type === 'chat') {
          scoreCell.textContent = formatNumber(entry.chatCharacters) + '자';
          detailCell.textContent = formatNumber(entry.chatMessages) + '개 메시지 · ' + formatNumber(entry.chatXp) + ' XP';
        } else if (type === 'voice') {
          scoreCell.textContent = formatDuration(entry.voiceSeconds);
          detailCell.textContent = formatNumber(entry.voiceXp) + ' XP';
        } else {
          scoreCell.textContent = formatNumber(entry.totalXp) + ' XP';
          detailCell.textContent = formatNumber(entry.chatCharacters) + '자 · ' + formatDuration(entry.voiceSeconds);
        }

        row.append(rankCell, memberCell, levelCell, scoreCell, detailCell);
        els.rankingBody.appendChild(row);
      });

      const rules = data.rules;
      setStatus(
        els.rankingStatus,
        '채팅 1자당 ' + rules.chatXpPerCharacter + ' XP · 음성 1분당 ' + rules.voiceXpPerMinute + ' XP · 최대 50명 표시',
        'ok'
      );
    }

    async function loadRanking(type = state.rankingType) {
      if (!state.guild) return;
      const requestId = ++state.rankingRequestId;
      setStatus(els.rankingStatus, '랭킹을 불러오는 중...');
      const data = await api('/api/guilds/' + state.guild.id + '/rankings?type=' + encodeURIComponent(type) + '&limit=50');
      if (requestId !== state.rankingRequestId) return;
      renderRanking(data);
    }

    async function loadGuilds() {
      setStatus(els.leftStatus, '서버를 불러오는 중...');
      const data = await api('/api/guilds');
      state.guilds = data.guilds;
      renderGuilds();
      setStatus(els.leftStatus, data.guilds.length + '개 서버를 불러왔습니다.', 'ok');
    }

    async function loadGuild(guildId) {
      setStatus(els.rightStatus, '설정을 불러오는 중...');
      const data = await api('/api/guilds/' + guildId);
      state.guild = data.guild;
      state.channels = data.channels;
      state.selfIntroductionDefaults = data.selfIntroductionDefaults;
      els.selectedGuild.textContent = state.guild.name + ' 설정 중';
      const channelOptions = '<option value="">채널 선택</option>' + state.channels.map((channel) => {
        const label = channel.parentName ? channel.parentName + ' / #' + channel.name : '#' + channel.name;
        return '<option value="' + channel.id + '">' + label + '</option>';
      }).join('');
      els.welcomeChannel.innerHTML = channelOptions;
      els.leaveChannel.innerHTML = channelOptions;
      els.selfIntroductionChannel.innerHTML = channelOptions;
      els.logForms.classList.remove('hidden');
      applyLog('welcome', data.welcome, {
        title: '{memberCount}번째 멤버가 입장했어요',
        message: '',
        color: '#3498db'
      });
      applyLog('leave', data.leave, {
        title: '{user} 님이 서버를 떠났어요',
        message: '',
        color: '#ed4245'
      });
      applySelfIntroduction(data.selfIntroduction);
      renderPreview('welcome');
      renderGuilds();
      els.selfIntroductionPanel.classList.remove('hidden');
      els.rankingPanel.classList.remove('hidden');
      await loadRanking(state.rankingType);
      setStatus(els.rightStatus, '설정을 불러왔습니다.', 'ok');
    }

    els.saveToken.addEventListener('click', () => {
      localStorage.setItem('webAdminToken', getToken());
      setStatus(els.leftStatus, '토큰을 저장했습니다.', 'ok');
    });

    els.loadGuilds.addEventListener('click', () => {
      loadGuilds().catch((error) => setStatus(els.leftStatus, error.message, 'error'));
    });

    els.refreshRanking.addEventListener('click', () => {
      loadRanking().catch((error) => setStatus(els.rankingStatus, error.message, 'error'));
    });

    els.rankingTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        loadRanking(tab.dataset.rankingType).catch((error) => setStatus(els.rankingStatus, error.message, 'error'));
      });
    });

    els.welcomeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!state.guild) return;
      setStatus(els.rightStatus, '입장 로그 저장 중...');
      api('/api/guilds/' + state.guild.id + '/welcome', {
        method: 'POST',
        body: JSON.stringify(collectLog('welcome'))
      })
        .then(() => {
          renderPreview('welcome');
          setStatus(els.rightStatus, '입장 로그 설정을 저장했습니다.', 'ok');
        })
        .catch((error) => setStatus(els.rightStatus, error.message, 'error'));
    });

    els.leaveForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!state.guild) return;
      setStatus(els.rightStatus, '퇴장 로그 저장 중...');
      api('/api/guilds/' + state.guild.id + '/leave', {
        method: 'POST',
        body: JSON.stringify(collectLog('leave'))
      })
        .then(() => {
          renderPreview('leave');
          setStatus(els.rightStatus, '퇴장 로그 설정을 저장했습니다.', 'ok');
        })
        .catch((error) => setStatus(els.rightStatus, error.message, 'error'));
    });

    els.selfIntroductionForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!state.guild) return;
      setStatus(els.selfIntroductionStatus, '자기소개 설정 저장 중...');
      api('/api/guilds/' + state.guild.id + '/self-introduction', {
        method: 'POST',
        body: JSON.stringify(collectSelfIntroduction())
      })
        .then((data) => {
          applySelfIntroduction(data.selfIntroduction);
          setStatus(
            els.selfIntroductionStatus,
            data.selfIntroduction.enabled
              ? '설정을 저장하고 자기소개 안내를 다시 게시했습니다.'
              : '자기소개 반복 안내를 껐습니다.',
            'ok'
          );
        })
        .catch((error) => setStatus(els.selfIntroductionStatus, error.message, 'error'));
    });

    els.welcomePreviewButton.addEventListener('click', () => renderPreview('welcome'));
    els.leavePreviewButton.addEventListener('click', () => renderPreview('leave'));
    els.selfIntroductionPreviewButton.addEventListener('click', renderSelfIntroductionPreview);
    els.selfIntroductionEnabled.addEventListener('change', () => {
      els.selfIntroductionChannel.required = els.selfIntroductionEnabled.checked;
      renderSelfIntroductionPreview();
    });
    [
      els.selfIntroductionChannel,
      els.selfIntroductionTitle,
      els.selfIntroductionDescription,
      els.selfIntroductionFooter,
      els.selfIntroductionColor
    ].forEach((el) => {
      el.addEventListener('input', renderSelfIntroductionPreview);
      el.addEventListener('change', renderSelfIntroductionPreview);
    });
    ['input', 'change'].forEach((eventName) => {
      [
        els.welcomeEnabled, els.welcomeUseEmbed, els.welcomeShowProfileImage, els.welcomeMentionUser, els.welcomeShowInviter,
        els.welcomeEmbedTitle, els.welcomeMessage, els.welcomeEmojiText, els.welcomeEmbedColor
      ].forEach((el) => {
        el.addEventListener(eventName, () => renderPreview('welcome'));
      });
      [
        els.leaveEnabled, els.leaveUseEmbed, els.leaveShowProfileImage, els.leaveMentionUser,
        els.leaveEmbedTitle, els.leaveMessage, els.leaveEmojiText, els.leaveEmbedColor
      ].forEach((el) => {
        el.addEventListener(eventName, () => renderPreview('leave'));
      });
    });
  </script>
</body>
</html>`;
}

export function startHealthServer(client) {
  if (!readEnabled()) {
    console.log('Health server disabled.');
    return null;
  }

  const port = readPort();
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    Promise.resolve()
      .then(async () => {
        if (url.pathname === '/health') {
          response.writeHead(200, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8'
          });
          response.end(buildHealthBody(client));
          return;
        }

        if (url.pathname.startsWith('/api/')) {
          await handleApiRequest(client, request, response, url);
          return;
        }

        if (request.method === 'GET' && url.pathname === '/') {
          sendHtml(response, 200, buildAdminHtml());
          return;
        }

        sendJson(response, 404, { ok: false, error: 'not_found' });
      })
      .catch((error) => {
        console.error(`Web request failed: ${error.message}`);
        if (!response.headersSent) {
          sendJson(response, 400, { ok: false, error: 'bad_request', message: error.message });
        } else {
          response.end();
        }
      });
  });

  server.on('error', (error) => {
    console.error(`Health server failed: ${error.message}`);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on 0.0.0.0:${port}`);
  });

  return server;
}
