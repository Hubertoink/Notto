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
import { newNote, reviseNote, tagsOf, titleOf, type Note } from './domain';
import { updateDocumentMetadata } from './document-metadata';
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('starts with compact assignments and automatically saves tags and multiple collections', async () => {
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
  expect(screen.queryByRole('textbox', { name: 'Tags' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Sammlungen' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tag konzeption entfernen' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Änderungen speichern' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Tags bearbeiten' }));
  await user.click(screen.getByRole('button', { name: 'jugendarbeit' }));
  await user.click(screen.getByRole('button', { name: 'Sammlungen bearbeiten' }));
  await user.click(screen.getByRole('button', { name: 'Organisation' }));
  expect(screen.getByRole('button', { name: 'Tag jugendarbeit entfernen' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sammlung Organisation entfernen' })).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: 'Tags' }), '#beteiligung{Enter}');
  await user.type(screen.getByRole('textbox', { name: 'Sammlungen' }), 'Weitere Sammlung');
  await user.click(screen.getByRole('button', { name: 'Sammlung hinzufügen' }));
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
  await waitFor(() => expect(state.sync).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: 'Tags-Bearbeitung schließen' }));
  expect(screen.queryByRole('textbox', { name: 'Tags' })).toBeNull();
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
  await user.click(screen.getByRole('button', { name: 'Tags bearbeiten' }));
  await user.type(screen.getByRole('textbox', { name: 'Tags' }), '#neu{Enter}');
  expect(screen.getByRole('button', { name: 'Tag neu entfernen' })).toBeTruthy();
  await waitFor(async () => expect(tagsOf((await repo.get('local', document.id))!.content)).toContain('neu'));
  await user.click(screen.getByRole('button', { name: 'Tag alt entfernen' }));
  await user.click(screen.getByRole('button', { name: 'Sammlungen bearbeiten' }));
  await user.click(screen.getByRole('button', { name: 'Sammlung Organisation entfernen' }));
  await waitFor(async () =>
    expect((await repo.get('local', document.id))?.collections).toEqual(['Jugendhaus']),
  );
  expect(tagsOf((await repo.get('local', document.id))!.content)).toEqual(['neu']);
});

async function fixture() {
  const bytes = new TextEncoder().encode('Dokumenttext');
  const attachment = await repo.addDocument('local', {
    name: 'Artikel.txt',
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer,
  } as File);
  const note = await createDocument('local', attachment, ['Team'], ['konzeption']);
  state.notes = [note];
  return note;
}
it('merges assignment changes with the latest stored document and retains provenance and extra links', async () => {
  const note = await fixture();
  const source = {
    url: 'https://example.org/article',
    pdfUrl: 'https://example.org/a.pdf',
    title: 'Artikel',
    importedAt: note.createdAt,
    doi: '10.1234/article',
  };
  const current = reviseNote(note, {
    content:
      note.content + '\n\nQuelle: Original\n\n[Weitere PDF](attachments/other.pdf)\n\n[Notiz](notes/other)',
    collections: ['Team', 'Parallel'],
    document: { ...note.document!, source },
  });
  await repo.put(current, note.revision);
  await Promise.all([
    updateDocumentMetadata(note, {
      kind: 'tags',
      before: ['konzeption'],
      after: ['konzeption', 'jugendarbeit'],
    }),
    updateDocumentMetadata(note, { kind: 'collections', before: ['Team'], after: ['Team', 'Jugendhaus'] }),
    updateDocumentMetadata(note, { title: 'Unser Artikel' }),
  ]);
  const saved = (await repo.get('local', note.id))!;
  expect(saved.collections).toEqual(['Team', 'Parallel', 'Jugendhaus']);
  expect(tagsOf(saved.content)).toEqual(['konzeption', 'jugendarbeit']);
  expect(titleOf(saved.content)).toBe('Unser Artikel');
  expect(saved.document?.source).toEqual(source);
  expect(saved.content).toContain('[Weitere PDF](attachments/other.pdf)');
  expect(saved.content).toContain('[Notiz](notes/other)');
});
it('saves titles on leaving the field and lets a corrected title replace an invalid draft', async () => {
  const note = await fixture();
  render(
    <Theme theme={neutralTheme}>
      <DocumentDetail note={note} onOpen={vi.fn()} />
    </Theme>,
  );
  const user = userEvent.setup();
  const input = screen.getByRole('textbox', { name: 'Titel' });
  await user.clear(input);
  await user.tab();
  await screen.findByText('Der Titel darf nicht leer sein.');
  expect(titleOf((await repo.get('local', note.id))!.content)).toBe('Artikel.txt');
  await user.type(input, 'Unser Artikel{Enter}');
  await waitFor(async () =>
    expect(titleOf((await repo.get('local', note.id))!.content)).toBe('Unser Artikel'),
  );
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Änderung erneut speichern' })).toBeNull());
});
it('retains a failed assignment draft and saves it when retried', async () => {
  const note = await fixture();
  render(
    <Theme theme={neutralTheme}>
      <DocumentDetail note={note} onOpen={vi.fn()} />
    </Theme>,
  );
  const put = vi.spyOn(repo, 'put').mockRejectedValue(new Error('Speicher nicht verfügbar'));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Tags bearbeiten' }));
  await user.type(screen.getByRole('textbox', { name: 'Tags' }), '#neu{Enter}');
  await screen.findByText('Nicht gespeichert');
  expect(screen.getByRole('button', { name: 'Tag neu entfernen' })).toBeTruthy();
  expect(tagsOf((await repo.get('local', note.id))!.content)).not.toContain('neu');
  put.mockRestore();
  await user.click(screen.getByRole('button', { name: 'Änderung erneut speichern' }));
  await waitFor(async () => expect(tagsOf((await repo.get('local', note.id))!.content)).toContain('neu'));
  await screen.findByText('Gespeichert');
});
it('lets a later removal supersede an earlier failed addition', async () => {
  const note = await fixture();
  render(
    <Theme theme={neutralTheme}>
      <DocumentDetail note={note} onOpen={vi.fn()} />
    </Theme>,
  );
  const put = vi.spyOn(repo, 'put').mockRejectedValue(new Error('Speicher nicht verfügbar'));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Tags bearbeiten' }));
  await user.type(screen.getByRole('textbox', { name: 'Tags' }), '#neu{Enter}');
  await screen.findByText('Nicht gespeichert');
  put.mockRestore();
  await user.click(screen.getByRole('button', { name: 'Tag neu entfernen' }));
  await screen.findByText('Gespeichert');
  expect(tagsOf((await repo.get('local', note.id))!.content)).toEqual(['konzeption']);
  expect(screen.queryByRole('button', { name: 'Änderung erneut speichern' })).toBeNull();
});
