import path from 'node:path';
import { createJsonDataStore } from './data-store.js';

const explicitSettingsPath = process.env.GUILD_SETTINGS_DATA_PATH;
const settingsPath = explicitSettingsPath || path.join(process.cwd(), 'data', 'guild-settings.json');
const settingsStore = createJsonDataStore({
  name: 'guild-settings',
  localPath: settingsPath
});

let settingsCache = null;
let mutationQueue = Promise.resolve();

async function readAllSettings() {
  if (settingsCache) return settingsCache;

  settingsCache = await settingsStore.read();

  return settingsCache;
}

async function writeAllSettings(settings) {
  await settingsStore.write(settings);
  settingsCache = settings;
}

function enqueueSettingsMutation(mutator) {
  const task = mutationQueue.then(async () => mutator(await readAllSettings()));
  mutationQueue = task.catch(() => null);
  return task;
}

export async function getGuildSettings(guildId) {
  await mutationQueue;
  const settings = await readAllSettings();
  return settings[guildId] || {};
}

export async function updateGuildSettings(guildId, changes) {
  return enqueueSettingsMutation(async (settings) => {
    const current = settings[guildId] || {};

    settings[guildId] = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString()
    };

    await writeAllSettings(settings);
    return settings[guildId];
  });
}
