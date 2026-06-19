import { REST, Routes } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommands, buildUpdateCommand } from './commands.js';
import { assertRequiredConfig, config } from './config.js';

function getCollectionRoute(guildId, global = false) {
  if (global) return Routes.applicationCommands(config.discordClientId);
  return Routes.applicationGuildCommands(config.discordClientId, guildId);
}

function getCommandRoute(commandId, guildId, global = false) {
  if (global) return Routes.applicationCommand(config.discordClientId, commandId);
  return Routes.applicationGuildCommand(config.discordClientId, guildId, commandId);
}

export function createRestClient() {
  assertRequiredConfig({ forSyncOnly: true });
  return new REST({ version: '10' }).setToken(config.discordToken);
}

export async function syncAllCommands({ guildId = config.discordGuildId, global = false } = {}) {
  const rest = createRestClient();

  if (!global && !guildId) {
    throw new Error('DISCORD_GUILD_ID is required for guild command sync.');
  }

  const commands = buildCommands();
  const route = getCollectionRoute(guildId, global);
  const synced = await rest.put(route, { body: commands });

  return {
    scope: global ? 'global' : 'guild',
    guildId: global ? null : guildId,
    count: Array.isArray(synced) ? synced.length : commands.length
  };
}

export async function ensureUpdateCommand({ guildId = config.discordGuildId, global = false } = {}) {
  const rest = createRestClient();

  if (!global && !guildId) {
    throw new Error('DISCORD_GUILD_ID is required to register /업데이트 as a guild command.');
  }

  const route = getCollectionRoute(guildId, global);
  const updateCommand = buildUpdateCommand().toJSON();
  const existingCommands = await rest.get(route);
  const existing = existingCommands.find((command) => command.name === updateCommand.name);

  if (existing) {
    await rest.patch(getCommandRoute(existing.id, guildId, global), { body: updateCommand });
    return { created: false, scope: global ? 'global' : 'guild' };
  }

  await rest.post(route, { body: updateCommand });
  return { created: true, scope: global ? 'global' : 'guild' };
}

const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedFile && path.resolve(currentFile) === invokedFile) {
  const useGlobal = process.argv.includes('--global');

  syncAllCommands({ global: useGlobal })
    .then((result) => {
      const target = result.scope === 'global' ? '전역' : `서버 ${result.guildId}`;
      console.log(`${target} 명령어 ${result.count}개를 동기화했습니다.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
