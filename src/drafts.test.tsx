// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { repo, db } from './repository';
import { useNewDrafts } from './drafts';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeEach(async () => {
  await db.drafts.clear();
});
afterEach(cleanup);
it('shows persisted new drafts, refreshes on editing and removes saved or empty drafts', async () => {
  const draft = {
    key: 'local:new',
    scope: 'local',
    noteId: null,
    content: 'Erster Gedanke',
    baseRevision: null,
    updatedAt: new Date().toISOString(),
  };
  await repo.saveDraft(draft);
  await repo.saveDraft({ ...draft, key: 'other:new', scope: 'other', content: 'Anderes Konto' });
  await repo.saveDraft({ ...draft, key: 'local:existing', noteId: 'existing', content: 'Bestehende Notiz' });
  const { result, unmount } = renderHook(() => useNewDrafts('local'));
  await waitFor(() => expect(result.current.map((d) => d.content)).toEqual(['Erster Gedanke']));
  await act(async () => {
    await repo.saveDraft({ ...draft, content: 'Weitergeschrieben' });
  });
  await waitFor(() => expect(result.current[0].content).toBe('Weitergeschrieben'));
  unmount();
  const restored = renderHook(() => useNewDrafts('local'));
  await waitFor(() => expect(restored.result.current[0].content).toBe('Weitergeschrieben'));
  await act(async () => {
    await repo.removeDraft('local', null);
  });
  await waitFor(() => expect(restored.result.current).toHaveLength(0));
  await act(async () => {
    await repo.saveDraft({ ...draft, content: '   ' });
  });
  expect(restored.result.current).toHaveLength(0);
  await act(async () => {
    await repo.saveDraft({ ...draft, key: 'local:widget', noteId: 'widget' });
  });
  await waitFor(() => expect(restored.result.current[0].noteId).toBe('widget'));
});
