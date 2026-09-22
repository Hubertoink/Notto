import { invoke } from '@tauri-apps/api/core';
import { desktop } from './repository';
import { version } from '../package.json';

const RELEASE_API = 'https://api.github.com/repos/Hubertoink/Notto/releases/latest';
const AUTO_CHECK_KEY = 'notto-auto-update-check';
const LAST_CHECK_KEY = 'notto-last-update-check';
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export const currentVersion = version;

export type UpdateResult = {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  publishedAt: string | null;
};

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
  if (!options.force) {
    if (!automaticUpdateChecksEnabled()) return null;
    const lastCheck = Number(localStorage.getItem(LAST_CHECK_KEY));
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < CHECK_INTERVAL) return null;
  }

  const response = await fetch(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error('Die Update-Informationen konnten nicht geladen werden.');
  const release = (await response.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
    published_at?: unknown;
  };
  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string')
    throw new Error('Die Update-Informationen sind unvollständig.');

  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  const latestVersion = release.tag_name.replace(/^v/i, '');
  return {
    available: isNewerVersion(latestVersion, currentVersion),
    currentVersion,
    latestVersion,
    releaseUrl: release.html_url,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
  };
}

export async function openRelease(url: string) {
  if (desktop) await invoke('open_external', { url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
