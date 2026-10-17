// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CommandPresentation from './CommandPresentation';
import type { CommandResult } from './note-command';
afterEach(cleanup);
const result: CommandResult = {
  summary: 'Gemeinsam gestalten.',
  sources: [],
  warnings: [],
  items: [
    { title: 'Beteiligung', detail: 'Alle bringen Ideen ein.', kind: 'fact' },
    { title: 'Planung', detail: 'Treffen organisieren.', kind: 'proposal' },
    { title: 'Quelle', detail: 'Die Konzeption beschreibt Beteiligung.', kind: 'inference' },
  ],
  presentation: { version: 1, source: 'root = Answer([Comparison([0,2]),Plan([1])])' },
};
const renderItem = (i: number) => <p>{result.items[i].detail}</p>;
it('uses the actual OpenUI renderer, supports text fallback and exports both the layout and individual tasks', async () => {
  const insert = vi.fn();
  render(
    <CommandPresentation
      result={result}
      fallback={<p>Normale Antwort</p>}
      renderItem={renderItem}
      onInsert={insert}
    />,
  );
  expect(await screen.findByRole('table')).toBeTruthy();
  expect(screen.getByText('Alle bringen Ideen ein.')).toBeTruthy();
  expect(screen.getByText('Treffen organisieren.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Als Aufgabe in Notiz übernehmen' }));
  expect(insert).toHaveBeenLastCalledWith('- [ ] Planung\n\nTreffen organisieren.');
  fireEvent.click(screen.getByRole('button', { name: 'In Notiz übernehmen' }));
  expect(insert.mock.lastCall![0]).toContain('| Beteiligung |');
  expect(insert.mock.lastCall![0]).toContain('### 1. Planung');
  fireEvent.click(screen.getByRole('button', { name: 'Textansicht' }));
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText('Normale Antwort')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Übersicht anzeigen' }));
  expect(await screen.findByRole('table')).toBeTruthy();
});
it('renders saved source cards and keeps malformed layouts in the normal answer', async () => {
  const saved = JSON.parse(
    JSON.stringify({
      ...result,
      presentation: { version: 1, source: 'root = Answer([SourceCards([0,1,2])])' },
    }),
  );
  const view = render(
    <CommandPresentation result={saved} renderItem={renderItem} fallback={<p>Normale Antwort</p>} />,
  );
  expect(await screen.findByText('Kernaussagen & Quellen')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'In Notiz übernehmen' })).toBeNull();
  view.rerender(
    <CommandPresentation
      result={{ ...saved, presentation: { version: 1, source: 'root = Answer([SourceCards([99])])' } }}
      renderItem={renderItem}
      fallback={<p>Normale Antwort</p>}
    />,
  );
  expect(screen.getByText('Normale Antwort')).toBeTruthy();
  expect(screen.queryByText('Kernaussagen & Quellen')).toBeNull();
});
