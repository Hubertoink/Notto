import { z } from 'zod';
import { limit, type Database } from './database.js';
export interface AIEnvironment {
  openaiKey?: string;
  models: string[];
  dailyLimit: number;
}
export async function openai(
  db: Database,
  userId: string,
  endpoint: string,
  body: Record<string, unknown>,
  env: AIEnvironment,
) {
  if (!env.openaiKey)
    throw Object.assign(new Error('OpenAI ist auf dem Server noch nicht eingerichtet.'), { statusCode: 503 });
  if (!['responses', 'embeddings', 'audio/transcriptions'].includes(endpoint))
    throw Object.assign(new Error('Ungültige KI-Funktion'), { statusCode: 400 });
  let payload: BodyInit;
  const headers: Record<string, string> = { Authorization: `Bearer ${env.openaiKey}` };
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
    if (!env.models.includes(model))
      throw Object.assign(new Error('Modell auf dem Server nicht freigeschaltet.'), { statusCode: 400 });
    if (!body.input) throw Object.assign(new Error('KI-Eingabe fehlt'), { statusCode: 400 });
    const clean: Record<string, unknown> = { model, input: body.input };
    if (endpoint === 'responses')
      Object.assign(clean, {
        store: false,
        instructions: body.instructions,
        text: body.text,
        max_output_tokens: 4000,
        max_tool_calls: 2,
        ...(Array.isArray(body.tools) && body.tools.length
          ? { tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'] }
          : {}),
      });
    else clean.encoding_format = 'float';
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(clean);
  }
  await limit(db, `ai:${userId}`, env.dailyLimit, 86400);
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(120000),
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
