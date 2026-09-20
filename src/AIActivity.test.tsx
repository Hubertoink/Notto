// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AIActivity, type BackgroundJob } from './AIActivity';
afterEach(cleanup);
const job: BackgroundJob = {
  id: 'job',
  note_id: 'note',
  revision: 'old',
  kind: 'research:0',
  status: 'failed',
  error: 'Keine belegten Webquellen gefunden.',
  created_at: '2026-09-20T10:00:00Z',
};
it('does not mistake historical failures for ongoing AI work', () => {
  render(<AIActivity jobs={[job]} notes={[]} loaded error="" busy="" onOpen={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('Die KI arbeitet gerade nicht');
  expect(screen.getByText('1 frühere Probleme ansehen')).toBeTruthy();
});
it('distinguishes running work from waiting retries', () => {
  render(
    <AIActivity jobs={[{ ...job, status: 'pending' }]} notes={[]} loaded error="" busy="" onOpen={vi.fn()} />,
  );
  expect(screen.getByRole('status').textContent).toContain('Die KI arbeitet gerade nicht');
  expect(screen.getByText('Wiederholung vorgesehen')).toBeTruthy();
});
it('does not claim inactivity when the status cannot be fetched', () => {
  render(<AIActivity jobs={[]} notes={[]} loaded error="Offline" busy="" onOpen={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('nicht abrufbar');
});
