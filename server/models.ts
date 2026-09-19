import { z } from 'zod';
import { analysisModels } from '../src/ai-models.js';
import type { AIEnvironment } from './openai.js';
const caches = new WeakMap<AIEnvironment, { expires: number; request: Promise<string[]> }>();
export async function availableModels(env: AIEnvironment): Promise<string[]> {
  if (!env.openaiKey)
    throw Object.assign(new Error('OpenAI ist auf dem Server noch nicht eingerichtet.'), { statusCode: 503 });
  const cached = caches.get(env);
  if (cached && cached.expires > Date.now()) return cached.request;
  const request = (async () => {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${env.openaiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(
          response.status === 401
            ? 'Der OpenAI-Schlüssel ist ungültig.'
            : response.status === 403
              ? 'Dem OpenAI-Schlüssel fehlt die Berechtigung zum Lesen der Modelle.'
              : 'Die OpenAI-Modellliste konnte nicht geladen werden. Bitte erneut versuchen.',
        ),
        { statusCode: 502 },
      );
    const data = z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await response.json());
    return data.data.map((m) => m.id);
  })();
  caches.set(env, { expires: Date.now() + 300000, request });
  try {
    return await request;
  } catch (e) {
    caches.delete(env);
    throw e;
  }
}
export async function selectableModels(env: AIEnvironment) {
  const ids = await availableModels(env);
  return analysisModels(env.models.length ? ids.filter((id) => env.models.includes(id)) : ids);
}
