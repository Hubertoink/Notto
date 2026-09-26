import { memoryContext } from '../src/memory-policy.js';
import { knowledgeRole } from '../src/knowledge-policy.js';
import { z } from 'zod';
import { type Database } from './database.js';
import { availableModels } from './models.js';
import { analysisModel } from '../src/ai-models.js';
import { permittedTools } from '../src/agent-policy.js';
export interface AIEnvironment {
  openaiKey?: string;
  models: string[];
  /** Ignored legacy deployment option. */
  dailyLimit?: number;
  dataDir?: string;
}
export async function openai(
  db: Database,
  userId: string,
  endpoint: string,
  body: Record<string, unknown>,
  env: AIEnvironment,
  signal?: AbortSignal,
) {
  if (!env.openaiKey)
    throw Object.assign(new Error('OpenAI ist auf dem Server noch nicht eingerichtet.'), { statusCode: 503 });
  if (!['responses', 'embeddings', 'audio/transcriptions'].includes(endpoint))
    throw Object.assign(new Error('Ungültige KI-Funktion'), { statusCode: 400 });
  let payload: BodyInit;
  const headers: Record<string, string> = { Authorization: `Bearer ${env.openaiKey}` };
  const preferences = await db.query('SELECT document FROM ai_settings WHERE user_id=$1', [userId]);
  const settings = preferences.rows[0]?.document ?? { excludedNotes: [], excludedTags: '' };
  if (settings.enabled === false)
    throw Object.assign(new Error('KI wurde für dieses Notizbuch ausgeschaltet.'), { statusCode: 403 });
  if (endpoint === 'audio/transcriptions') {
    const audio = z
        .string()
        .max(17 * 1024 * 1024)
        .parse(body.audio),
      mime = z.enum(['audio/mp4', 'audio/webm']).parse(body.mime);
    const bytes = Buffer.from(audio, 'base64');
    if (bytes.length > 12 * 1024 * 1024)
      throw Object.assign(new Error('Aufnahme zu groß'), { statusCode: 413 });
    const form = new FormData();
    form.append('model', 'gpt-transcribe');
    form.append(
      'file',
      new Blob([bytes], { type: mime }),
      mime === 'audio/mp4' ? 'recording.mp4' : 'recording.webm',
    );
    payload = form;
  } else {
    const model = z.string().parse(body.model);
    const supported = endpoint === 'responses' ? analysisModel(model) : model === 'text-embedding-3-small';
    const allowed = env.models.length ? env.models : await availableModels(env);
    if (!supported || !allowed.includes(model))
      throw Object.assign(new Error('Modell auf dem Server nicht freigeschaltet.'), { statusCode: 400 });
    if (!body.input) throw Object.assign(new Error('KI-Eingabe fehlt'), { statusCode: 400 });
    const clean: Record<string, unknown> = { model, input: body.input };
    if (endpoint === 'responses') {
      const tools = permittedTools(body.tools);
      const web = tools.some((tool) => tool.type === 'web_search');
      const [memories, notes] =
        body.memory === false
          ? [{ rows: [] }, { rows: [] }]
          : await Promise.all([
              db.query(
                "SELECT document FROM knowledge WHERE user_id=$1 AND document->>'kind' IN ('memory','decision','analysis')",
                [userId],
              ),
              db.query('SELECT document FROM notes WHERE user_id=$1', [userId]),
            ]);
      const context =
        body.memory === false
          ? ''
          : memoryContext(
              memories.rows.map((r) => r.document),
              notes.rows.map((r) => ({ ...r.document, scope: userId })),
              settings,
              userId,
              body.memoryQuery ?? body.input,
            );
      Object.assign(clean, {
        store: false,
        instructions: `${knowledgeRole}\n${body.instructions ?? ''}${context}`,
        text: body.text,
        max_output_tokens: 4000,
        max_tool_calls: web && body.max_tool_calls === 6 ? 6 : 2,
        ...(tools.length ? { tools, parallel_tool_calls: false } : {}),
        ...(web && body.tool_choice === 'required' ? { tool_choice: 'required' } : {}),
        include: web ? ['web_search_call.action.sources'] : ['reasoning.encrypted_content'],
      });
    } else clean.encoding_format = 'float';
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(clean);
  }
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers,
    body: payload,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
  });
  const result = (await response.json()) as { error?: { message?: string } };
  if (!response.ok)
    throw Object.assign(
      new Error(
        response.status === 429
          ? 'OpenAI-Limit erreicht. Bitte später versuchen.'
          : `OpenAI-Anfrage fehlgeschlagen (${response.status}).`,
      ),
      { statusCode: 502 },
    );
  return result;
}
