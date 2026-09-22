import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { desktop } from './repository';
import { version } from '../package.json';

const AUTO_CHECK_KEY = 'notto-auto-update-check';
const LAST_CHECK_KEY = 'notto-last-update-check';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const UPDATE_TIMEOUT = 5 * 60 * 1000;

export const currentVersion = version;

export type UpdateResult = {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  publishedAt: string | null;
};

export type UpdateProgress = {
  phase: 'downloading' | 'installing';
  downloadedBytes: number;
  totalBytes: number | null;
};

let pendingUpdate: Update | null = null;

function versionParts(value: string) {
  const match = value
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? '',
  };
}

export function isNewerVersion(candidate: string, installed: string) {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next.numbers[index] !== current.numbers[index]) return next.numbers[index] > current.numbers[index];
  }
  return current.prerelease !== '' && next.prerelease === '';
}

export function automaticUpdateChecksEnabled() {
  return localStorage.getItem(AUTO_CHECK_KEY) !== 'false';
}

export function setAutomaticUpdateChecks(enabled: boolean) {
  localStorage.setItem(AUTO_CHECK_KEY, String(enabled));
  if (enabled) localStorage.removeItem(LAST_CHECK_KEY);
}

export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateResult | null> {
  if (!desktop) return null;
  if (!options.force) {
    if (!automaticUpdateChecksEnabled()) return null;
    const lastCheck = Number(localStorage.getItem(LAST_CHECK_KEY));
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < CHECK_INTERVAL) return null;
  }

  const update = await check({ timeout: 30_000 });
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  if (pendingUpdate && pendingUpdate !== update) await pendingUpdate.close();
  pendingUpdate = update;

  return {
    available: update !== null,
    currentVersion,
    latestVersion: update?.version ?? currentVersion,
    publishedAt: update?.date ?? null,
  };
}

export async function installUpdate(onProgress: (progress: UpdateProgress) => void) {
  if (!desktop) throw new Error('Updates können nur in der Desktop-App installiert werden.');
  const update = pendingUpdate ?? (await check({ timeout: 30_000 }));
  if (!update) throw new Error('Es ist kein neues Update verfügbar.');
  pendingUpdate = update;

  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  const progress = (event: DownloadEvent) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength ?? null;
      onProgress({ phase: 'downloading', downloadedBytes, totalBytes });
    } else if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength;
      onProgress({ phase: 'downloading', downloadedBytes, totalBytes });
    } else {
      onProgress({ phase: 'installing', downloadedBytes, totalBytes });
    }
  };

  await update.downloadAndInstall(progress, {
    timeout: UPDATE_TIMEOUT,
    restartAfterInstall: true,
  });
  pendingUpdate = null;
  await relaunch();
}
