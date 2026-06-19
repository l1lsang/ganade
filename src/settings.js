import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const settingsPath = path.join(process.cwd(), 'data', 'guild-settings.json');

let settingsCache = null;

async function readAllSettings() {
  if (settingsCache) return settingsCache;

  try {
    const raw = await readFile(settingsPath, 'utf8');
    settingsCache = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    settingsCache = {};
  }

  return settingsCache;
}

async function writeAllSettings(settings) {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  settingsCache = settings;
}

export async function getGuildSettings(guildId) {
  const settings = await readAllSettings();
  return settings[guildId] || {};
}

export async function updateGuildSettings(guildId, changes) {
  const settings = await readAllSettings();
  const current = settings[guildId] || {};

  settings[guildId] = {
    ...current,
    ...changes,
    updatedAt: new Date().toISOString()
  };

  await writeAllSettings(settings);
  return settings[guildId];
}
