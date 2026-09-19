import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) return json({ error: 'Login required' }, 401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user) return json({ error: 'Invalid session' }, 401);
    // Explicit allow-list prevents newly registered users from spending the owner's key.
    const allowed = (Deno.env.get('NOTTO_AI_USERS') || '').split(',').map((s) => s.trim());
    if (!allowed.includes(user.id))
      return json({ error: 'KI für dieses Konto noch nicht freigeschaltet' }, 403);
    if (Number(req.headers.get('content-length') || 0) > 20 * 1024 * 1024)
      return json({ error: 'Request too large' }, 413);
    const raw = await req.text();
    if (raw.length > 20 * 1024 * 1024) return json({ error: 'Request too large' }, 413);
    const { endpoint, body } = JSON.parse(raw);
    if (
      !['responses', 'embeddings', 'audio/transcriptions'].includes(endpoint) ||
      !body ||
      typeof body !== 'object'
    )
      return json({ error: 'Invalid request' }, 400);
    const { data: quota, error: quotaError } = await client.rpc('consume_ai_request');
    if (quotaError || !quota)
      return json({ error: 'Tägliches Serverlimit erreicht oder Migration fehlt' }, 429);
    const key = Deno.env.get('OPENAI_API_KEY');
    if (!key) return json({ error: 'KI ist noch nicht eingerichtet' }, 503);
    let payload: BodyInit;
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (endpoint === 'audio/transcriptions') {
      if (typeof body.audio !== 'string' || body.audio.length > 17 * 1024 * 1024)
        return json({ error: 'Invalid audio' }, 400);
      const mime = body.mime === 'audio/mp4' ? 'audio/mp4' : 'audio/webm';
      const bytes = Uint8Array.from(atob(body.audio), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append('model', 'gpt-transcribe');
      form.append(
        'file',
        new Blob([bytes], { type: mime }),
        mime === 'audio/mp4' ? 'recording.mp4' : 'recording.webm',
      );
      payload = form;
    } else {
      headers['Content-Type'] = 'application/json';
      const permitted = (Deno.env.get('NOTTO_AI_MODELS') || 'gpt-4.1-mini,text-embedding-3-small')
        .split(',')
        .map((s) => s.trim());
      if (!permitted.includes(body.model))
        return json({ error: 'Modell auf dem Server nicht freigeschaltet' }, 400);
      const clean: Record<string, unknown> = { model: body.model, input: body.input };
      if (endpoint === 'responses')
        Object.assign(clean, {
          store: false,
          instructions: body.instructions,
          text: body.text,
          max_output_tokens: 4000,
          max_tool_calls: 2,
          ...(body.tools?.length
            ? { tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'] }
            : {}),
        });
      else clean.encoding_format = 'float';
      payload = JSON.stringify(clean);
    }
    const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(120000),
    });
    return json(await response.json(), response.status);
  } catch (e) {
    console.error(e instanceof Error ? e.name : 'AI error');
    return json({ error: 'KI-Anfrage fehlgeschlagen. Bitte erneut versuchen.' }, 500);
  }
});
