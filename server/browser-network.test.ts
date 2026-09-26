import { expect, it, vi } from 'vitest';
import { publicAddress, publicUrl, resolvePublic, browserProxy } from './browser-network';
import { request } from 'node:http';

it('rejects private, local, mapped, link-local and encoded addresses', () => {
  for (const url of [
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://169.254.169.254',
    'http://10.0.0.1',
    'http://192.168.1.1',
    'http://[fc00::1]',
    'http://[fe80::1]',
    'http://localhost.',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'https://example.com:5432',
  ]) {
    expect(() => publicUrl(url), url).toThrow();
  }
  expect(publicAddress('8.8.8.8')).toBe(true);
  expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  expect(publicUrl('https://example.com/path').hostname).toBe('example.com');
});
it('rejects mixed DNS results and returns the validated IP to pin the connection', async () => {
  const resolve = vi.fn().mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]);
  await expect(resolvePublic('example.com', resolve)).rejects.toThrow('Interne');
  resolve.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  await expect(resolvePublic('example.com', resolve)).resolves.toEqual({ address: '8.8.8.8', family: 4 });
});
it('the actual egress proxy refuses requests to loopback', async () => {
  const proxy = await browserProxy();
  try {
    const status = await new Promise<number>((done, reject) => {
      const call = request(proxy.url, { path: 'http://127.0.0.1:80/' }, (response) => {
        response.resume();
        done(response.statusCode!);
      });
      call.on('error', reject);
      call.end();
    });
    expect(status).toBe(403);
  } finally {
    await proxy.close();
  }
});
