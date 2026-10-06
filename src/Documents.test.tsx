// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { DocumentDetail } from './Documents';
import { createDocument } from './document-store';
import { db, repo } from './repository';
import { newNote, tagsOf, type Note } from './domain';
const state = vi.hoisted(() => ({ notes: [] as Note[], sync: vi.fn(), notify: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./cloud', () => ({
  fetchAttachment: (scope: string, id: string) => repo.attachment(scope, id),
  cloud: () => null,
  ownBackend: () => false,
}));
vi.mock('./state', () => ({ useNotto: () => ({ ...state, scope: 'local' }) }));
vi.mock('./Tasks', () => ({ useKnowledgeRecords: () => [] }));
beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  await Promise.all([db.notes.clear(), db.knowledge.clear(), db.attachments.clear()]);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('selects existing tags and multiple collections as chips and persists pending input on save', async () => {
  const bytes = new TextEncoder().encode('Unsere Konzeption');
  const attachment = await repo.addDocument('local', {
    name: 'Konzeption.txt',
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as File);
  const document = await createDocument('local', attachment, ['Jugendhaus'], ['konzeption']);
  state.notes = [document, { ...newNote('local', 'Idee #jugendarbeit'), collections: ['Organisation'] }];
  render(
    <Theme theme={neutralTheme}>
      <DocumentDetail note={document} onOpen={vi.fn()} />
    </Theme>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'jugendarbeit' }));
  await user.click(screen.getByRole('button', { name: 'Organisation' }));
  expect(screen.getByRole('button', { name: 'Tag jugendarbeit entfernen' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sammlung Organisation entfernen' })).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: 'Tags' }), '#beteiligung');
  await user.type(screen.getByRole('textbox', { name: 'Sammlungen' }), 'Weitere Sammlung');
  await user.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(async () =>
    expect((await repo.get('local', document.id))?.collections).toEqual([
      'Jugendhaus',
      'Organisation',
      'Weitere Sammlung',
    ]),
  );
  expect(tagsOf((await repo.get('local', document.id))!.content)).toEqual([
    'konzeption',
    'jugendarbeit',
    'beteiligung',
  ]);
  expect(state.sync).toHaveBeenCalled();
});
it('adds tags with Enter without submitting the form and lets users remove individual assignments', async () => {
  const bytes = new TextEncoder().encode('Text');
  const attachment = await repo.addDocument('local', {
    name: 'Plan.txt',
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as File);
  const document = await createDocument('local', attachment, ['Jugendhaus', 'Organisation'], ['alt']);
  state.notes = [document];
  render(
    <Theme theme={neutralTheme}>
      <DocumentDetail note={document} onOpen={vi.fn()} />
    </Theme>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox', { name: 'Tags' }), '#neu{Enter}');
  expect(screen.getByRole('button', { name: 'Tag neu entfernen' })).toBeTruthy();
  expect((await repo.get('local', document.id))?.revision).toBe(document.revision);
  await user.click(screen.getByRole('button', { name: 'Tag alt entfernen' }));
  await user.click(screen.getByRole('button', { name: 'Sammlung Organisation entfernen' }));
  await user.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  await waitFor(async () =>
    expect((await repo.get('local', document.id))?.collections).toEqual(['Jugendhaus']),
  );
  expect(tagsOf((await repo.get('local', document.id))!.content)).toEqual(['neu']);
});
