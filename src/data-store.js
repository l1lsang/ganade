import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { config } from './config.js';

const firebaseAppName = 'ganadi-data-store';
const registeredStores = new Map();

let database = null;

function normalizeFirebasePath(value, label) {
  const normalized = String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

  if (!normalized || /[.#$\[\]]/.test(normalized)) {
    throw new Error(`${label}에 Firebase 경로에서 사용할 수 없는 값이 들어 있습니다.`);
  }

  return normalized;
}

function parseServiceAccountJson(value) {
  try {
    const account = JSON.parse(value);
    if (account.private_key) {
      account.private_key = account.private_key.replace(/\\n/g, '\n');
    }
    return account;
  } catch (error) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON 형식이 올바르지 않습니다: ${error.message}`);
  }
}

function createFirebaseCredential() {
  if (config.firebaseServiceAccountJson) {
    return cert(parseServiceAccountJson(config.firebaseServiceAccountJson));
  }

  const inlineValues = [
    config.firebaseProjectId,
    config.firebaseClientEmail,
    config.firebasePrivateKey
  ];
  const hasAnyInlineValue = inlineValues.some(Boolean);

  if (hasAnyInlineValue) {
    const missing = [];
    if (!config.firebaseProjectId) missing.push('FIREBASE_PROJECT_ID');
    if (!config.firebaseClientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
    if (!config.firebasePrivateKey) missing.push('FIREBASE_PRIVATE_KEY');

    if (missing.length > 0) {
      throw new Error(`Firebase 서비스 계정 환경변수가 부족합니다: ${missing.join(', ')}`);
    }

    return cert({
      projectId: config.firebaseProjectId,
      clientEmail: config.firebaseClientEmail,
      privateKey: config.firebasePrivateKey.replace(/\\n/g, '\n')
    });
  }

  return applicationDefault();
}

function getFirebaseDatabase() {
  if (database) return database;
  if (!config.firebaseDatabaseUrl) {
    throw new Error('Firebase 저장을 사용하려면 FIREBASE_DATABASE_URL을 설정해야 합니다.');
  }

  const existingApp = getApps().find((app) => app.name === firebaseAppName);
  const app = existingApp || initializeApp({
    credential: createFirebaseCredential(),
    databaseURL: config.firebaseDatabaseUrl
  }, firebaseAppName);

  database = getDatabase(app);
  return database;
}

function cloneJson(value) {
  const serialized = JSON.stringify(value ?? {});
  return serialized === undefined ? {} : JSON.parse(serialized);
}

async function readLocalJson(localPath) {
  try {
    const parsed = JSON.parse(await readFile(localPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`기존 JSON 데이터 읽기 실패 (${localPath}): ${error.message}`);
  }
}

function hasStoredData(value) {
  return value && typeof value === 'object' && Object.keys(value).length > 0;
}

function resolveDriver(forceLocal) {
  if (forceLocal) return 'local';
  if (config.dataStorageDriver === 'firebase' || config.dataStorageDriver === 'local') {
    return config.dataStorageDriver;
  }
  throw new Error('DATA_STORAGE_DRIVER는 firebase 또는 local이어야 합니다.');
}

export function createJsonDataStore({ name, localPath, forceLocal = false }) {
  const storeName = normalizeFirebasePath(name, '저장소 이름');
  const driver = resolveDriver(forceLocal);
  let migrationPromise = null;

  function getRemoteReference() {
    const root = normalizeFirebasePath(config.firebaseDatabaseRoot, 'FIREBASE_DATABASE_ROOT');
    return getFirebaseDatabase().ref(`${root}/stores/${storeName}`);
  }

  async function ensureRemoteAndMigrate() {
    if (driver !== 'firebase') return;
    if (migrationPromise) return migrationPromise;

    migrationPromise = (async () => {
      const reference = getRemoteReference();
      const snapshot = await reference.get();
      if (snapshot.exists() || !localPath) return;

      const localData = await readLocalJson(localPath);
      if (!hasStoredData(localData)) return;

      const result = await reference.transaction((current) => (
        current === null ? cloneJson(localData) : undefined
      ));

      if (result.committed) {
        console.log(`기존 JSON 데이터를 Firebase로 이전했습니다: ${storeName}`);
      }
    })().catch((error) => {
      migrationPromise = null;
      throw error;
    });

    return migrationPromise;
  }

  const store = {
    name: storeName,
    driver,
    localPath,
    async read() {
      if (driver === 'local') return readLocalJson(localPath);
      await ensureRemoteAndMigrate();
      const snapshot = await getRemoteReference().get();
      return snapshot.exists() ? cloneJson(snapshot.val()) : {};
    },
    async write(value) {
      const data = cloneJson(value);
      if (driver === 'local') {
        await mkdir(path.dirname(localPath), { recursive: true });
        await writeFile(localPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
        return;
      }

      await ensureRemoteAndMigrate();
      await getRemoteReference().set(data);
    },
    ensureRemoteAndMigrate
  };

  registeredStores.set(storeName, store);
  return store;
}

export async function assertDataStorageReady() {
  if (config.dataStorageDriver === 'local') {
    console.warn('DATA_STORAGE_DRIVER=local: 데이터가 로컬 JSON 파일에 저장됩니다.');
    return;
  }
  if (config.dataStorageDriver !== 'firebase') {
    throw new Error('DATA_STORAGE_DRIVER는 firebase 또는 local이어야 합니다.');
  }

  const root = normalizeFirebasePath(config.firebaseDatabaseRoot, 'FIREBASE_DATABASE_ROOT');
  await getFirebaseDatabase().ref(root).get();
  await Promise.all(
    [...registeredStores.values()]
      .filter((store) => store.driver === 'firebase')
      .map((store) => store.ensureRemoteAndMigrate())
  );
  console.log(`Firebase Realtime Database 연결 완료: ${root}`);
}
