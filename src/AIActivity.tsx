import { Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { currentContent, titleOf, type Note } from './domain';

export type BackgroundJob = {
  id: string;
  note_id: string;
  revision: string;
  kind: string;
  status: string;
  error: string | null;
  created_at: string;
  available_at?: string;
};

export function AIActivity({
  jobs,
  notes,
  loaded,
  error,
  busy,
  onOpen,
}: {
  jobs: BackgroundJob[];
  notes: Note[];
  loaded: boolean;
  error: string;
  busy: string;
  onOpen: (id: string) => void;
}) {
  const running = jobs.filter((job) => job.status === 'running');
  const pending = jobs.filter((job) => job.status === 'pending');
  const failures = jobs.filter((job) => job.status === 'failed');
  const working = !!busy || running.length > 0;
  const label = (job: BackgroundJob) =>
    job.kind.startsWith('research:')
      ? 'Quellen recherchieren'
      : job.kind.startsWith('index:')
        ? 'Notiz für die KI-Suche aufbereiten'
        : 'Notiz analysieren';
  const detail = (job: BackgroundJob) => {
    if (job.error?.includes('Keine belegten Webquellen'))
      return 'Keine überprüfbaren Quellen gefunden. Es wurde kein Rechercheergebnis gespeichert; die Notizanalyse kann trotzdem aktuell sein.';
    if (job.error?.includes('Unvollständige KI-Antwort'))
      return 'Die KI hat ihre Antwort nicht vollständig geliefert. Dieser Versuch wurde nicht übernommen.';
    return 'Der Auftrag konnte nicht abgeschlossen werden. Die technische Meldung findest du unten.';
  };
  const row = (job: BackgroundJob) => {
    const note = notes.find((n) => n.id === job.note_id);
    return (
      <div className="ai-activity-job" key={job.id}>
        <strong>{label(job)}</strong>
        {note ? (
          <button className="text-button" onClick={() => onOpen(note.id)}>
            {titleOf(note.content)}
          </button>
        ) : (
          <span>Notiz nicht mehr verfügbar</span>
        )}
        {job.status === 'pending' && (
          <span>
            {job.error ? 'Wiederholung vorgesehen' : 'Wartet auf Verarbeitung'}
            {job.available_at && new Date(job.available_at).getTime() > Date.now()
              ? ` · frühestens ${new Date(job.available_at).toLocaleString('de-DE')}`
              : ''}
          </span>
        )}
        {job.status === 'failed' && (
          <>
            <p>{detail(job)}</p>
            <small>
              Auftrag vom {new Date(job.created_at).toLocaleString('de-DE')}
              {note && !currentContent(note, job.revision) ? ' · frühere Textversion' : ''}. Keine
              automatische Wiederholung mehr.
            </small>
          </>
        )}
        {job.error && (
          <details>
            <summary>Technische Meldung</summary>
            <p>{job.error}</p>
          </details>
        )}
      </div>
    );
  };
  return (
    <section className="ai-activity" aria-label="KI-Aktivität">
      <div className="ai-activity-heading" role="status">
        {error ? <AlertTriangle size={19} /> : working ? <Activity size={19} /> : <CheckCircle2 size={19} />}
        <div>
          <strong>
            {error
              ? 'KI-Status derzeit nicht abrufbar'
              : !loaded
                ? 'KI-Status wird geladen …'
                : working
                  ? 'Die KI arbeitet gerade'
                  : 'Die KI arbeitet gerade nicht'}
          </strong>
          <p>
            {error
              ? 'Die letzte Anzeige ist möglicherweise veraltet.'
              : busy ||
                (pending.length
                  ? `${pending.length} Auftrag/Aufträge warten${working ? ' zusätzlich' : ''} auf Verarbeitung.`
                  : working
                    ? `${running.length} Hintergrundauftrag/Aufträge werden verarbeitet.`
                    : 'Keine Hintergrundaufträge offen.')}
          </p>
        </div>
      </div>
      {error && (
        <details>
          <summary>Verbindungsfehler anzeigen</summary>
          <p>{error}</p>
        </details>
      )}
      {(running.length > 0 || pending.length > 0) && (
        <div className="ai-activity-current">
          {running.map(row)}
          {pending.map(row)}
        </div>
      )}
      {failures.length > 0 && (
        <details className="ai-activity-errors">
          <summary>{failures.length} frühere Probleme ansehen</summary>
          <p>
            Diese Aufträge sind beendet. Sie bedeuten nicht, dass die KI gerade arbeitet. Für einen neuen
            Versuch kannst du die betroffene Notiz öffnen und ihre KI-Anmerkungen aktualisieren.
          </p>
          {failures.map(row)}
        </details>
      )}
    </section>
  );
}
