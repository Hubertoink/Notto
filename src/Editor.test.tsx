// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { Editor } from './Editor';
import { MemorySettings } from './Memory';
import { memoryState } from './memory-policy';
import { NottoProvider } from './state';
import { db, repo } from './repository';
import { newNote } from './domain';
import { knowledge } from './intelligence';
import * as intelligence from './intelligence';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeAll(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
beforeEach(async () => {
  localStorage.clear();
  await db.notes.clear();
  await db.drafts.clear();
  await db.knowledge.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function renderEditor(saved = vi.fn()) {
  return render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor onSaved={saved} />
      </NottoProvider>
    </Theme>,
  );
}
it('opens and saves a widget draft in the main editor without consuming the other draft', async () => {
  const draft = {
    key: 'local:widget',
    scope: 'local',
    noteId: 'widget',
    content: 'Gedanke aus dem Widget',
    baseRevision: null,
    updatedAt: new Date().toISOString(),
  };
  await repo.saveDraft(draft);
  await repo.saveDraft({ ...draft, key: 'local:new', noteId: null, content: 'Anderer Entwurf' });
  const saved = vi.fn();
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor draftSource="widget" onSaved={saved} />
      </NottoProvider>
    </Theme>,
  );
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement).value).toBe(
      draft.content,
    ),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Festhalten' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(await repo.draft('local', 'widget')).toBeUndefined();
  expect((await repo.draft('local', null))?.content).toBe('Anderer Entwurf');
});
it('saves, edits and forgets personal instructions in the settings surface', async () => {
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <MemorySettings />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  expect(screen.getByRole('region', { name: 'Projektwissen & Kontext' })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Das hat Noto gelernt' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Anweisung hinzufügen' }));
  let input = screen.getByRole('textbox', { name: 'Kontexteintrag' });
  await user.type(input, 'Bitte knapp antworten.');
  await user.click(screen.getByRole('button', { name: 'Eintrag speichern' }));
  expect(await screen.findByText('Bitte knapp antworten.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  input = screen.getByRole('textbox', { name: 'Kontexteintrag' });
  await user.clear(input);
  await user.type(input, 'Bitte sachlich antworten.');
  await user.click(screen.getByRole('button', { name: 'Änderungen speichern' }));
  expect(await screen.findByText('Bitte sachlich antworten.')).toBeTruthy();
  expect(screen.queryByText('Bitte knapp antworten.')).toBeNull();
  await user.click(screen.getByText('Details & Verwaltung'));
  await user.click(screen.getByRole('button', { name: 'Vergessen' }));
  await waitFor(() => expect(screen.queryByText('Bitte sachlich antworten.')).toBeNull());
  expect(memoryState(await knowledge.list('local'), 'local').entries).toEqual([]);
  await user.click(screen.getByRole('button', { name: 'Pausieren' }));
  expect(await screen.findByText('Personalisierung pausiert')).toBeTruthy();
});
it('opens inline AI annotations and completes a task without changing the note', async () => {
  const note = newNote('local', 'Steam einrichten');
  await repo.put(note, null);
  await knowledge.append(note, 'analysis', {
    suggestions: [{ kind: 'task', title: 'Steam einrichten', detail: 'Vier PCs', quote: note.content }],
  });
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /KI-Anmerkungen/ }));
  const checkbox = await screen.findByRole('checkbox', { name: 'Steam einrichten erledigt' });
  await user.click(checkbox);
  await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(true));
  expect(await repo.get('local', note.id)).toEqual(note);
});
it('refreshes outdated annotations from the saved revision and closes through the icon', async () => {
  const note = newNote('local', 'Aktuelle Fassung');
  await repo.put(note, null);
  await knowledge.append({ scope: note.scope, id: note.id, revision: 'old-revision' }, 'analysis', {
    suggestions: [],
  });
  const analyze = vi.spyOn(intelligence, 'analyze').mockImplementation(async (n) => {
    await knowledge.append(n, 'analysis', { suggestions: [] });
  });
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /KI-Anmerkungen/ }));
  await screen.findByText(/frühere Textversion/);
  await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
  await waitFor(() => expect(analyze).toHaveBeenCalledWith(note));
  await waitFor(() => expect(screen.queryByText(/frühere Textversion/)).toBeNull());
  expect(await repo.get('local', note.id)).toEqual(note);
  await user.click(screen.getByRole('button', { name: 'Anmerkungen schließen' }));
  expect(screen.getByRole('button', { name: /KI-Anmerkungen/ }).getAttribute('aria-expanded')).toBe('false');
});
it('recovers an unfinished draft after closing and saves its exact text', async () => {
  const user = userEvent.setup();
  const initial = renderEditor();
  const field = await screen.findByRole('textbox', { name: 'Notiztext' });
  await waitFor(() => expect((field as HTMLTextAreaElement).disabled).toBe(false));
  await user.type(field, '#medien\nSteam Families für vier PCs prüfen.');
  await waitFor(async () =>
    expect((await repo.draft('local', null))?.content).toBe('#medien\nSteam Families für vier PCs prüfen.'),
  );
  initial.unmount();
  const saved = vi.fn();
  renderEditor(saved);
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      '#medien\nSteam Families für vier PCs prüfen.',
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Festhalten' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect((await repo.list('local'))[0].content).toBe('#medien\nSteam Families für vier PCs prüfen.');
  expect(await repo.draft('local', null)).toBeUndefined();
});
it('keeps one save icon while writing and turns green after a quiet interval', async () => {
  const user = userEvent.setup();
  renderEditor();
  const field = await screen.findByRole('textbox', { name: 'Notiztext' });
  await waitFor(() => expect((field as HTMLTextAreaElement).disabled).toBe(false));
  await user.type(field, 'Ein Gedanke');
  const status = screen.getByRole('status', { name: 'Entwurf wird gesichert …' });
  expect(status.textContent).toBe('');
  expect(status.classList.contains('save-writing')).toBe(true);
  expect(status.querySelector('svg')).not.toBeNull();
  await waitFor(() => expect(status.classList.contains('save-saved')).toBe(true), { timeout: 1800 });
  await user.type(field, '!');
  expect(status.classList.contains('save-writing')).toBe(true);
  expect(screen.getByRole('button', { name: 'Festhalten' }).classList.contains('notto-action')).toBe(true);
});
it('waits for an image to finish persisting before allowing the note to be saved', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  const view = renderEditor(saved);
  const field = await screen.findByRole('textbox', { name: 'Notiztext' });
  await waitFor(() => expect((field as HTMLTextAreaElement).disabled).toBe(false));
  await user.type(field, 'Mit Bild');
  let finish!: (value: string) => void;
  vi.spyOn(repo, 'addImage').mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['image'], 'bild.png', { type: 'image/png' }));
  expect((screen.getByRole('button', { name: 'Festhalten' }) as HTMLButtonElement).disabled).toBe(true);
  finish('![Bild](attachments/abc-123.png)');
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Festhalten' }) as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(screen.getByRole('button', { name: 'Festhalten' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect((await repo.list('local'))[0].content).toContain('attachments/abc-123.png');
});

