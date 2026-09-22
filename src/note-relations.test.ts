import { expect, it, vi } from 'vitest';
import { newNote, contentRevision, reviseNote } from './domain';
import {
  applyRelation,
  discoverRelations,
  pairKey,
  validRelation,
  visibleRelations,
  relationKey,
  type Relation,
} from './note-relations';

function fixture() {
  const source = newNote(
    'local',
    'Unser Jugendhauskonzept braucht ein gemeinsames Leitbild mit Beteiligung der Jugendlichen.',
  );
  const target = newNote(
    'local',
    'Kapitel 3: Leitbildentwicklung verbindet gemeinsame Werte und Beteiligung mit konkreten Handlungszielen.',
  );
  const relation: Relation = {
    sourceId: source.id,
    targetId: target.id,
    sourceRevision: contentRevision(source),
    targetRevision: contentRevision(target),
    relation: 'theory',
    reason: 'Das Kapitel erklärt die partizipative Leitbildentwicklung als Grundlage der Konzeption.',
    sourceQuote: source.content,
    targetQuote: target.content,
    anchor: 'gemeinsames Leitbild',
  };
  return { source, target, relation };
}
it('verifies theoretical connections using both complete texts before offering an exact link', async () => {
  const { source, target, relation } = fixture();
  const shortlist = vi.fn().mockResolvedValue({ ids: [target.id] });
  const verify = vi.fn().mockResolvedValue({ suggestions: [relation] });
  const result = await discoverRelations(source, [source, target], [], shortlist, verify);
  expect(verify.mock.calls[0][0].notes).toEqual([
    { id: source.id, text: source.content },
    { id: target.id, text: target.content },
  ]);
  expect(result.suggestions).toEqual([relation]);
  expect(applyRelation(source, target, relation)).toBe(
    source.content.replace(relation.anchor, `[${relation.anchor}](notes/${target.id})`),
  );
});
it('does not accept invented evidence, target IDs, stale versions or ambiguous anchors', () => {
  const { source, target, relation } = fixture();
  expect(validRelation({ ...relation, targetQuote: 'Erfundener Beleg' }, [source, target])).toBe(false);
  expect(validRelation({ ...relation, targetId: 'invented' }, [source, target])).toBe(false);
  expect(() => applyRelation(source, reviseNote(target, { content: 'Neuer Inhalt' }), relation)).toThrow();
  expect(validRelation(relation, [source, { ...target, scope: 'other' }])).toBe(false);
  expect(
    validRelation({ ...relation, sourceQuote: 'Leitbild Leitbild', anchor: 'Leitbild' }, [
      { ...source, content: 'Leitbild Leitbild' },
      target,
    ]),
  ).toBe(false);
});
it('reuses negative results and checks new text versions again', async () => {
  const { source, target } = fixture();
  const shortlist = vi.fn().mockResolvedValue({ ids: [] });
  const verify = vi.fn();
  const result = await discoverRelations(source, [source, target], [], shortlist, verify);
  expect(result.checked).toEqual([pairKey(source, target)]);
  expect(result.suggestions).toEqual([]);
  await discoverRelations(target, [source, target], [result], shortlist, verify);
  expect(shortlist).toHaveBeenCalledTimes(1);
  await discoverRelations(
    source,
    [source, reviseNote(target, { content: target.content + ' Ergänzung' })],
    [result],
    shortlist,
    verify,
  );
  expect(shortlist).toHaveBeenCalledTimes(2);
  expect(verify).not.toHaveBeenCalled();
});
it('allows a newly created theory note to propose a link from an older practice note', async () => {
  const { source, target, relation } = fixture();
  const result = await discoverRelations(
    target,
    [source, target],
    [],
    async () => ({ ids: [source.id] }),
    async () => ({ suggestions: [relation] }),
  );
  const record = { scope: 'local', kind: 'note-relations', data: result };
  expect(visibleRelations(source, [source, target], [record, record])).toEqual([relation]);
  expect(
    visibleRelations(
      source,
      [source, target],
      [
        record,
        {
          scope: 'local',
          kind: 'relation-decision',
          data: { key: relationKey(relation), status: 'dismissed' },
        },
      ],
    ),
  ).toEqual([]);
});
it('never inserts links into code, existing links or duplicate references', () => {
  const { source, target, relation } = fixture();
  for (const content of [
    `\`${source.content}\``,
    `[${source.content}](https://example.com)`,
    source.content + ` [Kapitel](notes/${target.id})`,
  ]) {
    const modified = newNote('local', content);
    expect(
      validRelation({ ...relation, sourceId: modified.id, sourceRevision: contentRevision(modified) }, [
        modified,
        target,
      ]),
    ).toBe(false);
  }
});
