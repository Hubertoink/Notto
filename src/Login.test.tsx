// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login, WebAccess } from './Login';
const state = vi.hoisted(() => ({ user: null as null | { id: string }, authReady: true }));
const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signUp: vi.fn() }));
vi.mock('./state', () => ({ useNotto: () => state }));
vi.mock('./repository', () => ({ desktop: false }));
vi.mock('./cloud', () => ({ cloud: () => ({ auth }), ownBackend: () => true }));
vi.mock('./components', () => ({
  Action: ({ label, isDisabled, type }: any) => (
    <button disabled={isDisabled} type={type}>
      {label}
    </button>
  ),
}));
beforeEach(() => {
  state.user = null;
  state.authReady = true;
  vi.clearAllMocks();
});
afterEach(cleanup);
it('never mounts the notebook before session resolution and returns to login after logout', () => {
  state.authReady = false;
  const { rerender } = render(
    <WebAccess>
      <div>Private notes</div>
    </WebAccess>,
  );
  expect(screen.queryByText('Private notes')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Noto wird geöffnet');
  state.authReady = true;
  rerender(
    <WebAccess>
      <div>Private notes</div>
    </WebAccess>,
  );
  expect(screen.queryByText('Private notes')).toBeNull();
  expect(screen.getByRole('button', { name: 'Anmelden' })).toBeTruthy();
  state.user = { id: 'owner' };
  rerender(
    <WebAccess>
      <div>Private notes</div>
    </WebAccess>,
  );
  expect(screen.getByText('Private notes')).toBeTruthy();
  state.user = null;
  rerender(
    <WebAccess>
      <div>Private notes</div>
    </WebAccess>,
  );
  expect(screen.queryByText('Private notes')).toBeNull();
});
it('submits login credentials and surfaces an authentication failure', async () => {
  auth.signInWithPassword.mockResolvedValue({ error: new Error('Anmeldung fehlgeschlagen.') });
  const user = userEvent.setup();
  render(<Login />);
  await user.type(screen.getByLabelText('E-Mail'), 'owner@example.com');
  await user.type(screen.getByLabelText('Passwort'), 'test-password-123');
  await user.click(screen.getByRole('button', { name: 'Anmelden' }));
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'owner@example.com',
    password: 'test-password-123',
  });
  expect(screen.getByRole('alert').textContent).toContain('Anmeldung fehlgeschlagen');
});
it('requires matching passwords and forwards the invitation on registration', async () => {
  auth.signUp.mockResolvedValue({ data: { session: { user: { id: 'new' } } }, error: null });
  const user = userEvent.setup();
  render(<Login />);
  await user.click(screen.getByRole('button', { name: 'Konto einrichten' }));
  await user.type(screen.getByLabelText('E-Mail'), 'owner@example.com');
  await user.type(screen.getByLabelText('Passwort', { exact: true }), 'test-password-123');
  await user.type(screen.getByLabelText('Passwort wiederholen'), 'wrong-password');
  await user.type(screen.getByLabelText(/Einrichtungscode/), 'invite-123');
  await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));
  expect(auth.signUp).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('nicht überein');
  await user.clear(screen.getByLabelText('Passwort wiederholen'));
  await user.type(screen.getByLabelText('Passwort wiederholen'), 'test-password-123');
  await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));
  expect(auth.signUp).toHaveBeenCalledWith({
    email: 'owner@example.com',
    password: 'test-password-123',
    options: { data: { invite: 'invite-123' } },
  });
});
