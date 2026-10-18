import { useEffect, useState } from 'react';
import { ChevronDown, Database, HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { Action, readableDate } from './components';
import { ownBackend, readCloudConfig } from './cloud';
import { serverRequest } from './backend';
import { useNotto } from './state';
import { storageReportSchema, storageSize, type StorageReport } from './storage';

export function StorageSettings() {
  const { user } = useNotto();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [local, setLocal] = useState<{ usage?: number; quota?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const available = Boolean(user && ownBackend());
  const url = readCloudConfig().url;
  async function load() {
    return storageReportSchema.parse(await serverRequest(url, '/storage'));
  }
  useEffect(() => {
    let cancelled = false;
    if (!available) return;
    setBusy(true);
    void load()
      .then((value) => {
        if (!cancelled) setReport(value);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [available, url, user?.id]);
  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    void navigator.storage
      .estimate()
      .then(setLocal)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  async function refresh(clear = false) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (clear) {
        await serverRequest(url, '/storage/cache', { confirm: true });
        setConfirm(false);
        setMessage('Server-Caches gelöscht. Bei Bedarf werden sie neu erstellt.');
      }
      setReport(await load());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const cacheBytes =
    report?.categories
      .filter((item) => item.key === 'document-cache' || item.key === 'youtube-cache')
      .reduce((sum, item) => sum + item.bytes, 0) ?? 0;
  const categoryGroups = [
    { label: 'Notizen & Dateien', keys: ['notes', 'attachments'], className: 'storage-segment-notes' },
    {
      label: 'Wissen & KI',
      keys: ['knowledge', 'commands', 'command-images'],
      className: 'storage-segment-ai',
    },
    { label: 'Caches', keys: ['document-cache', 'youtube-cache'], className: 'storage-segment-cache' },
  ].map((group) => ({
    ...group,
    bytes:
      report?.categories
        .filter((item) => group.keys.includes(item.key))
        .reduce((sum, item) => sum + item.bytes, 0) ?? 0,
  }));
  return (
    <section className="settings-section storage-settings">
      <header className="storage-heading">
        <div>
          <h3>Speicherplatz</h3>
          <p className="muted">Deine Daten und der technische Speicher – klar getrennt.</p>
        </div>
        {available && (
          <Action
            label="Aktualisieren"
            icon={<RefreshCw size={16} />}
            isDisabled={busy}
            onClick={() => void refresh()}
          />
        )}
      </header>
      {message && (
        <p className="storage-notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="inline-error storage-notice" role="alert">
          {error}
        </p>
      )}
      {available ? (
        <>
          {busy && <p role="status">Speicher wird geprüft …</p>}
          {report && (
            <>
              <section className="storage-card" aria-labelledby="storage-account-heading">
                <div className="storage-card-heading">
                  <h4 id="storage-account-heading">
                    <Database size={18} /> Dein Konto
                  </h4>
                  <span className="storage-badge">Nutzdaten</span>
                </div>
                <strong
                  className="storage-total"
                  aria-label={`Kontodaten: ${storageSize(report.totalBytes)}`}
                >
                  {storageSize(report.totalBytes)}
                </strong>
                <p className="muted small">
                  Notizen, Dateien und KI-Daten auf dem Server. Stand: {readableDate(report.measuredAt)}
                </p>
                <div className="storage-distribution" aria-hidden="true">
                  {categoryGroups
                    .filter((group) => group.bytes > 0)
                    .map((group) => (
                      <span key={group.label} className={group.className} style={{ flexGrow: group.bytes }} />
                    ))}
                </div>
                <ul className="storage-legend">
                  {categoryGroups.map((group) => (
                    <li key={group.label}>
                      <span className={`storage-dot ${group.className}`} />
                      <span>{group.label}</span>
                      <strong>{storageSize(group.bytes)}</strong>
                    </li>
                  ))}
                </ul>
                <details className="storage-details">
                  <summary>
                    <span>Aufschlüsselung & Versionshistorie</span>
                    <ChevronDown size={16} />
                  </summary>
                  <dl className="storage-rows">
                    {report.categories.map((item) => (
                      <div key={item.key}>
                        <dt>
                          {item.label}
                          <span className="storage-count">{item.count} Einträge</span>
                        </dt>
                        <dd>{storageSize(item.bytes)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="muted small">
                    Enthält {storageSize(report.historyBytes)} Versionshistorie und {report.trashCount}{' '}
                    Notizen/Dokumente im Papierkorb. Beides bleibt erhalten. Die Kontosumme enthält keinen
                    Datenbank-Overhead und ist nicht der Mittwald-Projektverbrauch.
                  </p>
                </details>
              </section>

              <section className="storage-card storage-cache-card" aria-labelledby="storage-cache-heading">
                <div className="storage-card-heading">
                  <h4 id="storage-cache-heading">
                    <Trash2 size={18} /> Caches bereinigen
                  </h4>
                  <strong>{storageSize(cacheBytes)}</strong>
                </div>
                <p className="muted">
                  Temporärer Dokument-Kontext und YouTube-Transkripte. Deine Notizen, Dateien und
                  KI-Ergebnisse bleiben unangetastet.
                </p>
                {confirm ? (
                  <div className="storage-confirm" role="group" aria-label="Cache-Bereinigung bestätigen">
                    <p>Die Server-Caches dieses Kontos jetzt löschen?</p>
                    <div className="settings-actions">
                      <Action
                        label="Caches jetzt löschen"
                        isDisabled={busy}
                        onClick={() => void refresh(true)}
                      />
                      <Action label="Abbrechen" isDisabled={busy} onClick={() => setConfirm(false)} />
                    </div>
                  </div>
                ) : (
                  <Action
                    label="Server-Caches bereinigen"
                    isDisabled={busy || !cacheBytes}
                    onClick={() => setConfirm(true)}
                  />
                )}
                <details className="storage-details">
                  <summary>
                    <span>Was passiert beim Bereinigen?</span>
                    <ChevronDown size={16} />
                  </summary>
                  <p className="muted small">
                    Caches werden bei Bedarf neu erstellt. Das kann Ladezeit und gegebenenfalls API-Aufrufe
                    benötigen. Versionshistorie, Papierkorb und Aufgaben werden nicht gelöscht. PostgreSQL
                    verwendet freigewordenen Platz erneut; seine Dateien schrumpfen nicht sofort.
                  </p>
                </details>
              </section>

              <section className="storage-card" aria-labelledby="storage-files-heading">
                <h4 id="storage-files-heading">Anhänge</h4>
                <details className="storage-details">
                  <summary>
                    <span>Größte Anhänge ({report.largestAttachments.length})</span>
                    <ChevronDown size={16} />
                  </summary>
                  {report.largestAttachments.length ? (
                    <ul className="storage-files">
                      {report.largestAttachments.map((item) => (
                        <li key={item.id}>
                          <span>{item.name}</span>
                          <strong>{storageSize(item.bytes)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">Keine Anhänge auf dem Server.</p>
                  )}
                </details>
              </section>

              {report.hosting && (
                <section
                  className="storage-card storage-hosting-card"
                  aria-labelledby="storage-hosting-heading"
                >
                  <div className="storage-card-heading">
                    <h4 id="storage-hosting-heading">
                      <HardDrive size={18} /> Hosting-Speicher
                    </h4>
                    <span className="storage-badge">Nur Betreiber</span>
                  </div>
                  <div className="storage-hosting-summary">
                    <div>
                      <span className="muted small">Container-Registry</span>
                      <strong className="storage-total">{storageSize(report.hosting.registryBytes)}</strong>
                    </div>
                    <p className="muted">
                      Software-Images, keine Notizen. Mehrere Tags können auf dieselbe Version zeigen.
                    </p>
                  </div>
                  <p className="muted small">
                    Letzte Servermessung: {readableDate(report.hosting.measuredAt)}. Kein Livewert.
                  </p>
                  <details className="storage-details">
                    <summary>
                      <span>Hosting-Details & Aufbewahrung</span>
                      <ChevronDown size={16} />
                    </summary>
                    <dl className="storage-rows">
                      <div>
                        <dt>Registry-Tags</dt>
                        <dd>{report.hosting.registryTags}</dd>
                      </div>
                      <div>
                        <dt>Anhang-Volume</dt>
                        <dd>{storageSize(report.hosting.attachmentBytes)}</dd>
                      </div>
                      <div>
                        <dt>PostgreSQL-Datenverzeichnis</dt>
                        <dd>{storageSize(report.hosting.databaseVolumeBytes)}</dd>
                      </div>
                      <div>
                        <dt>Darin: Datenbank</dt>
                        <dd>{storageSize(report.hosting.databaseBytes)}</dd>
                      </div>
                    </dl>
                    <p className="muted small">
                      Aufbewahrungsregel des Deployment-Ablaufs: neuestes Image und noch laufende oder
                      vorgemerkte Versionen schützen; ältere Images entfernen. Die Registry-Bereinigung
                      berührt keine Notiz- oder Datenbank-Volumes.
                    </p>
                    <p className="muted small">
                      „Aktualisieren“ lädt den zuletzt veröffentlichten Betreiberbericht. Hosting- und
                      Kontowerte überlappen und werden nicht addiert. Mittwald zählt gegebenenfalls weitere
                      Projektdateien und aktualisiert seine Anzeige zeitversetzt.
                    </p>
                  </details>
                </section>
              )}
            </>
          )}
        </>
      ) : (
        <p className="muted">Für die Serverübersicht mit einem Noto-Serverkonto anmelden.</p>
      )}
      {local?.usage !== undefined && (
        <details className="storage-details storage-local">
          <summary>
            <span>Auf diesem Gerät · {storageSize(local.usage)}</span>
            <ChevronDown size={16} />
          </summary>
          <p className="muted small">
            Geschätzter Web-Speicher
            {local.quota !== undefined ? ` von ${storageSize(local.quota)} Browserkontingent` : ''}. Kein
            Serververbrauch; native Desktop-Dateien sind nicht enthalten. Lokale Notizen und Entwürfe werden
            nicht automatisch gelöscht.
          </p>
        </details>
      )}
    </section>
  );
}
