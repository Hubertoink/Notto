import { useEffect, useState } from 'react';
import { Cloud, Download, FolderOpen, LogOut, Monitor, Moon, Sun, Upload } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Action, Modal, readableDate } from './components';
import { cloud, configured, readCloudConfig, saveCloudConfig, ownBackend } from './cloud';
import { desktop, repo } from './repository';
import { allAttachmentIds, newNote } from './domain';
import { exportNotebook } from './export';
import { useNotto } from './state';
import { useCaptureShortcut, shortcutOptions, shortcutLabel } from './shortcuts';
import { noteBackgrounds, type NoteBackgroundId } from './note-backgrounds';

export function Settings({
  onImport,
  onClose,
  mode,
  setMode,
  noteBackground,
  setNoteBackground,
}: {
  onImport?: () => void;
  onClose: () => void;
  mode: 'system' | 'light' | 'dark';
  setMode: (mode: 'system' | 'light' | 'dark') => void;
  noteBackground: NoteBackgroundId;
  setNoteBackground: (background: NoteBackgroundId) => void;
}) {
  const { scope, user, notify, sync, syncState, syncError, lastSync } = useNotto();
  const [page, setPage] = useState('appearance');
  const pages = [
    ['appearance', 'Darstellung'],
    ['account', 'Konto & Sync'],
    ['data', 'Deine Daten'],
    ...(desktop ? [['shortcuts', 'Tastenkürzel & Widget']] : []),
  ];
  const shortcut = useCaptureShortcut();
  const [selectedShortcut, setSelectedShortcut] = useState(shortcutOptions[0].value);
  useEffect(() => {
    if (shortcut?.shortcut) setSelectedShortcut(shortcut.shortcut);
  }, [shortcut?.shortcut]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [configuration, setConfiguration] = useState(readCloudConfig);
  const [configure, setConfigure] = useState(!configured());
  const [path, setPath] = useState('');
  useEffect(() => {
    if (desktop)
      void invoke<string>('storage_path')
        .then(setPath)
        .catch((e) => setError(String(e)));
  }, []);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function authenticate() {
    const c = cloud();
    if (!c) throw new Error('Zuerst eine Cloud-Verbindung konfigurieren.');
    if (signup) {
      const { error } = await c.auth.signUp({ email, password, options: { data: { invite } } });
      if (error) throw error;
      setMessage(
        ownBackend()
          ? 'Konto angelegt. Du bist angemeldet.'
          : 'Konto angelegt. Bitte gegebenenfalls die Bestätigungs-E-Mail öffnen.',
      );
    } else {
      const { error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setPassword('');
      setMessage('Angemeldet. Deine lokalen Notizen bleiben separat.');
    }
  }
  async function copyLocal() {
    if (!user) return;
    const local = (await repo.list('local')).filter((n) => !n.deleted);
    for (const n of local) {
      for (const id of allAttachmentIds(n)) {
        const a = await repo.attachment('local', id);
        if (a) await repo.putAttachment({ ...a, scope });
      }
      const copy = {
        ...newNote(scope, n.content),
        pinned: n.pinned,
        archived: n.archived,
        history: n.history,
        createdAt: n.createdAt,
      };
      await repo.put(copy, null);
    }
    setMessage(
      `${local.length} lokale Notizen in dein Konto kopiert. Die lokalen Originale bleiben erhalten.`,
    );
    await sync();
  }
  return (
    <Modal
      title={user?.email ? `Einstellungen · ${user.email}` : 'Einstellungen · Lokales Notizbuch'}
      onClose={onClose}
      width={880}
      className="settings-dialog"
    >
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Einstellungsbereiche">
          {pages.map(([id, label]) => (
            <button
              key={id}
              aria-current={page === id ? 'page' : undefined}
              onClick={(event) => {
                event.currentTarget.closest('.modal-body')?.scrollTo({ top: 0 });
                setPage(id);
                setMessage('');
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <section className="settings-section" hidden={page !== 'appearance'}>
            <h3>Darstellung</h3>
            <div className="segmented" aria-label="Farbschema">
              {(
                [
                  { id: 'system', label: 'System', icon: <Monitor size={16} /> },
                  { id: 'light', label: 'Hell', icon: <Sun size={16} /> },
                  { id: 'dark', label: 'Dunkel', icon: <Moon size={16} /> },
                ] as const
              ).map((item) => (
                <button key={item.id} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
            <div className="note-background-setting">
              <div>
                <strong>Notizfläche</strong>
                <p className="muted small">Wähle einen Hintergrund für das geöffnete Notizfeld.</p>
              </div>
              <div className="note-background-grid" aria-label="Hintergrund der Notizfläche">
                {noteBackgrounds.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`note-background-option ${noteBackground === item.id ? 'selected' : ''}`}
                    aria-pressed={noteBackground === item.id}
                    onClick={() => setNoteBackground(item.id)}
                  >
                    <span
                      className="note-background-preview"
                      style={item.src ? { backgroundImage: `url("${item.src}")` } : undefined}
                    >
                      {!item.src && <span className="note-background-none">Aa</span>}
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="settings-section" hidden={page !== 'account'}>
            <h3>
              <Cloud size={18} /> Konto & Synchronisation
            </h3>
            {user ? (
              <>
                <div className="account-row">
                  <div>
                    <strong>{user.email}</strong>
                    <p className="muted">
                      {syncState === 'syncing'
                        ? 'Wird synchronisiert …'
                        : lastSync
                          ? `Zuletzt synchronisiert: ${readableDate(lastSync)}`
                          : 'Synchronisation bereit'}
                    </p>
                  </div>
                  <Action
                    label="Abmelden"
                    icon={<LogOut size={16} />}
                    onClick={() =>
                      void run(async () => {
                        const { error } = await cloud()!.auth.signOut({ scope: 'local' });
                        if (error) throw error;
                      })
                    }
                  />
                </div>
                {syncError && <p className="inline-error">{syncError}</p>}
                <div className="settings-actions">
                  <Action label="Jetzt synchronisieren" onClick={() => void sync()} />
                  <Action
                    label="Lokale Notizen ins Konto kopieren"
                    onClick={() => void run(copyLocal)}
                    isLoading={busy}
                  />
                </div>
                <p className="muted small">
                  Diese Aktion lädt die Kopien in dein Konto. Abmelden wechselt zurück zu deinen lokalen
                  Notizen.
                </p>
              </>
            ) : (
              <>
                <p className="muted">
                  Mit einem Konto kannst du auf mehreren Geräten weiterarbeiten. Ohne Konto bleiben deine
                  Notizen auf diesem Gerät.
                </p>
                {configured() && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(authenticate);
                    }}
                    className="auth-form"
                  >
                    <label>
                      E-Mail
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        required
                        placeholder="du@beispiel.de"
                      />
                    </label>
                    <label>
                      Passwort
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete={signup ? 'new-password' : 'current-password'}
                        minLength={ownBackend() ? 12 : 8}
                        required
                        placeholder="Mindestens 12 Zeichen"
                      />
                    </label>
                    {signup && ownBackend() && (
                      <label>
                        Einrichtungscode
                        <input
                          type="password"
                          autoComplete="off"
                          required
                          value={invite}
                          onChange={(e) => setInvite(e.target.value)}
                        />
                      </label>
                    )}
                    <div className="settings-actions">
                      <Action
                        type="submit"
                        label={signup ? 'Konto erstellen' : 'Anmelden'}
                        variant="primary"
                        isLoading={busy}
                      />
                      <button type="button" className="text-button" onClick={() => setSignup(!signup)}>
                        {signup ? 'Bereits ein Konto?' : 'Neues Konto erstellen'}
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
            {!configured() && (
              <div className="setup-notice">
                Die geräteübergreifende Verbindung ist noch nicht eingerichtet. Lokales Arbeiten ist bereits
                möglich.
              </div>
            )}
            <button className="text-button small" onClick={() => setConfigure(!configure)}>
              {configure ? 'Verbindung ausblenden' : 'Cloud-Verbindung konfigurieren'}
            </button>
            {configure && (
              <form
                className="cloud-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    saveCloudConfig({ ...configuration, key: '' });
                    location.reload();
                  });
                }}
              >
                <label>
                  Noto-Serveradresse
                  <input
                    type="url"
                    required
                    placeholder="https://noto-app.de"
                    value={configuration.url}
                    onChange={(e) => setConfiguration({ ...configuration, url: e.target.value.trim() })}
                  />
                </label>
                <p className="muted small">
                  Anmeldung und Synchronisation laufen über deinen Noto-Server. Der OpenAI-Schlüssel bleibt
                  auf dem Server.
                </p>
                <Action
                  type="submit"
                  label="Verbindung speichern"
                  isDisabled={Boolean(user)}
                  isLoading={busy}
                />
                {user && <p className="muted small">Melde dich ab, bevor du die Verbindung wechselst.</p>}
              </form>
            )}
          </section>
          <section className="settings-section" hidden={page !== 'data'}>
            <h3>Deine Daten</h3>
            {onImport && (
              <Action label="Markdown importieren" icon={<Upload size={16} />} onClick={onImport} />
            )}
            <p className="muted">
              Exportiere Markdown, Bilder, Entwürfe und Versionshistorie zusammen als ZIP.
            </p>
            <div className="settings-actions">
              <Action
                label="Notizbuch exportieren"
                icon={<Download size={16} />}
                isLoading={busy}
                onClick={() =>
                  void run(async () => {
                    if (await exportNotebook(scope)) notify('Export erstellt');
                  })
                }
              />
              {desktop && (
                <Action
                  label="Speicherordner öffnen"
                  icon={<FolderOpen size={16} />}
                  onClick={() =>
                    void run(async () => {
                      await invoke('open_vault');
                    })
                  }
                />
              )}
            </div>
            {path && <p className="storage-path">{path}</p>}
            {!desktop && (
              <p className="muted small">
                Lokale Browsernotizen liegen im Speicher dieses Browsers. Ein Export schützt sie auch beim
                Löschen der Browserdaten.
              </p>
            )}
          </section>
          {desktop && (
            <section className="settings-section" hidden={page !== 'shortcuts'}>
              <h3>Tastenkürzel & Randwidget</h3>
              <p className="muted">
                Das globale Kürzel öffnet die Schnellnotiz auch aus anderen Programmen, bei geschlossenem
                Hauptfenster oder ausgeblendetem Widget. Noto muss dafür im Infobereich laufen. Im
                Hauptfenster funktioniert zusätzlich Strg + N.
              </p>
              <label>
                Globale Schnellnotiz
                <select
                  value={selectedShortcut}
                  onChange={(e) => setSelectedShortcut(e.target.value)}
                  disabled={busy}
                >
                  {shortcutOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className={shortcut?.active ? 'muted small' : 'inline-error'} role="status">
                {shortcut
                  ? shortcut.active
                    ? `Aktiv: ${shortcutLabel(shortcut.shortcut)}`
                    : shortcut.error
                  : 'Tastenkürzel wird geprüft …'}
              </p>
              <Action
                label="Kürzel prüfen & übernehmen"
                isLoading={busy}
                isDisabled={busy}
                onClick={() =>
                  void run(async () => {
                    await invoke('shortcut_set', { shortcut: selectedShortcut });
                    setMessage('Tastenkürzel registriert und für den nächsten Start gespeichert.');
                  })
                }
              />
              <p className="muted small">
                Windows prüft beim Registrieren, ob die Kombination bereits belegt ist. Bei einem Konflikt
                bleibt dein bisheriges Kürzel aktiv. Am Griff kannst du das Widget an den Bildschirmrand
                verschieben.
              </p>
              <div className="settings-actions">
                <Action
                  label="Widget anzeigen"
                  onClick={() =>
                    void run(async () => {
                      await invoke('show_widget');
                    })
                  }
                />
                <Action
                  label="Widget ausblenden"
                  onClick={() =>
                    void run(async () => {
                      await invoke('hide_widget');
                    })
                  }
                />
              </div>
            </section>
          )}
          {message && (
            <p className="success-message" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="settings-footer">
            <span>Deine Originale bleiben deine.</span>
            <span>KI konfigurieren: Seitenleiste → Wissen & KI.</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
