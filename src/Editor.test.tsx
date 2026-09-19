// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { Editor } from './Editor';
import { NottoProvider } from './state';
import { db, repo } from './repository';
import { newNote } from './domain';
import { knowledge } from './intelligence';
import * as intelligence from './intelligence';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
beforeAll(() => {
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
  await knowledge.append({ ...note, revision: 'old-revision' }, 'analysis', { suggestions: [] });
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
