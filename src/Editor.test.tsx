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
import { newNote, reviseNote, contentRevision } from './domain';
import { knowledge } from './intelligence';
import * as intelligence from './intelligence';
import * as rewriting from './rewrite';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
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
it('edits and formats text after an inline image without changing its reference', async () => {
  renderEditor();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  fireEvent.change(field, { target: { value: 'Titel\n\n![Foto](attachments/abc.png)\n\nDanach' } });
  const fields = screen.getAllByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement[];
  expect(fields).toHaveLength(2);
  const after = fields[1];
  fireEvent.focus(after);
  after.setSelectionRange(2, 8);
  fireEvent.click(screen.getByRole('button', { name: 'Fett (Strg B)' }));
  expect(after.value).toBe('\n\n**Danach**');
  expect(screen.getByRole('button', { name: 'Foto bearbeiten' })).toBeTruthy();
});
it('saves image deletion from its visual control into the note text', async () => {
  renderEditor();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  fireEvent.change(field, {
    target: { value: 'Titel\n\n![Foto](attachments/abc.png "noto:width=50;mode=thumbnail")\n\nDanach' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Foto bearbeiten' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bild aus Notiz entfernen' }));
  expect((screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement).value).toBe(
    'Titel\n\n\n\nDanach',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Festhalten' }));
  await waitFor(async () => expect((await repo.list('local'))[0]?.content).toBe('Titel\n\n\n\nDanach'));
});
it('applies a rewrite only to the draft and can restore the original wording', async () => {
  vi.spyOn(rewriting, 'rewriteNote').mockResolvedValue('Ein lesbarer Gedanke.');
  renderEditor();
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, 'gedanke kurz');
  await user.click(screen.getByRole('button', { name: 'Mit KI überarbeiten' }));
  await waitFor(() => expect(field.value).toBe('Ein lesbarer Gedanke.'));
  expect(await repo.list('local')).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'KI-Überarbeitung rückgängig' }));
  expect(field.value).toBe('gedanke kurz');
});
it('discards a delayed rewrite when the user has continued typing', async () => {
  let finish!: (text: string) => void;
  vi.spyOn(rewriting, 'rewriteNote').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderEditor();
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, 'gedanke');
  await user.click(screen.getByRole('button', { name: 'Mit KI überarbeiten' }));
  await user.type(field, ' weiter');
  finish('Alter Vorschlag');
  await screen.findByText('Der Text wurde inzwischen geändert. Bitte die Überarbeitung erneut starten.');
  expect(field.value).toBe('gedanke weiter');
});
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
  await knowledge.append(note, 'research', { text: 'Recherche bleibt erhalten.', sources: [] });
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  const annotations = await screen.findByRole('button', { name: /KI-Anmerkungen/ });
  await screen.findByRole('button', { name: 'Aufgaben offen: 1' });
  expect(screen.getByRole('button', { name: 'Recherche vorhanden: 1' })).toBeTruthy();
  expect(screen.getByText('Offene Aufgaben anzeigen')).toBeTruthy();
  expect(screen.getByText('Rechercheergebnisse anzeigen')).toBeTruthy();
  const collections = screen.getByRole('button', { name: /Sammlungen/ });
  const originalText = screen.getByText('Steam einrichten', { selector: 'p' });
  expect(collections.compareDocumentPosition(annotations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.click(annotations);
  expect(originalText.isConnected).toBe(true);
  expect(collections.compareDocumentPosition(annotations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const checkbox = await screen.findByRole('checkbox', { name: 'Steam einrichten erledigt' });
  await user.click(checkbox);
  await waitFor(() =>
    expect(
      (screen.getByRole('checkbox', { name: 'Steam einrichten erledigt' }) as HTMLInputElement).checked,
    ).toBe(true),
  );
  await screen.findByRole('button', { name: 'Aufgaben erledigt: 1' });
  expect(screen.queryByRole('button', { name: /Aufgaben offen/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: '1 Recherche vorhanden' }));
  await waitFor(() => expect(document.activeElement?.textContent).toContain('Recherche bleibt erhalten.'));
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '1 Aufgaben erledigt' }));
  await waitFor(() => expect(document.activeElement?.textContent).toContain('Erledigte Aufgaben'));
  expect(await repo.get('local', note.id)).toEqual(note);
});
it('shares one annotation shell with a keyboard accessible commands tab', async () => {
  const note = newNote('local', 'Notiz\n/ki Recherchiere Quellen');
  await repo.put(note, null);
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /KI-Anmerkungen/ }));
  expect(screen.getByRole('tab', { name: 'Aufträge' }).getAttribute('aria-selected')).toBe('true');
  expect(document.querySelector('.editor-body .note-commands')).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'Anmerkungen' }));
  expect(screen.getByRole('tabpanel', { name: 'Anmerkungen' })).toBeTruthy();
  expect(screen.queryByRole('tabpanel', { name: 'Aufträge' })).toBeNull();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tabpanel', { name: 'Aufträge' })).toBeTruthy();
});
it('merges server prompt cleanup into an unsaved draft without losing text', async () => {
  const note = newNote('local', 'Gedanken\n/ki Suche Rezensionen\n');
  await repo.put(note, null);
  const saved = vi.fn();
  const renderNote = (n: typeof note) => (
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={n} onSaved={saved} />
      </NottoProvider>
    </Theme>
  );
  const view = render(renderNote(note));
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
  const input = await screen.findByRole('textbox', { name: 'Notiztext' });
  fireEvent.change(input, { target: { value: note.content + 'Mein neuer Absatz' } });
  const cleaned = reviseNote(note, { content: 'Gedanken\n' });
  await repo.put(cleaned, note.revision);
  view.rerender(renderNote(cleaned));
  await waitFor(() =>
    expect((screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement).value).toBe(
      'Gedanken\nMein neuer Absatz',
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Festhalten' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect((await repo.get('local', note.id))?.content).toBe('Gedanken\nMein neuer Absatz');
});
it('shows a PDF reading note with its source page in AI annotations', async () => {
  const id = `${crypto.randomUUID()}.pdf`;
  const note = newNote('local', `Gedanken zum Artikel\n[Artikel](attachments/${id})`);
  await repo.put(note, null);
  await knowledge.append(note, 'extraction', {
    id,
    pages: [
      {
        noteId: note.id,
        revision: note.revision,
        attachment: id,
        page: 3,
        text: 'Jugendliche gestalten den Raum.',
      },
    ],
  });
  await knowledge.append(note, 'analysis', {
    suggestions: [
      {
        kind: 'insight',
        title: 'Mitgestaltung',
        detail: 'Die Aussage passt zur Raumplanung.',
        quote: 'Jugendliche gestalten den Raum.',
      },
    ],
  });
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  await userEvent.setup().click(await screen.findByRole('button', { name: /KI-Anmerkungen/ }));
  expect(await screen.findByText('Mitgestaltung')).toBeTruthy();
  expect(screen.getByText('Jugendliche gestalten den Raum.')).toBeTruthy();
  expect(screen.getByText(/Seite 3/)).toBeTruthy();
});
it('saves checklist changes directly from reading mode as text revisions', async () => {
  const note = newNote('local', 'Essensliste\n\n- [ ] Toilettenpapier\n- [x] Milch');
  await repo.put(note, null);
  const saved = vi.fn();
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={saved} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  await screen.findByRole('checkbox', { name: 'Toilettenpapier erledigen' });
  await waitFor(() =>
    expect(
      (screen.getByRole('checkbox', { name: 'Toilettenpapier erledigen' }) as HTMLInputElement).disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole('checkbox', { name: 'Toilettenpapier erledigen' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  const updated = (await repo.get('local', note.id))!;
  expect(updated.content).toContain('- [x] Toilettenpapier');
  expect(updated.history.at(-2)?.content).toBe(note.content);
  await screen.findByRole('checkbox', { name: 'Milch wieder öffnen' });
  await waitFor(() =>
    expect((screen.getByRole('checkbox', { name: 'Milch wieder öffnen' }) as HTMLInputElement).disabled).toBe(
      false,
    ),
  );
  await user.click(screen.getByRole('checkbox', { name: 'Milch wieder öffnen' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect((await repo.get('local', note.id))?.content).toContain('- [ ] Milch');
});
it('accepts a supported theory link and exposes a backlink on the target note', async () => {
  const source = newNote('local', 'Unser Konzept braucht ein gemeinsames Leitbild.');
  const target = newNote('local', 'Leitbildentwicklung: gemeinsame Werte und Beteiligung.');
  await repo.put(source, null);
  await repo.put(target, null);
  await knowledge.append(source, 'note-relations', {
    checked: [],
    suggestions: [
      {
        sourceId: source.id,
        targetId: target.id,
        sourceRevision: contentRevision(source),
        targetRevision: contentRevision(target),
        relation: 'theory',
        reason: 'Das Kapitel liefert eine theoretische Grundlage.',
        sourceQuote: source.content,
        targetQuote: target.content,
        anchor: 'gemeinsames Leitbild',
      },
    ],
  });
  const saved = vi.fn();
  const view = render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={source} onSaved={saved} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Verlinkungen offen: 1' }));
  await waitFor(() => expect(document.activeElement?.textContent).toContain('Offene Verlinkungen'));
  await user.click(await screen.findByRole('button', { name: 'Verknüpfung übernehmen' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect((await repo.get('local', source.id))?.content).toBe(
    `Unser Konzept braucht ein [gemeinsames Leitbild](notes/${target.id}?type=theory).`,
  );
  const updatedSource = (await repo.get('local', source.id))!;
  view.rerender(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={updatedSource} onSaved={saved} />
      </NottoProvider>
    </Theme>,
  );
  await user.click(await screen.findByRole('button', { name: 'Verlinkungen übernommen: 1' }));
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain('bereits im Notiztext eingefügt'),
  );
  expect(screen.queryByRole('button', { name: /Verlinkungen offen/ })).toBeNull();
  view.unmount();
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={target} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  await user.click(await screen.findByText('Rückverweise · 1'));
  expect(await screen.findByRole('link', { name: /Unser Konzept braucht/ })).toBeTruthy();
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
  await waitFor(() => expect(screen.getAllByText('Prüfung veraltet')).toHaveLength(2));
  await user.click(screen.getByRole('button', { name: 'Aktualisieren' }));
  await waitFor(() => expect(analyze).toHaveBeenCalledWith(note));
  await waitFor(() => expect(screen.queryAllByText('Prüfung veraltet')).toHaveLength(0));
  expect(screen.getAllByText(/Geprüft · keine Hinweise/).length).toBeGreaterThan(0);
  expect(await repo.get('local', note.id)).toEqual(note);
  await user.click(screen.getByRole('button', { name: 'Anmerkungen schließen' }));
  expect(screen.getByRole('button', { name: /KI-Anmerkungen/ }).getAttribute('aria-expanded')).toBe('false');
});
it('distinguishes an unreviewed note from a checked note without suggestions', async () => {
  const note = newNote('local', 'Eine Notiz ohne offene Aufgaben');
  await repo.put(note, null);
  const view = render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  await userEvent.setup().click(await screen.findByRole('button', { name: /KI-Anmerkungen/ }));
  expect(screen.getAllByText('Noch kein Prüfergebnis')).toHaveLength(2);
  expect(screen.queryByText('Geprüft · keine Hinweise')).toBeNull();
  view.unmount();
  await knowledge.append(note, 'analysis', { suggestions: [] });
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  await userEvent.setup().click(await screen.findByRole('button', { name: /KI-Anmerkungen/ }));
  expect(screen.getAllByText('Geprüft · keine Hinweise')).toHaveLength(2);
  expect(screen.getByText(/Diese Textversion wurde am/)).toBeTruthy();
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
  expect(screen.getByRole('button', { name: 'Festhalten' }).getAttribute('aria-disabled')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Festhalten' }));
  expect(saved).not.toHaveBeenCalled();
  finish('![Bild](attachments/abc-123.png)');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Festhalten' }).getAttribute('aria-disabled')).not.toBe('true'),
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

it('inserts a note reference and retains its saved label after renaming', async () => {
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
  await screen.findAllByRole('link', { name: '↗ Unsere Grundsätze' });
});

it('uses selected text as the label when linking a note', async () => {
  const target = newNote('local', 'Unsere Grundsätze');
  await repo.put(target, null);
  renderEditor();
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, 'Zum Islam');
  field.setSelectionRange(4, 9);
  fireEvent.click(screen.getByRole('button', { name: 'Notiz verlinken' }));
  await screen.findByRole('option', { name: 'Unsere Grundsätze' });
  await user.keyboard('{Enter}');
  expect(field.value).toBe(`Zum [Islam](notes/${target.id}) `);
});

it('undoes the latest editor change with Ctrl+Z', async () => {
  renderEditor();
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, 'Rückgängig');
  fireEvent.keyDown(field, { key: 'z', code: 'KeyZ', ctrlKey: true });
  expect(field.value).toBe('');
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

it('does not offer conflict actions for a failed AI rewrite', async () => {
  const note = newNote('local', 'Ein Gedanke #privat');
  await repo.put(note, null);
  vi.spyOn(rewriting, 'rewriteNote').mockRejectedValue(
    new Error('Der Tag #privat schließt diese Notiz von der KI aus.'),
  );
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={vi.fn()} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Mit KI überarbeiten' });
  await waitFor(() => expect(button.getAttribute('disabled')).toBeNull());
  await user.click(button);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Als aktuelle Version übernehmen' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Als neue Notiz sichern' })).toBeNull();
  expect((await repo.get('local', note.id))?.content).toBe(note.content);
});

it('overwrites an actual conflicting revision while preserving note identity and history', async () => {
  const note = newNote('local', 'Original');
  await repo.put(note, null);
  const saved = vi.fn();
  render(
    <Theme theme={neutralTheme}>
      <NottoProvider>
        <Editor note={note} onSaved={saved} />
      </NottoProvider>
    </Theme>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  const field = screen.getByRole('textbox', { name: 'Notiztext' }) as HTMLTextAreaElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  await user.type(field, ' mit Entwurf');
  const newer = reviseNote(note, { content: 'Andere Fassung' });
  await repo.put(newer, note.revision);
  await user.click(screen.getByRole('button', { name: 'Festhalten' }));
  await user.click(await screen.findByRole('button', { name: 'Als aktuelle Version übernehmen' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const result = await repo.get('local', note.id);
  expect(result?.content).toBe('Original mit Entwurf');
  expect(result?.history.some((revision) => revision.content === 'Andere Fassung')).toBe(true);
  expect(await repo.list('local')).toHaveLength(1);
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
  expect(screen.queryByRole('textbox', { name: 'Notiztext' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
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
