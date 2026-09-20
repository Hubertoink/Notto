// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { validateRewrite, rewriteNote } from './rewrite';
import { config, request } from './intelligence';
vi.mock('./intelligence', () => ({
  config: vi.fn(),
  request: vi.fn(),
  responseText: (response: unknown) => JSON.stringify(response),
}));
beforeEach(() => {
  vi.mocked(config).mockReturnValue({
    enabled: true,
    auto: false,
    autoResearch: false,
    model: 'test',
    excludedTags: 'privat',
    excludedNotes: [],
    dailyLimit: 40,
    rewriteMode: 'correct',
  });
  vi.mocked(request).mockReset();
});
it('preserves attachments, note links and hashtags and rejects their removal or replacement', () => {
  const text = 'gedanke #arbeit [PDF](attachments/a.pdf) [Notiz](notes/123)';
  expect(validateRewrite(text, text.replace('gedanke', 'Gedanke.'))).toContain('Gedanke.');
  for (const after of [
    text.replace('a.pdf', 'b.pdf'),
    text.replace('#arbeit', '#privat'),
    text.replace('notes/123', 'notes/456'),
  ])
    expect(() => validateRewrite(text, after)).toThrow('verändert');
});
it('uses the selected mode without memory or tools and rejects excluded draft text before any request', async () => {
  vi.mocked(request).mockResolvedValue({ content: 'Ein Gedanke.' });
  await expect(rewriteNote('local', 'ein gedanke')).resolves.toBe('Ein Gedanke.');
  expect(vi.mocked(request).mock.calls[0][2]).toMatchObject({ memory: false, store: false });
  expect(vi.mocked(request).mock.calls[0][2].tools).toBeUndefined();
  await expect(rewriteNote('local', 'Gedanke #privat')).rejects.toThrow('ausgeschlossen');
  expect(request).toHaveBeenCalledTimes(1);
});
