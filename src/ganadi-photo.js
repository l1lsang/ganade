import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ganadiPhotoDirectory = fileURLToPath(new URL('./ㄱㄴㄷ/', import.meta.url));

const supportedPhotoExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export async function listGanadiPhotos() {
  let entries;
  try {
    entries = await readdir(ganadiPhotoDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && supportedPhotoExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      path: path.join(ganadiPhotoDirectory, entry.name)
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR'));
}

export function selectRandomGanadiPhoto(photos, random = Math.random) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const randomValue = Number(random());
  const normalized = Number.isFinite(randomValue)
    ? Math.max(0, Math.min(0.9999999999999999, randomValue))
    : 0;
  return photos[Math.floor(normalized * photos.length)];
}

export async function getRandomGanadiPhoto(random = Math.random) {
  return selectRandomGanadiPhoto(await listGanadiPhotos(), random);
}
