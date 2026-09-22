// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updater = vi.hoisted(() => ({
  check: vi.fn(),
  close: vi.fn(),
  downloadAndInstall: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('./repository', () => ({ desktop: true }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: updater.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: updater.relaunch }));

import {
  automaticUpdateChecksEnabled,
  checkForUpdate,
  installUpdate,
  isNewerVersion,
  setAutomaticUpdateChecks,
} from './updates';

describe('update checks', () => {
  beforeEach(() => {
    localStorage.clear();
    updater.check.mockReset();
    updater.close.mockReset();
    updater.downloadAndInstall.mockReset();
    updater.relaunch.mockReset();
  });

  it('compares stable semantic versions', () => {
    expect(isNewerVersion('v1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.1', '1.0.1')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true);
  });

  it('keeps automatic checks enabled by default and lets the user disable them', () => {
    expect(automaticUpdateChecksEnabled()).toBe(true);
    setAutomaticUpdateChecks(false);
    expect(automaticUpdateChecksEnabled()).toBe(false);
  });

  it('reads signed updater metadata and throttles automatic checks', async () => {
    updater.check.mockResolvedValue({
      version: '99.0.0',
      date: '2026-09-22T12:00:00Z',
      close: updater.close,
      downloadAndInstall: updater.downloadAndInstall,
    });

    expect(await checkForUpdate()).toMatchObject({ available: true, latestVersion: '99.0.0' });
    expect(await checkForUpdate()).toBeNull();
    expect(updater.check).toHaveBeenCalledOnce();
    await checkForUpdate({ force: true });
    expect(updater.check).toHaveBeenCalledTimes(2);
  });

  it('downloads, installs and relaunches while reporting progress', async () => {
    updater.downloadAndInstall.mockImplementation(async (onProgress) => {
      onProgress({ event: 'Started', data: { contentLength: 100 } });
      onProgress({ event: 'Progress', data: { chunkLength: 40 } });
      onProgress({ event: 'Finished' });
    });
    updater.check.mockResolvedValue({
      version: '99.0.0',
      close: updater.close,
      downloadAndInstall: updater.downloadAndInstall,
    });
    const progress = vi.fn();

    await checkForUpdate({ force: true });
    await installUpdate(progress);

    expect(updater.downloadAndInstall).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'installing',
      downloadedBytes: 40,
      totalBytes: 100,
    });
    expect(updater.relaunch).toHaveBeenCalledOnce();
  });
});
