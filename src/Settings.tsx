import { useEffect, useState } from 'react';
import { Cloud, Download, FolderOpen, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Action, Modal, readableDate } from './components';
import { cloud, configured, readCloudConfig, saveCloudConfig } from './cloud';
import { desktop, repo } from './repository';
import { allAttachmentIds, newNote } from './domain';
import { exportNotebook } from './export';
import { useNotto } from './state';

export function Settings({
  onClose,
  mode,
  setMode,
}: {
  onClose: () => void;
  mode: 'system' | 'light' | 'dark';
  setMode: (mode: 'system' | 'light' | 'dark') => void;
}) {
  const { scope, user, notify, sync, syncState, syncError, lastSync } = useNotto();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      const { error } = await c.auth.signUp({ email, password });
      if (error) throw error;
      setMessage(
        'Konto angelegt. Falls eine Bestätigung erforderlich ist, öffne bitte den Link in deiner E-Mail.',
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
    <Modal title="Einstellungen" onClose={onClose} width={640}>
      <section className="settings-section">
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
      </section>
      <section className="settings-section">
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
              Diese Aktion lädt die Kopien in dein Konto. Abmelden wechselt zurück zu deinen lokalen Notizen.
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              Mit einem Konto kannst du auf mehreren Geräten weiterarbeiten. Ohne Konto bleiben deine Notizen
              auf diesem Gerät.
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
                    minLength={8}
                    required
                    placeholder="Mindestens 8 Zeichen"
                  />
                </label>
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
                saveCloudConfig(configuration);
                location.reload();
              });
            }}
          >
            <label>
              Supabase-Projekt-URL
              <input
                type="url"
                required
                placeholder="https://….supabase.co"
                value={configuration.url}
                onChange={(e) => setConfiguration({ ...configuration, url: e.target.value.trim() })}
              />
            </label>
            <label>
              Öffentlicher Publishable-/Anon-Key
              <input
                required
                value={configuration.key}
                onChange={(e) => setConfiguration({ ...configuration, key: e.target.value.trim() })}
                autoComplete="off"
                placeholder="sb_publishable_…"
              />
            </label>
            <p className="muted small">
              Das Projektschema muss eingerichtet sein. Hier niemals einen Secret- oder Service-Role-Key
              eintragen.
            </p>
            <Action type="submit" label="Verbindung speichern" isDisabled={Boolean(user)} isLoading={busy} />
            {user && <p className="muted small">Melde dich ab, bevor du die Verbindung wechselst.</p>}
          </form>
        )}
      </section>
      <section className="settings-section">
        <h3>Deine Daten</h3>
        <p className="muted">Exportiere Markdown, Bilder, Entwürfe und Versionshistorie zusammen als ZIP.</p>
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
            Lokale Browsernotizen liegen im Speicher dieses Browsers. Ein Export schützt sie auch beim Löschen
            der Browserdaten.
          </p>
        )}
      </section>
      {desktop && (
        <section className="settings-section">
          <h3>Randwidget</h3>
          <p className="muted">
            Am Griff verschieben und am linken oder rechten Rand andocken. Strg + Umschalt + Leertaste öffnet
            die Eingabe.
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
        <span>Notto 0.2 · Deine Originale bleiben deine.</span>
        <span>KI konfigurieren: Seitenleiste → Wissen & KI.</span>
      </div>
    </Modal>
  );
}
