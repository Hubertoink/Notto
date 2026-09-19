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
