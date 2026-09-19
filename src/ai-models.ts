// /v1/models supplies availability, not capability flags. Limit analysis to
// general-purpose families supported by our Responses + structured-output flow.
export function analysisModel(id: string) {
  return (
    /^gpt-(?:4\.1(?:-|$)|4o(?:-|$)|[5-9](?:[.-]|$))/.test(id) &&
    !/(audio|realtime|transcrib|tts|image|search|deep-research|codex|chat-latest)/.test(id)
  );
}
export function analysisModels(ids: string[]) {
  return [...new Set(ids.filter(analysisModel))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}
