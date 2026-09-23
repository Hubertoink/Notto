import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { BauhausComposition, GeometricMark } from './Bauhaus';
import { cloud, ownBackend } from './cloud';
import { Action } from './components';
import { useNotto } from './state';
import { desktop } from './repository';
import './login.css';

export function WebAccess({ children }: { children: ReactNode }) {
  const { user, authReady } = useNotto();
  if (desktop) return children;
  if (!authReady)
    return (
      <main className="login-loading" role="status">
        <img src="/noto-bauhaus.svg" alt="" />
        Noto wird geöffnet …
      </main>
    );
  return user ? children : <Login />;
}

export function Login() {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit() {
    if (busy) return;
    setError('');
    setMessage('');
    if (signup && password !== confirmation) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      const client = cloud();
      if (!client) throw new Error('Die Verbindung ist noch nicht eingerichtet.');
      const result = signup
        ? await client.auth.signUp({
            email: email.trim(),
            password,
            options: { data: { invite: invite.trim() } },
          })
        : await client.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword('');
      setConfirmation('');
      setInvite('');
      if (signup && !result.data.session)
        setMessage('Bitte bestätige deine E-Mail-Adresse und melde dich danach an.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story" aria-label="Noto">
        <a className="login-brand" href="/" aria-label="Noto Startseite">
          <img src="/noto-bauhaus.svg" alt="" />
          <span>NOTO</span>
        </a>
        <div className="login-intro">
          <BauhausComposition />
          <h1>
            Denken.
            <br />
            Sammeln.
            <br />
            Ordnen.
          </h1>
          <p className="login-description">
            Ideen, Begegnungen, Dinge für später.
            <br />
            Alles beginnt mit einem Gedanken.
          </p>
          <div className="login-features">
            <span>
              <GeometricMark shape="square" tone="red" /> Deine Originale bleiben deine.
            </span>
            <span>
              <GeometricMark shape="circle" tone="blue" /> Mit Tags verbunden.
            </span>
            <span>
              <GeometricMark shape="triangle" tone="yellow" /> Auf Wunsch mit KI geordnet.
            </span>
          </div>
        </div>
        <p className="login-caption">Ein Notizbuch. Auf deinen Geräten.</p>
      </section>
      <section className="login-form-side">
        <motion.div
          className="login-card"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <p className="login-eyebrow">WILLKOMMEN BEI NOTO</p>
          <h2>{signup ? 'Dein Konto einrichten' : 'Schön, dass du da bist.'}</h2>
          <p className="muted">
            {signup
              ? 'Lege deinen Zugang an. Deine Notizen begleiten dich auf allen Geräten.'
              : 'Melde dich an und knüpfe an deinen letzten Gedanken an.'}
          </p>
          <form
            className="auth-form login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              E-Mail
              <input
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="du@beispiel.de"
                disabled={busy}
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                required
                minLength={signup ? 12 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={signup ? 'Mindestens 12 Zeichen' : 'Dein Passwort'}
                disabled={busy}
              />
            </label>
            {signup && (
              <>
                <label>
                  Passwort wiederholen
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    disabled={busy}
                  />
                </label>
                {ownBackend() && (
                  <label>
                    Einrichtungscode
                    <input
                      type="password"
                      autoComplete="off"
                      required
                      value={invite}
                      onChange={(e) => setInvite(e.target.value)}
                      disabled={busy}
                    />
                    <span className="muted small">Noto ist aktuell nur mit einer Einladung zugänglich.</span>
                  </label>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            {message && <p role="status">{message}</p>}
            <Action
              type="submit"
              label={signup ? 'Konto erstellen' : 'Anmelden'}
              icon={<ArrowRight size={17} />}
              variant="primary"
              isLoading={busy}
              isDisabled={busy}
            />
          </form>
          <div className="login-switch">
            <span>{signup ? 'Du hast schon ein Konto?' : 'Zum ersten Mal hier?'}</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setSignup(!signup);
                setError('');
                setMessage('');
                setPassword('');
                setConfirmation('');
                setInvite('');
              }}
            >
              {signup ? 'Anmelden' : 'Konto einrichten'}
            </button>
          </div>
          <p className="login-footnote">
            Mit demselben Konto kannst du dich auch in der Desktop-App anmelden.
          </p>
        </motion.div>
      </section>
    </main>
  );
}
