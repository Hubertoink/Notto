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
        className="knowledge-card organization-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            controller.current = new AbortController();
            await organizeNotebook(scope, instruction, controller.current.signal, setProgress);
          });
        }}
      >
        <div className="organization-intro">
          <span className="organization-eyebrow">Neuer Auftrag</span>
          <h2>Was möchtest du klären?</h2>
          <p className="muted">
            Beschreibe ein Thema oder eine offene Frage. Noto sucht passende Notizen und zeigt dir belegte
            Vorschläge.
          </p>
        </div>
        <label className="organization-request" htmlFor="organization-request">
          <span>Dein Auftrag</span>
          <textarea
            id="organization-request"
            rows={3}
            maxLength={1000}
            value={instruction}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Zum Beispiel: Was ist der aktuelle Stand des Medienraums? Finde ergänzende oder widersprüchliche Notizen."
          />
        </label>
        <div className="organization-compose-footer">
          <button
            type="submit"
            className="organization-submit"
            disabled={busy || !instruction.trim() || !config(scope).enabled}
          >
            Notizen organisieren
          </button>
          {busy && (
            <button type="button" className="text-button" onClick={() => controller.current?.abort()}>
              Abbrechen
            </button>
          )}
          <span className="muted">Vorschläge werden erst nach deiner Bestätigung übernommen.</span>
        </div>
        <details className="organization-run-info">
          <summary>Hinweis zum Durchlauf</summary>
          <p className="muted small">
            Bis zu acht KI-Anfragen je Durchlauf. Eine bereits laufende Anfrage kann beim Abbrechen noch
            abgeschlossen werden.
          </p>
        </details>
      </form>
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="organization-results-heading">
        <div>
          <span className="organization-eyebrow">Deine Ergebnisse</span>
          <h2>Übersichten und Vorschläge</h2>
        </div>
        {organizations.length > 0 && (
          <span className="knowledge-status">
            {organizations.length} {organizations.length === 1 ? 'Durchlauf' : 'Durchläufe'}
          </span>
        )}
      </div>
      {!organizations.length && (
        <p className="organization-empty muted">Nach deinem ersten Auftrag erscheinen hier die Ergebnisse.</p>
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
            <article key={record.id} className="knowledge-card organization-result organization-stale">
              <p>
                Eine Quelle dieser Übersicht wurde geändert oder ausgeschlossen. Bitte den Auftrag erneut
                starten.
              </p>
            </article>
          );
        return (
          <article key={record.id} className="knowledge-card organization-result">
            <header className="organization-result-header">
              <div>
                <span className="organization-eyebrow">{new Date(record.at).toLocaleDateString('de')}</span>
                <h3>{data.title}</h3>
                <p className="muted">{data.request}</p>
              </div>
              <span className="organization-result-count">
                {data.sources.length} {data.sources.length === 1 ? 'Quelle' : 'Quellen'}
              </span>
            </header>
            {data.claims.length > 0 && (
              <section className="organization-result-section" aria-label="Übersicht">
                <h4>Übersicht</h4>
                {data.claims.map((claim, index) => (
                  <div className="organization-claim" key={index}>
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
              </section>
            )}
            {data.relations.length > 0 && <h4 className="organization-group-heading">Zusammenhänge</h4>}
            {data.relations.map((relation, index) => (
              <section className="organization-proposal" key={`relation:${index}`}>
                <h5>{relationLabels[relation.kind]}</h5>
                {source(relation.from.index)}
                {source(relation.to.index)}
                <p>{relation.reason}</p>
                <details>
                  <summary>Belege</summary>
                  {source(relation.from.index, relation.from.quote)}
                  {source(relation.to.index, relation.to.quote)}
                </details>
                {buttons(record, `relation:${index}`, current)}
              </section>
            ))}
            {data.collections.length > 0 && <h4 className="organization-group-heading">Sammlungen</h4>}
            {data.collections.map((collection, index) => (
              <section className="organization-proposal" key={`collection:${index}`}>
                <h5>{collection.name}</h5>
                {source(collection.source.index)}
                <p>{collection.reason}</p>
                <details>
                  <summary>Beleg</summary>
                  {source(collection.source.index, collection.source.quote)}
                </details>
                {buttons(record, `collection:${index}`, current)}
              </section>
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
