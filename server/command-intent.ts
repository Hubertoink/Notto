/** Open-ended commands may research any topic; only source-bound work stays local. */
export function commandNeedsSearch(prompt: string, hasVisualSource = true) {
  const text = prompt.normalize('NFKC').toLocaleLowerCase('de');
  // Explicit source restrictions take precedence over words such as "recommend".
  if (
    /(?:ohne|keine?)\s+(?:websuche|internet(?:suche)?|recherche)|(?:nur|ausschließlich)\s+(?:aus|anhand|mit|auf basis)\s+(?:der |dieser |meiner |den |diesen |meinen )?(?:notiz\w*|quellen|text\w*)/u.test(
      text,
    )
  )
    return false;
  if (/\b(such\w*|recherch\w*|rezension\w*|review\w*|aktuell\w*|neueste\w*|letzte[nrsm]?)\b/u.test(text))
    return true;
  // Mixed requests must not lose their research part just because they also ask for a summary.
  if (
    /\b(empfiehl\w*|empfehle\w*|vorschlag\w*|vorschläge\w*|alternativ\w*|vergleiche\w*|gib|nenne|welche)\b/u.test(
      text,
    )
  )
    return true;
  if (
    /(?<!\p{L})(zusammenfass\w*|übersetz\w*|korrigier\w*|umformulier\w*|sortier\w*|formatier\w*)\b/u.test(
      text,
    ) ||
    /\bfasse\b.*\bzusammen\b/su.test(text)
  )
    return false;
  // Existing browser capture tasks inspect the supplied page directly.
  if (/\b(bild\w*|bilder\w*|screenshot\w*|visuell\w*|icon\w*|komponente\w*)\b/u.test(text))
    return !hasVisualSource;
  return true;
}