it('suggests existing tags and accepts a prefix match with the keyboard', async () => {
  await repo.put(
    newNote('local', '#jugendarbeit #jugendhaus #medien #konzeption #technologie #spiele'),
    null,
  );
  renderEditor();
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' });
  await waitFor(() => expect((field as HTMLTextAreaElement).disabled).toBe(false));
  await user.type(field, '#');
  expect(await screen.findAllByRole('option')).toHaveLength(5);
  await user.type(field, 'Jugend');
  expect(screen.getAllByRole('option')).toHaveLength(2);
  await user.keyboard('{ArrowDown}{Enter}');
  expect((field as HTMLTextAreaElement).value).toBe('#jugendhaus ');
  expect(screen.queryByRole('listbox')).toBeNull();
  await user.type(field, '#neuertag ');
  expect((field as HTMLTextAreaElement).value).toBe('#jugendhaus #neuertag ');
});

it('formats selected text through icons and keeps editing at the selection', async () => {
  renderEditor();
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, 'Hallo Welt');
  field.setSelectionRange(6, 10);
  fireEvent.click(screen.getByRole('button', { name: 'Fett (Strg B)' }));
  expect(field.value).toBe('Hallo **Welt**');
  expect(field.selectionStart).toBe(8);
  expect(field.selectionEnd).toBe(12);
  await user.keyboard('{Control>}b{/Control}');
  expect(field.value).toBe('Hallo Welt');
});

it('inserts a note reference with keyboard selection and shows current titles after renaming', async () => {
  const target = newNote('local', 'Unsere Grundsätze');
  await repo.put(target, null);
  renderEditor();
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, 'Siehe ');
  fireEvent.click(screen.getByRole('button', { name: 'Notiz verlinken' }));
  await screen.findByRole('option', { name: 'Unsere Grundsätze' });
  await user.keyboard('{Enter}');
  expect(field.value).toBe(`Siehe [Unsere Grundsätze](notes/${target.id}) `);
  await repo.put({ ...target, revision: crypto.randomUUID(), content: 'Neue Grundsätze' }, target.revision);
  await user.click(screen.getByRole('button', { name: 'Vorschau' }));
  await screen.findAllByRole('link', { name: '↗ Neue Grundsätze' });
});

it('retains collections in drafts and saves several memberships with the note', async () => {
  const saved = vi.fn();
  const view = renderEditor(saved);
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, 'Projektplanung');
  await user.click(screen.getByRole('button', { name: 'Sammlungen' }));
  for (const name of ['Jugendhaus', 'Medien']) {
    await user.type(screen.getByRole('textbox', { name: 'Sammlung' }), name);
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
  }
  await waitFor(async () =>
    expect((await repo.draft('local', null))?.collections).toEqual(['Jugendhaus', 'Medien']),
  );
  view.unmount();
  renderEditor(saved);
  await screen.findByText('Jugendhaus');
  await user.click(screen.getByRole('button', { name: 'Festhalten' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(saved.mock.calls[0][0].collections).toEqual(['Jugendhaus', 'Medien']);
});

it('keeps an unsaved text draft when a drop adds a collection to the open note', async () => {
  const original = newNote('local', 'Originaltext');
  await repo.put(original, null);
  const saved = vi.fn();
  const renderNote = (note: typeof original) => (
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={saved} />
      </NottoProvider>
    </Theme>
  );
  const view = render(renderNote(original));
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, ' mit Entwurf');
  const updated = { ...original, collections: ['Jugendhaus'], revision: crypto.randomUUID() };
  await repo.put(updated, original.revision);
  view.rerender(renderNote(updated));
  await screen.findByText('Jugendhaus');
  expect(field.value).toBe('Originaltext mit Entwurf');
  await user.click(screen.getByRole('button', { name: 'Festhalten' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(saved.mock.calls[0][0].collections).toEqual(['Jugendhaus']);
  expect(saved.mock.calls[0][0].content).toBe('Originaltext mit Entwurf');
});
