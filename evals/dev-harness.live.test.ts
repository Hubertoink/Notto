// @vitest-environment jsdom
// Explicit opt-in only. Uses the local test account and synthetic demo notes.
import 'fake-indexeddb/auto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { newNote, reviseNote, type Note } from '../src/domain';
import { repo } from '../src/repository';
import { saveCloudConfig, syncNotes } from '../src/cloud';
import { analyze, config, knowledge, latest, saveConfig, type Analysis } from '../src/intelligence';
import { saveMemory } from '../src/memory-client';
import { memoryUsable } from '../src/memory-policy';
import { organizeNotebook, decideOrganization } from '../src/agent';
import { organizationRecordSchema } from '../src/agent-policy';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));

it.skipIf(process.env.NOTTO_DEV_LIVE !== '1')(
  'demonstrates Luna through the real dev backend and saves a reviewable result',
  async () => {
    const base = 'http://127.0.0.1:3001';
    const credentials = JSON.parse(await readFile('.notto-dev/test-account.json', 'utf8'));
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const login = await nativeFetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:1420',
        'X-Notto-Client': 'desktop',
      },
      body: JSON.stringify(credentials),
    });
    expect(login.ok).toBe(true);
    const session = (await login.json()) as { user: { id: string }; token: string };
    const scope = session.user.id;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, options: RequestInit = {}) => {
      if (!String(input).startsWith(`${base}/api/`))
        throw new Error('Live-Demo darf nur die lokale API aufrufen.');
      const headers = new Headers(options.headers);
      headers.set('Authorization', `Bearer ${session.token}`);
      headers.set('X-Notto-Client', 'desktop');
      headers.set('Origin', 'http://127.0.0.1:1420');
      return nativeFetch(input, { ...options, headers });
    });
    try {
      saveCloudConfig({ url: base, key: '' });
      await saveConfig(scope, {
        ...config(scope),
        enabled: true,
        auto: false,
        autoResearch: false,
        model: 'gpt-5.6-luna',
        dailyLimit: 100,
      });
      const definitions = [
        'KI-Demo · Medienraum – Bestand\n\nStand 20.09.2026: Der Medienraum im Jugendhaus hat vier vorhandene PCs. Alle vier PCs sind eingerichtet; die Einrichtung ist erledigt. Es wurden keine neuen Geräte bestellt.\n#ki-demo #medienraum',
        'KI-Demo · Medienraum – Workshop\n\nFür den Filmworkshop nutzen wir die vier vorhandenen PCs im Medienraum. Ich muss bis Freitag eine Materialliste für den Workshop erstellen. Es ist kein PC-Kauf geplant.\n#ki-demo #medienraum #workshop',
        'KI-Demo · Medienraum – Inventurliste\n\nStand 20.09.2026: Laut dieser Inventurliste stehen fünf PCs im Medienraum. Die Liste wurde noch nicht mit der Bestandsnotiz abgeglichen.\n#ki-demo #medienraum',
        'KI-Demo · Pädagogisches Leitbild\n\nIm Medienraum stehen Selbstbestimmung, Kreativität und Teilhabe im Mittelpunkt. Jugendliche sollen eigene Medienprojekte entwickeln können. Dies ist ein Leitbild, kein Beschaffungs- oder Installationsauftrag.\n#ki-demo #medienraum',
        'KI-Demo · Gartenfest\n\nBeim Gartenfest gibt es Limonade und Brettspiele. Es hat keinen Bezug zum Medienraum oder zum Filmworkshop.\n#ki-demo #gartenfest',
      ];
      const existing = (await (await fetch(`${base}/api/notes`)).json()).data.map(
        (row: { document: Note }) => row.document,
      ) as Note[];
      const notes = definitions.map(
        (content) =>
          existing.find((n) => !n.deleted && n.content.split('\n')[0] === content.split('\n')[0]) ?? {
            ...newNote(scope, content),
            collections: ['KI-Demo'],
          },
      );
      if (!existing.some((n) => n.id === notes[0].id))
        notes[0] = reviseNote(notes[0], {
          content: `${notes[0].content}\n\nSiehe [Workshop](notes/${notes[1].id}) und [Inventurliste](notes/${notes[2].id}).`,
        });
      for (const note of notes) {
        const pushed = existing.some((n) => n.id === note.id)
          ? { ok: true }
          : await fetch(`${base}/api/notes/push`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                p_id: note.id,
                p_revision: note.revision,
                p_base_revision: null,
                p_document: note,
              }),
            });
        expect(pushed.ok).toBe(true);
        await repo.put({ ...note, dirty: false, baseRevision: note.revision }, null);
      }
      await saveMemory(scope, {
        key: 'demo:harness:instruction',
        category: 'instruction',
        status: 'active',
        text: 'Unterscheide Ist-Stand, Pläne und offene Widersprüche. Vorhandene Geräte zuerst berücksichtigen. Antworte knapp auf Deutsch.',
        sources: [],
      });
      await knowledge.sync(scope);
      console.log('LIVE: Fünf Demo-Notizen und eine Arbeitsanweisung im lokalen Konto angelegt.');
      await analyze(notes[3]);
      const concept = latest(await knowledge.list(scope), 'analysis', notes[3])?.data as Analysis;
      expect(concept.suggestions.filter((s) => s.kind === 'task')).toHaveLength(0);
      await analyze(notes[0]);
      const completed = latest(await knowledge.list(scope), 'analysis', notes[0])?.data as Analysis;
      expect(completed.suggestions.filter((s) => s.kind === 'task')).toHaveLength(0);
      const record = await organizeNotebook(
        scope,
        'Untersuche die KI-Demo zum Medienraum. Lies die Bestandsnotiz und die Inventurliste gezielt nach. Fasse Ist-Stand, Workshop und offene Widersprüche zusammen. Leite aus dem Leitbild keine Aufgaben ab. Schlage begründete Beziehungen und eine passende Sammlung vor.',
        undefined,
        (message) => console.log(`LIVE: ${message}`),
      );
      const result = organizationRecordSchema.parse(record.data);
      expect(
        result.claims.some((c) => c.kind === 'conflict') ||
          result.relations.some((r) => r.kind === 'contradicts'),
      ).toBe(true);
      expect(result.relations.length).toBeGreaterThan(0);
      const run = (await knowledge.list(scope)).find(
        (r) => r.kind === 'agent-run' && r.noteId === record.id,
      )!;
      expect((run.data as { trace: unknown[] }).trace.length).toBeGreaterThan(0);
      const before = (await repo.get(scope, notes[0].id))!;
      const pinned = reviseNote(before, { pinned: true });
      await repo.put(pinned, before.revision);
      expect(
        memoryUsable(
          {
            key: 'demo-check',
            category: 'fact',
            text: 'Vier PCs sind eingerichtet.',
            status: 'active',
            sources: [
              { noteId: before.id, revision: before.revision, quote: 'Alle vier PCs sind eingerichtet' },
            ],
          },
          [pinned],
          config(scope),
          scope,
        ),
      ).toBe(true);
      const proposalIndex = result.collections.findIndex((proposal) => {
        const note = notes.find((n) => n.id === result.sources[proposal.source.index].noteId);
        return note && !note.collections.includes(proposal.name);
      });
      if (proposalIndex >= 0) {
        const item = `collection:${proposalIndex}`;
        const noteId = result.sources[result.collections[proposalIndex].source.index].noteId;
        const original = (await repo.get(scope, noteId))!;
        await decideOrganization(record, item, 'accepted');
        expect((await repo.get(scope, noteId))?.collections).toContain(
          result.collections[proposalIndex].name,
        );
        await decideOrganization(record, item, 'undone');
        expect((await repo.get(scope, noteId))?.collections).toEqual(original.collections);
        await decideOrganization(record, item, 'accepted');
      }
      await decideOrganization(record, 'overview', 'accepted');
      for (const [index] of result.relations.entries())
        await decideOrganization(record, `relation:${index}`, 'accepted');
      for (const note of notes) expect((await repo.get(scope, note.id))?.content).toBe(note.content);
      await syncNotes(scope);
      await knowledge.sync(scope);
      await writeFile(
        '.notto-dev/harness-demo-result.json',
        JSON.stringify(
          {
            model: 'gpt-5.6-luna',
            at: new Date().toISOString(),
            checks: [
              'Leitbild ohne Aufgaben',
              'Erledigte Einrichtung bleibt erledigt',
              'Widerspruch sichtbar',
              'Werkzeuge verwendet',
              'Memory bleibt beim Anpinnen gültig',
              ...(proposalIndex >= 0 ? ['Zuordnung übernommen und zurückgenommen'] : []),
              'Originaltexte unverändert',
            ],
            organizationId: record.id,
            result,
            run: run.data,
            noteIds: notes.map((n: Note) => n.id),
          },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          model: 'gpt-5.6-luna',
          claims: result.claims.length,
          relations: result.relations.length,
          collections: result.collections.length,
          run: run.data,
          report: '.notto-dev/harness-demo-result.json',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
  240000,
);
