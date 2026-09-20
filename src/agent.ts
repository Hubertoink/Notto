import { z } from 'zod';
import {
  agentInstructions,
  notebookTools,
  organizationSchema,
  organizationClaims,
  organizationRecordSchema,
  toolArguments,
  type OrganizationDecision,
} from './agent-policy';
import {
  config,
  eligible,
  evidence,
  knowledge,
  request,
  responseText,
  semanticSearch,
  verifyClaims,
  type Evidence,
  type KnowledgeRecord,
} from './intelligence';
import { contentRevision, reviseNote, titleOf } from './domain';
import { evidenceCurrent } from './evidence-policy';
import { diverseHits, lexicalScore, splitEvidence } from './retrieval';
import { noteReferenceIds, normalizeCollections } from './note-tools';
import { repo } from './repository';

type Progress = (message: string) => void;
const active = new Set<string>();
export async function organizeNotebook(
  scope: string,
  instruction: string,
  signal?: AbortSignal,
  progress: Progress = () => {},
) {
  if (!instruction.trim() || instruction.length > 1000)
    throw new Error('Bitte einen Auftrag mit höchstens 1.000 Zeichen eingeben.');
  if (active.has(scope)) throw new Error('Für dieses Notizbuch läuft bereits eine Organisation.');
  active.add(scope);
  const started = Date.now(),
    id = crypto.randomUUID();
  const trace: { action: string; sources: number; at: string }[] = [];
  let status = 'failed',
    calls = 0;
  const guard = async (sources: Evidence[] = []) => {
    if (signal?.aborted) throw new Error('Organisation abgebrochen.');
    if (Date.now() - started > 180000)
      throw new Error('Zeitlimit erreicht. Bitte den Auftrag enger eingrenzen.');
    if (!config(scope).enabled) throw new Error('KI wurde ausgeschaltet.');
    const notes = await repo.list(scope);
    const records = sources.some((source) => source.extractionId) ? await knowledge.list(scope) : undefined;
    if (sources.some((source) => !evidenceCurrent(source, notes, scope, config(scope), records)))
      throw new Error('Eine Quelle wurde geändert oder ausgeschlossen. Bitte erneut starten.');
    return notes.filter((n) => eligible(n));
  };
  try {
    progress('Passende Notizen suchen …');
    const sources: Evidence[] = [];
    const add = (items: Evidence[]) => {
      const added: (Evidence & { index: number })[] = [];
      for (const item of items) {
        let index = sources.findIndex(
          (s) =>
            s.noteId === item.noteId &&
            s.revision === item.revision &&
            s.attachment === item.attachment &&
            s.page === item.page &&
            s.text === item.text,
        );
        if (index < 0) {
          if (sources.length >= 24 || JSON.stringify([...sources, item]).length > 58000) continue;
          index = sources.push(item) - 1;
        }
        added.push({ ...sources[index], index });
      }
      return added;
    };
    const hits = add(await semanticSearch(scope, instruction, await guard()));
    const input: any[] = [{ role: 'user', content: JSON.stringify({ request: instruction, sources: hits }) }];
    const seenCalls = new Set<string>();
    let toolCount = 0,
      repaired = false;
    for (let round = 0; round < 6; round++) {
      await guard(sources);
      if (JSON.stringify(input).length > 100000)
        throw new Error('Kontextlimit erreicht. Bitte den Auftrag enger eingrenzen.');
      progress(round ? 'Zusammenhänge prüfen …' : 'Quellen auswerten …');
      const response = await request(scope, 'responses', {
        model: config(scope).model,
        store: false,
        memoryQuery: instruction,
        instructions:
          agentInstructions +
          ' Formuliere pro claim genau eine kurze Aussage. Bewahre Zeitform und Status: geplant, noch zu erstellen und bereits erledigt sind verschieden. Bei facts bevorzuge quellennahe Formulierungen. conflict zitiert immer beide widersprüchlichen Quellen. Ein Sammlungsgrund darf nur die einzeln zitierte Notiz beschreiben.',
        input,
        tools: round < 4 && !repaired ? notebookTools : [],
        parallel_tool_calls: false,
        include: ['reasoning.encrypted_content'],
        text: {
          format: {
            type: 'json_schema',
            name: 'notto_organization',
            strict: true,
            schema: z.toJSONSchema(organizationSchema),
          },
        },
      });
      calls++;
      if (response.status && response.status !== 'completed')
        throw new Error('Die KI-Antwort ist unvollständig.');
      const toolCalls = (response.output ?? []).filter((item: any) => item.type === 'function_call');
      if (!toolCalls.length) {
        await guard(sources);
        let result;
        try {
          result = organizationSchema.parse(JSON.parse(responseText(response)));
          const claims = organizationClaims(result, sources);
          if (claims.length) {
            progress('Aussagen und Belege gegenprüfen …');
            calls++;
            await verifyClaims(scope, claims, sources);
          }
        } catch (error) {
          if (
            !(error instanceof z.ZodError) &&
            !(error instanceof SyntaxError) &&
            !(error instanceof Error && error.message.startsWith('Ergebnis verworfen:'))
          )
            throw error;
          if (repaired || round === 5) throw error;
          repaired = true;
          trace.push({ action: 'correct_evidence', sources: sources.length, at: new Date().toISOString() });
          input.push(...response.output, {
            role: 'user',
            content: `Die Prüfung hat das Ergebnis verworfen: ${error instanceof Error ? error.message : 'Ungültiges Format'}. Korrigiere das Ergebnis einmal mit vorhandenen Quellen. Kopiere Zitate exakt aus der richtigen Quelle. conflict muss beide widersprüchlichen Quellen zitieren. Beschränke jede Aussage und jeden Zuordnungsgrund auf die eigenen Belege. Entferne nicht belegbare Aussagen; insufficient true bei fehlenden Belegen.`,
          });
          continue;
        }
        await guard(sources);
        const record = {
          id,
          scope,
          noteId: id,
          revision: id,
          kind: 'organization' as const,
          at: new Date().toISOString(),
          data: { ...result, sources, request: instruction },
        };
        await knowledge.put(record);
        status = 'completed';
        return record;
      }
      if (round >= 4 || repaired || toolCount + toolCalls.length > 8)
        throw new Error('Werkzeuglimit erreicht. Bitte den Auftrag enger eingrenzen.');
      // Preserve reasoning items as required for stateless Responses continuations.
      input.push(...response.output);
      for (const call of toolCalls) {
        if (seenCalls.has(call.call_id)) throw new Error('Doppelter Werkzeugaufruf verworfen.');
        seenCalls.add(call.call_id);
        toolCount++;
        const notes = await guard(sources),
          records = await knowledge.list(scope);
        let output: unknown;
        if (call.name === 'search_notes') {
          const { query } = toolArguments.search_notes.parse(JSON.parse(call.arguments));
          const chunks: Evidence[] = [];
          for (const note of notes) chunks.push(...splitEvidence(await evidence(note, records)));
          output = {
            sources: add(
              diverseHits(
                chunks
                  .map((chunk) => ({ ...chunk, score: lexicalScore(chunk, query) }))
                  .filter((c) => c.score > 0),
                6,
              ),
            ),
          };
        } else if (call.name === 'read_note') {
          const { noteId, offset } = toolArguments.read_note.parse(JSON.parse(call.arguments));
          const note = notes.find((n) => n.id === noteId);
          if (!note) output = { error: 'Notiz nicht vorhanden oder nicht freigegeben.' };
          else {
            const decisions = records
              .filter((r) => r.kind === 'decision' && r.noteId === note.id)
              .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
            const unique = new Map<string, unknown>();
            for (const decision of decisions) {
              const data = decision.data as { key: string };
              if (!unique.has(data.key)) unique.set(data.key, data);
            }
            const related = records
              .filter((r) => r.kind === 'organization')
              .flatMap((r) => {
                const parsed = organizationRecordSchema.safeParse(r.data);
                if (
                  !parsed.success ||
                  parsed.data.sources.some((s) => !evidenceCurrent(s, notes, scope, config(scope), records))
                )
                  return [];
                return parsed.data.relations.flatMap((relation, index) => {
                  if (organizationDecision(records, r.id, `relation:${index}`)?.status !== 'accepted')
                    return [];
                  const from = parsed.data.sources[relation.from.index]?.noteId;
                  const to = parsed.data.sources[relation.to.index]?.noteId;
                  return from === note.id || to === note.id
                    ? [{ from, to, kind: relation.kind, reason: relation.reason }]
                    : [];
                });
              });
            output = {
              title: titleOf(note.content),
              sources: add(
                splitEvidence([
                  {
                    noteId,
                    revision: contentRevision(note),
                    text: note.content.slice(offset, offset + 6000),
                  },
                ]),
              ),
              nextOffset: offset + 6000 < note.content.length ? offset + 6000 : null,
              links: noteReferenceIds(note.content)
                .flatMap((id) =>
                  notes.filter((n) => n.id === id).map((n) => ({ id: n.id, title: titleOf(n.content) })),
                )
                .slice(0, 30),
              relations: related.slice(0, 12),
              decisions: [...unique.values()].slice(0, 20).map((value) => {
                const data = value as { status?: string; title?: string; detail?: string };
                return {
                  status: data.status,
                  title: String(data.title ?? '').slice(0, 250),
                  detail: String(data.detail ?? '').slice(0, 1000),
                };
              }),
            };
          }
        } else throw new Error('Nicht freigegebenes Werkzeug verworfen.');
        trace.push({ action: call.name, sources: sources.length, at: new Date().toISOString() });
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
      }
    }
    throw new Error('Organisation konnte nicht abgeschlossen werden.');
  } finally {
    active.delete(scope);
    if (signal?.aborted) status = 'cancelled';
    await knowledge.append({ scope, id, revision: id }, 'agent-run', {
      status,
      calls,
      durationMs: Date.now() - started,
      trace,
    });
  }
}

