import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { contentRevision, type Note } from '../src/domain.js';
import { noteAllowed } from '../src/evidence-policy.js';
import {
  discoverRelations,
  candidateInstructions,
  candidateResponse,
  relationInstructions,
  relationResponse,
  validRelation,
  type RelationBatch,
} from '../src/note-relations.js';
import { openai, type AIEnvironment } from './openai.js';
import type { Database } from './database.js';

export async function queueExistingRelations(db: Database) {
  const rows = (
    await db.query(
      'SELECT n.user_id,n.document,s.document AS settings FROM notes n JOIN ai_settings s ON s.user_id=n.user_id',
    )
  ).rows;
  for (const row of rows) {
    const n = row.document as Note;
    if (
      !row.settings?.enabled ||
      !row.settings.auto ||
      !noteAllowed(n, row.settings) ||
      n.content.length > 60000
    )
      continue;
    await db.query(
      'INSERT INTO jobs(id,user_id,note_id,revision,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [randomUUID(), row.user_id, n.id, contentRevision(n), 'relations'],
    );
  }
}

export async function findServerRelations(
  db: Database,
  env: AIEnvironment,
  user: string,
  note: Note,
  settings: any,
) {
  const load = async () =>
    (await db.query('SELECT document FROM notes WHERE user_id=$1', [user])).rows.map(
      (r) => r.document as Note,
    );
  const records = (
    await db.query("SELECT document FROM knowledge WHERE user_id=$1 AND document->>'kind'='note-relations'", [
      user,
    ])
  ).rows.map((r) => r.document.data as RelationBatch);
  const snapshot = (await load()).filter((n) => noteAllowed(n, settings));
  async function ask<T extends z.ZodType>(
    instructions: string,
    input: unknown,
    schema: T,
  ): Promise<z.infer<T>> {
    const liveSettings = (await db.query('SELECT document FROM ai_settings WHERE user_id=$1', [user])).rows[0]
      ?.document;
    const payload = input as {
      source?: { id: string };
      candidates?: { id: string }[];
      notes?: { id: string }[];
    };
    const ids = [
      ...(payload.source ? [payload.source] : []),
      ...(payload.candidates || payload.notes || []),
    ].map((n) => n.id);
    const live = await load();
    if (
      !liveSettings?.enabled ||
      !liveSettings.auto ||
      ids.some((id) => {
        const current = live.find((n) => n.id === id),
          before = snapshot.find((n) => n.id === id);
        return (
          !current || !before || !noteAllowed(current, liveSettings) || current.content !== before.content
        );
      })
    )
      throw new Error(
        'Notizen oder KI-Freigaben haben sich geändert. Die Verknüpfungsprüfung wird wiederholt.',
      );
    const response: any = await openai(
      db,
      user,
      'responses',
      {
        model: settings.model,
        store: false,
        instructions,
        input: JSON.stringify(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'note_relations',
            strict: true,
            schema: z.toJSONSchema(schema),
          },
        },
      },
      env,
    );
    if (response.status !== 'completed') throw new Error('Unvollständige KI-Antwort.');
    return schema.parse(
      JSON.parse(
        response.output
          ?.flatMap((o: any) => o.content || [])
          .filter((c: any) => c.type === 'output_text')
          .map((c: any) => c.text)
          .join('\n') || '{}',
      ),
    );
  }
  const result = await discoverRelations(
    note,
    snapshot,
    records,
    (input) => ask(candidateInstructions, input, candidateResponse),
    (input) => ask(relationInstructions, input, relationResponse),
  );
  const currentSettings = (await db.query('SELECT document FROM ai_settings WHERE user_id=$1', [user]))
    .rows[0]?.document;
  if (!currentSettings?.enabled || !currentSettings.auto) return;
  const fresh = (await load()).filter((n) => noteAllowed(n, currentSettings));
  const current = fresh.find((n) => n.id === note.id);
  if (!current || contentRevision(current) !== contentRevision(note)) return;
  result.suggestions = result.suggestions.filter((r) => validRelation(r, fresh));
  if (!result.checked.length) return;
  const id = randomUUID();
  await db.query('INSERT INTO knowledge(user_id,id,document) VALUES($1,$2,$3)', [
    user,
    id,
    JSON.stringify({
      id,
      scope: user,
      noteId: note.id,
      revision: contentRevision(note),
      kind: 'note-relations',
      at: new Date().toISOString(),
      data: result,
    }),
  ]);
  if (result.checked.length === 20)
    await db.query(
      'INSERT INTO jobs(id,user_id,note_id,revision,kind) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [randomUUID(), user, note.id, contentRevision(note), `relations:${id}`],
    );
}
