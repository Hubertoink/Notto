import { useEffect, useRef, useState } from 'react';
import { organizeNotebook, decideOrganization, organizationDecision } from './agent';
import { organizationRecordSchema, relationLabels } from './agent-policy';
import { config, type KnowledgeRecord } from './intelligence';
import { evidenceCurrent } from './evidence-policy';
import { titleOf, type Note } from './domain';
import { Action } from './components';

export function Organization({
  scope,
  notes,
  records,
  onOpen,
}: {
  scope: string;
  notes: Note[];
  records: KnowledgeRecord[];
  onOpen: (id: string) => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [scope]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress('');
      controller.current = null;
    }
  };
  const organizations = records
    .filter((record) => record.kind === 'organization' && record.scope === scope)
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const buttons = (record: KnowledgeRecord, item: string, current: boolean) => {
    const decision = organizationDecision(records, record.id, item);
    const applied =
      decision?.status === 'accepted' ||
      (decision?.status === 'applying' &&
        notes.some((note) => note.id === decision.noteId && note.revision === decision.appliedRevision)) ||
      (decision?.status === 'undoing' &&
        notes.some((note) => note.id === decision.noteId && note.revision === decision.beforeRevision));
    return (
      <div className="settings-actions">
        <span className="muted">
          {applied
            ? 'Übernommen'
            : decision?.status === 'dismissed'
              ? 'Verworfen'
              : decision?.status === 'undone'
                ? 'Zurückgenommen'
                : 'Vorschlag'}
        </span>
        {!applied && (
          <Action
            label={item.startsWith('collection:') ? 'Zuordnen' : 'Übernehmen'}
            isDisabled={busy || !current}
            onClick={() => void run(() => decideOrganization(record, item, 'accepted'))}
          />
        )}
        {applied ? (
          <Action
            label="Rückgängig"
            isDisabled={busy}
            onClick={() => void run(() => decideOrganization(record, item, 'undone'))}
          />
        ) : (
          decision?.status !== 'dismissed' && (
            <Action
              label="Verwerfen"
              isDisabled={busy}
              onClick={() => void run(() => decideOrganization(record, item, 'dismissed'))}
            />
          )
        )}
      </div>
    );
  };
  return (
    <section className="knowledge-section organization" aria-label="Notizsekretär">
      <form
        className="knowledge-card"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            controller.current = new AbortController();
            await organizeNotebook(scope, instruction, controller.current.signal, setProgress);
          });
        }}
      >
        <label htmlFor="organization-request">Was soll Noto in deinen Notizen ordnen oder klären?</label>
        <textarea
          id="organization-request"
          rows={3}
          maxLength={1000}
          value={instruction}
          disabled={busy}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Zum Beispiel: Fasse den aktuellen Stand des Medienraums zusammen und finde ergänzende oder widersprüchliche Notizen."
        />
        <p className="muted">
          Noto liest passende Notizen und schlägt eine belegte Übersicht, Zusammenhänge und Sammlungen vor. Du
          entscheidest über die Übernahme.
        </p>
        <div className="settings-actions">
          <button
            type="submit"
            className="text-button"
            disabled={busy || !instruction.trim() || !config(scope).enabled}
          >
            Notizen organisieren
          </button>
          {busy && (
            <button type="button" className="text-button" onClick={() => controller.current?.abort()}>
              Abbrechen
            </button>
          )}
        </div>
        <small className="muted">
          Bis zu acht KI-Anfragen je Durchlauf. Eine bereits laufende Anfrage kann beim Abbrechen noch
          abgeschlossen werden.
        </small>
      </form>
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!organizations.length && (
        <p className="muted">Hier erscheinen deine Übersichten und Ordnungsvorschläge.</p>
      )}
      {organizations.slice(0, 20).map((record) => {
        const parsed = organizationRecordSchema.safeParse(record.data);
        if (!parsed.success) return null;
        const data = parsed.data;
        const current = data.sources.every((source) =>
          evidenceCurrent(source, notes, scope, config(scope), records),
        );
        const source = (index: number, quote?: string) => {
          const evidence = data.sources[index];
          if (!evidence) return null;
          const note = notes.find((n) => n.scope === scope && n.id === evidence.noteId);
          return (
            <div className="organization-source" key={`${index}:${quote}`}>
              <button className="text-button" onClick={() => onOpen(evidence.noteId)}>
                {titleOf(note?.content ?? '')}
                {evidence.page ? ` · Seite ${evidence.page}` : ''}
              </button>
              {quote && <blockquote>{quote}</blockquote>}
            </div>
          );
        };
        if (!current)
          return (
            <article key={record.id} className="knowledge-card">
              <p>
                Eine Quelle dieser Übersicht wurde geändert oder ausgeschlossen. Bitte den Auftrag erneut
                starten.
              </p>
            </article>
          );
        return (
          <article key={record.id} className="knowledge-card">
            <h3>{data.title}</h3>
            <p className="muted">
              {data.request} · {new Date(record.at).toLocaleDateString('de')}
            </p>
            {data.claims.length > 0 && (
              <div>
                {data.claims.map((claim, index) => (
                  <div key={index}>
                    <p>
                      {claim.kind === 'conflict' ? (
                        <strong>Widerspruch: </strong>
                      ) : claim.kind === 'inference' ? (
                        <strong>Schlussfolgerung: </strong>
                      ) : null}
                      {claim.text}
                    </p>
                    <details>
                      <summary>Belege</summary>
                      {claim.citations.map((citation) => source(citation.index, citation.quote))}
                    </details>
                  </div>
                ))}
                {buttons(record, 'overview', current)}
              </div>
            )}
            {data.relations.map((relation, index) => (
              <div className="organization-proposal" key={`relation:${index}`}>
                <h4>Zusammenhang · {relationLabels[relation.kind]}</h4>
                {source(relation.from.index)}
                <p>{relationLabels[relation.kind]}</p>
                {source(relation.to.index)}
                <p>{relation.reason}</p>
                <details>
                  <summary>Belege</summary>
                  {source(relation.from.index, relation.from.quote)}
                  {source(relation.to.index, relation.to.quote)}
                </details>
                {buttons(record, `relation:${index}`, current)}
              </div>
            ))}
            {data.collections.map((collection, index) => (
              <div className="organization-proposal" key={`collection:${index}`}>
                <h4>Sammlung · {collection.name}</h4>
                {source(collection.source.index)}
                <p>{collection.reason}</p>
                <details>
                  <summary>Beleg</summary>
                  {source(collection.source.index, collection.source.quote)}
                </details>
                {buttons(record, `collection:${index}`, current)}
              </div>
            ))}
            {data.insufficient && (
              <p className="muted">Die vorhandenen Quellen reichen nur für eine teilweise Einordnung.</p>
            )}
            <details>
              <summary>Arbeitsverlauf</summary>
              {records
                .filter((r) => r.kind === 'agent-run' && r.noteId === record.id)
                .map((run) => {
                  const trace = run.data as { calls: number; trace: { action: string; sources: number }[] };
                  return (
                    <div key={run.id}>
                      <p>{trace.calls} Modellantworten einschließlich Belegprüfung</p>
                      <ol>
                        {trace.trace.map((step, i) => (
                          <li key={i}>
                            {step.action === 'read_note'
                              ? 'Notiz gelesen'
                              : step.action === 'correct_evidence'
                                ? 'Belege korrigiert'
                                : 'Weitere Notizen gesucht'}{' '}
                            · {step.sources} Quellen im Kontext
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })}
            </details>
          </article>
        );
      })}
    </section>
  );
}
