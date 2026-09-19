import { tagsOf, titleOf, type Note } from './domain';
import { latest, decisionKey, resolvedDecision, type Analysis, type KnowledgeRecord } from './intelligence';

export function topicGroups(notes: Note[], records: KnowledgeRecord[]) {
  const groups = new Map<string, { title: string; ai: boolean; notes: Map<string, Note> }>();
  for (const note of notes.filter((n) => !n.deleted)) {
    for (const tag of tagsOf(note.content)) {
      const key = `tag:${tag}`;
      if (!groups.has(key)) groups.set(key, { title: `#${tag}`, ai: false, notes: new Map() });
      groups.get(key)!.notes.set(note.id, note);
    }
  }
  for (const note of notes.filter((n) => !n.deleted)) {
    const items =
      (
        latest(
          records.filter((r) => r.scope === note.scope),
          'analysis',
          note,
        )?.data as Analysis | undefined
      )?.suggestions ?? [];
    for (const item of items.filter((i) => i.kind === 'topic')) {
      if (
        resolvedDecision(
          records.filter((r) => r.scope === note.scope),
          decisionKey(note.id, item),
        )?.status === 'dismissed'
      )
        continue;
      const normalized = item.title.replace(/^#/, '').trim().toLocaleLowerCase('de');
      // User tags are already authoritative; they require no AI confirmation.
      if (tagsOf(note.content).includes(normalized) || /^#[\p{L}\p{N}_-]+$/u.test(item.quote.trim()))
        continue;
      const key = `ai:${normalized}`;
      if (!groups.has(key)) groups.set(key, { title: item.title, ai: true, notes: new Map() });
      groups.get(key)!.notes.set(note.id, note);
    }
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.ai) - Number(b.ai) || a.title.localeCompare(b.title, 'de'),
  );
}
export function Topics({
  notes,
  records,
  onOpen,
}: {
  notes: Note[];
  records: KnowledgeRecord[];
  onOpen: (id: string) => void;
}) {
  const groups = topicGroups(notes, records);
  return (
    <section className="knowledge-section">
      <p className="muted">
        Deine Hashtags ordnen Notizen direkt. Ergänzende Themen erkennt die KI automatisch; dafür ist keine
        Bestätigung nötig.
      </p>
      {!groups.length && <p>Noch keine Themen. Setze Hashtags oder analysiere deine Notizen.</p>}
      {groups.map((group) => (
        <article className="knowledge-card" key={`${group.ai}:${group.title}`}>
          <span className="eyebrow">{group.ai ? 'KI-ZUORDNUNG' : 'DEIN HASHTAG'}</span>
          <h3>{group.title}</h3>
          {[...group.notes.values()].map((note) => (
            <button key={note.id} className="text-button" onClick={() => onOpen(note.id)}>
              {titleOf(note.content)}
            </button>
          ))}
        </article>
      ))}
    </section>
  );
}
