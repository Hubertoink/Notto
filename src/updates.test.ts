// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  automaticUpdateChecksEnabled,
  checkForUpdate,
  isNewerVersion,
  setAutomaticUpdateChecks,
} from './updates';

vi.mock('./repository', () => ({ desktop: true }));

describe('update checks', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('compares stable semantic versions', () => {
    expect(isNewerVersion('v0.14.0', '0.13.20')).toBe(true);
    expect(isNewerVersion('0.13.20', '0.13.20')).toBe(false);
    expect(isNewerVersion('0.13.19', '0.13.20')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true);
  });

  it('keeps automatic checks enabled by default and lets the user disable them', () => {
    expect(automaticUpdateChecksEnabled()).toBe(true);
    setAutomaticUpdateChecks(false);
    expect(automaticUpdateChecksEnabled()).toBe(false);
  });

  it('reads the latest GitHub release and throttles automatic checks', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v99.0.0',
        html_url: 'https://github.com/Hubertoink/Notto/releases/tag/v99.0.0',
        published_at: '2026-09-22T12:00:00Z',
      }),
    });
    vi.stubGlobal('fetch', fetch);
    expect(await checkForUpdate()).toMatchObject({ available: true, latestVersion: '99.0.0' });
    expect(await checkForUpdate()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    await checkForUpdate({ force: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
