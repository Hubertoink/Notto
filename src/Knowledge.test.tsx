// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Knowledge } from './Knowledge';
import { config, defaults } from './intelligence';
const api = vi.hoisted(() => vi.fn());
vi.mock('./backend', () => ({ serverRequest: api }));
vi.mock('./cloud', () => ({
  ownBackend: () => true,
  readCloudConfig: () => ({ url: 'https://noto-app.de' }),
  cloud: vi.fn(),
  fetchAttachment: vi.fn(),
}));
vi.mock('./repository', () => ({ desktop: false, db: {}, repo: {} }));
vi.mock('./state', () => ({ useNotto: () => ({ scope: 'account', notes: [] }) }));
vi.mock('./components', () => ({
  Action: ({ label, onClick, isDisabled }: any) => (
    <button onClick={onClick} disabled={isDisabled}>
      {label}
    </button>
  ),
  Modal: ({ children }: any) => <div role="dialog">{children}</div>,
  NoteMarkdown: () => null,
  readableDate: () => '',
}));
vi.mock('./intelligence', async (original) => {
  const actual = await original<typeof import('./intelligence')>();
  return { ...actual, knowledge: { ...actual.knowledge, list: async () => [] } };
});
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);
it('renders in the page, saves only explicitly, retains failures and reloads confirmed account settings', async () => {
  let remote = { ...defaults };
  let fail = true;
  api.mockImplementation(async (_url: string, path: string, body?: typeof defaults) => {
    if (body) {
      if (fail) throw new Error('Verbindung unterbrochen');
      remote = body;
      return { ok: true };
    }
    if (path === '/ai/settings') return { config: remote, configured: true };
    if (path === '/ai/models') return { models: ['gpt-4.1-mini', 'gpt-5-mini'] };
    return { jobs: [] };
  });
  const user = userEvent.setup();
  const view = render(<Knowledge onOpen={() => {}} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getAllByRole('button', { name: 'KI einrichten' })[0]);
  const model = await screen.findByRole('combobox', { name: 'Analysemodell' });
  await waitFor(() => expect((model as HTMLSelectElement).disabled).toBe(false));
  await user.selectOptions(model, 'gpt-5-mini');
  await user.click(screen.getByLabelText('KI für dieses Notizbuch aktivieren'));
  expect(api.mock.calls.filter((call) => call[2])).toHaveLength(0);
  expect(config('account').enabled).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
  await screen.findByText(/Nicht gespeichert: Verbindung unterbrochen/);
  expect(config('account').model).toBe('gpt-4.1-mini');
  expect((model as HTMLSelectElement).value).toBe('gpt-5-mini');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
  await screen.findByText('KI-Einstellungen im Konto gespeichert.');
  expect(config('account')).toMatchObject({ model: 'gpt-5-mini', enabled: true });
  view.unmount();
  render(<Knowledge onOpen={() => {}} />);
  await user.click(screen.getAllByRole('button', { name: 'KI einrichten' })[0]);
  await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('gpt-5-mini'));
  expect((screen.getByLabelText('KI für dieses Notizbuch aktivieren') as HTMLInputElement).checked).toBe(
    true,
  );
  await user.click(screen.getByRole('button', { name: 'Mein Kontext' }));
  expect(await screen.findByRole('button', { name: 'Information hinzufügen' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Überblick' }));
  expect(screen.getByRole('table', { name: 'Notizen und Analysestatus' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Kontakte' }));
  expect(screen.queryByText(/Gespeicherte Entscheidungen/)).toBeNull();
});
