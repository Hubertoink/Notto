// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Organization } from './Organization';
import { newNote, reviseNote } from './domain';
import type { KnowledgeRecord } from './intelligence';
const organize = vi.hoisted(() => vi.fn());
const decide = vi.hoisted(() => vi.fn());
vi.mock('./agent', () => ({
  organizeNotebook: organize,
  decideOrganization: decide,
  organizationDecision: (records: KnowledgeRecord[], id: string, item: string) =>
    records.find(
      (r) =>
        r.kind === 'organization-decision' &&
        (r.data as any).organizationId === id &&
        (r.data as any).item === item,
    )?.data,
}));
vi.mock('./intelligence', () => ({
  config: () => ({ enabled: true, excludedNotes: [], excludedTags: 'privat' }),
}));
vi.mock('./components', () => ({
  Action: ({ label, onClick, isDisabled }: any) => (
    <button disabled={isDisabled} onClick={onClick}>
      {label}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const note = newNote('local', 'Atlas hat vier PCs');
const record: KnowledgeRecord = {
  id: 'organization',
  scope: 'local',
  noteId: 'organization',
  revision: 'run',
  kind: 'organization',
  at: '2026-09-20T10:00:00Z',
  data: {
    request: 'Ordne Atlas',
    title: 'Übersicht Atlas',
    claims: [],
    relations: [],
    insufficient: false,
    collections: [
      { name: 'Atlas', reason: 'Gehört zum Projekt Atlas', source: { index: 0, quote: 'Atlas' } },
    ],
    sources: [{ noteId: note.id, revision: note.revision, text: note.content }],
  },
};
it('shows an actionable proposal, only applies on click and exposes undo after acceptance', async () => {
  decide.mockResolvedValue(undefined);
  const props = { scope: 'local', notes: [note], records: [record], onOpen: vi.fn() };
  const view = render(<Organization {...props} />);
  expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Zuordnen' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith(record, 'collection:0', 'accepted'));
  const decision: KnowledgeRecord = {
    ...record,
    id: 'decision',
    kind: 'organization-decision',
    data: { organizationId: record.id, item: 'collection:0', status: 'accepted' },
  };
  view.rerender(<Organization {...props} records={[record, decision]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith(record, 'collection:0', 'undone'));
});
it('hides derived content when a source changes or becomes private', () => {
  const view = render(
    <Organization
      scope="local"
      notes={[reviseNote(note, { content: 'Geänderte Aussage' })]}
      records={[record]}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.queryByText('Übersicht Atlas')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Zuordnen' })).toBeNull();
  view.rerender(
    <Organization
      scope="local"
      notes={[{ ...note, content: '#privat Atlas hat vier PCs' }]}
      records={[record]}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.queryByText('Gehört zum Projekt Atlas')).toBeNull();
});
it('starts on explicit submission and cancels the active run on request', async () => {
  let finish: () => void = () => {};
  organize.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<Organization scope="local" notes={[note]} records={[]} onOpen={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ordne Atlas' } });
  expect(organize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Notizen organisieren' }));
  await screen.findByRole('button', { name: 'Abbrechen' });
  const signal = organize.mock.calls[0][2] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(signal.aborted).toBe(true);
  finish();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull());
});
