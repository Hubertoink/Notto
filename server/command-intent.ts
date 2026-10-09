import { commandUrls } from '../src/note-command.js';
import { youtubeVideoId } from '../src/youtube.js';

const videoRequest = /\b(?:video\w*|youtube|transkript\w*|untertitel\w*)\b/u;

/** A named video is the source unless the request also names other note material. */
export function commandFocusesVideo(prompt: string, content: string) {
  const text = prompt.normalize('NFKC').toLocaleLowerCase('de');
  if (!videoRequest.test(text)) return false;
  if (!commandUrls(`${prompt}\n${content}`).some(youtubeVideoId)) return false;
  if (
    /\b(?:pdf\w*|dokument\w*|anhang|anhänge\w*|angehäng\w*|notiz\w*|artikel\w*|quellen|sammlung\w*)\b/u.test(
      text,
    )
  )
    return false;
  // A document may be requested by its link label instead of the word "PDF".
  for (const match of content.matchAll(/\[([^\]\n]+)\]\(([^\s)]+)\)/gu)) {
    const label = match[1].normalize('NFKC').toLocaleLowerCase('de').trim();
    if (!youtubeVideoId(match[2]) && label.length >= 4 && text.includes(label)) return false;
  }
  return true;
}

/** Open-ended commands may research any topic; only source-bound work stays local. */
export function commandNeedsSearch(prompt: string, hasVisualSource = true, hasVideoSource = false) {
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
  // Applying a video's ideas is source work. Explicit requests for outside material still research.
  if (
    hasVideoSource &&
    videoRequest.test(text) &&
    !/\b(?:alternativ\w*|weiterführ\w*|extern\w*|literatur\w*|artikel\w*|bücher|buch\w*|empfiehl\w*|empfehle\w*)\b/u.test(
      text,
    )
  )
    return false;
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