export function organizationDecision(records: KnowledgeRecord[], id: string, item: string) {
  return records
    .filter(
      (r) =>
        r.kind === 'organization-decision' &&
        (r.data as OrganizationDecision).organizationId === id &&
        (r.data as OrganizationDecision).item === item,
    )
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))[0]?.data as
    OrganizationDecision | undefined;
}
export async function decideOrganization(
  record: KnowledgeRecord,
  item: string,
  status: Exclude<OrganizationDecision['status'], 'applying' | 'undoing'>,
) {
  const data = organizationRecordSchema.parse(record.data);
  if (item !== 'overview' && !/^(relation|collection):\d+$/.test(item))
    throw new Error('Ungültiger Vorschlag.');
  if (item.startsWith('relation:') && !data.relations[Number(item.split(':')[1])])
    throw new Error('Beziehung fehlt.');
  const records = await knowledge.list(record.scope);
  const previous = organizationDecision(records, record.id, item);
  const decision: OrganizationDecision = { organizationId: record.id, item, status };
  if (item.startsWith('collection:') && status !== 'dismissed') {
    const index = Number(item.split(':')[1]),
      proposal = data.collections[index];
    if (!proposal) throw new Error('Zuordnung fehlt.');
    const source = data.sources[proposal.source.index];
    const note = await repo.get(record.scope, source.noteId);
    if (!note || !eligible(note)) throw new Error('Notiz ist nicht mehr freigegeben.');
    if (status === 'accepted') {
      if (previous?.appliedRevision === note.revision && ['applying', 'accepted'].includes(previous.status)) {
        await knowledge.append(
          { scope: record.scope, id: record.id, revision: record.revision },
          'organization-decision',
          { ...previous, status: 'accepted' },
        );
        return;
      }
      if (!evidenceCurrent(source, [note], record.scope, config(record.scope), records))
        throw new Error('Notiz wurde geändert. Bitte erneut organisieren.');
      const name = normalizeCollections([proposal.name])[0];
      if (!name) throw new Error('Sammlungsname fehlt.');
      if ((note.collections ?? []).some((c) => c.toLocaleLowerCase('de') === name.toLocaleLowerCase('de')))
        throw new Error('Die Notiz gehört bereits zu dieser Sammlung.');
      const collections = normalizeCollections([...(note.collections ?? []), name]);
      if (!collections.includes(name)) throw new Error('Höchstens 30 Sammlungen je Notiz.');
      const updated = reviseNote(note, { collections });
      Object.assign(decision, {
        noteId: note.id,
        collection: name,
        appliedRevision: updated.revision,
        beforeRevision: note.revision,
      });
      // Durable intent makes a completed note write recoverable even if the final event fails.
      await knowledge.append(
        { scope: record.scope, id: record.id, revision: record.revision },
        'organization-decision',
        { ...decision, status: 'applying' },
      );
      await repo.put(updated, note.revision);
    } else {
      if (previous?.status === 'undoing' && previous.appliedRevision === note.revision) {
        await knowledge.append(
          { scope: record.scope, id: record.id, revision: record.revision },
          'organization-decision',
          { ...previous, status: 'undone' },
        );
        return;
      }
      const expected = previous?.status === 'undoing' ? previous.beforeRevision : previous?.appliedRevision;
      if (!expected || note.revision !== expected)
        throw new Error(
          'Die Notiz wurde seit der Zuordnung geändert. Bitte die Sammlung im Editor entfernen.',
        );
      const updated = reviseNote(note, {
        collections: (note.collections ?? []).filter((c) => c !== previous?.collection),
      });
      Object.assign(decision, {
        noteId: note.id,
        collection: previous?.collection,
        beforeRevision: note.revision,
        appliedRevision: updated.revision,
      });
      await knowledge.append(
        { scope: record.scope, id: record.id, revision: record.revision },
        'organization-decision',
        { ...decision, status: 'undoing' },
      );
      await repo.put(updated, note.revision);
    }
  } else if (status === 'accepted') {
    const notes = await repo.list(record.scope);
    if (
      data.sources.some(
        (source) => !evidenceCurrent(source, notes, record.scope, config(record.scope), records),
      )
    )
      throw new Error('Eine Quelle wurde geändert. Bitte erneut organisieren.');
  }
  await knowledge.append(
    { scope: record.scope, id: record.id, revision: record.revision },
    'organization-decision',
    decision,
  );
}
