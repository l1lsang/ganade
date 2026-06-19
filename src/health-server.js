import { createServer } from 'node:http';
import { ChannelType, PermissionsBitField } from 'discord.js';
import { config } from './config.js';
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
    leave: settings.leave || null
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

  sendJson(response, 404, { ok: false, error: 'not_found' });
}

function buildAdminHtml() {
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
    .hidden { display: none; }
    @media (max-width: 840px) {
      main { width: min(100% - 20px, 640px); padding-top: 20px; }
      .grid { grid-template-columns: 1fr; }
      .split { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <h1>봇 웹 설정</h1>
    <p>서버를 고른 뒤 입장/퇴장 로그를 설정하세요. 외부 이모지는 Discord 형식 <code>&lt;:name:id&gt;</code> 또는 <code>&lt;a:name:id&gt;</code>를 그대로 넣으면 됩니다.</p>

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
  </main>

  <script>
    const state = { guilds: [], guild: null, channels: [] };
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
      leavePreviewButton: document.getElementById('leavePreviewButton')
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
      els.selectedGuild.textContent = state.guild.name + ' 설정 중';
      const channelOptions = '<option value="">채널 선택</option>' + state.channels.map((channel) => {
        const label = channel.parentName ? channel.parentName + ' / #' + channel.name : '#' + channel.name;
        return '<option value="' + channel.id + '">' + label + '</option>';
      }).join('');
      els.welcomeChannel.innerHTML = channelOptions;
      els.leaveChannel.innerHTML = channelOptions;
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
      renderPreview('welcome');
      renderGuilds();
      setStatus(els.rightStatus, '설정을 불러왔습니다.', 'ok');
    }

    els.saveToken.addEventListener('click', () => {
      localStorage.setItem('webAdminToken', getToken());
      setStatus(els.leftStatus, '토큰을 저장했습니다.', 'ok');
    });

    els.loadGuilds.addEventListener('click', () => {
      loadGuilds().catch((error) => setStatus(els.leftStatus, error.message, 'error'));
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

    els.welcomePreviewButton.addEventListener('click', () => renderPreview('welcome'));
    els.leavePreviewButton.addEventListener('click', () => renderPreview('leave'));
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
