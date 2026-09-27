/** Decide from the explicit command, never from instructions embedded in a note. */
export function commandNeedsSearch(prompt: string) {
  const text = prompt.normalize('NFKC').toLocaleLowerCase('de');
  if (/\b(such\w*|recherch\w*|rezension\w*|review\w*|aktuell\w*|neueste\w*|letzte[nrsm]?)\b/u.test(text))
    return true;

  // Editing supplied material does not request additional literature.
  if (
    /(?<!\p{L})(zusammenfass\w*|übersetz\w*|korrigier\w*|umformulier\w*|sortier\w*)\b/u.test(text) ||
    /\bfasse\b.*\bzusammen\b/su.test(text)
  )
    return false;

  return (
    /\b(leseempfehl\w*|lesetipp\w*|literaturempfehl\w*|buchtipp\w*|buchempfehl\w*|leseliste\w*|literaturliste\w*)\b/u.test(
      text,
    ) ||
    (/\b(empfiehl\w*|empfehl\w*|brauche\w*|benötige\w*|nenne\w*|gib|welche\w*|kennst)\b/u.test(text) &&
      /\b(artikel\w*|literatur\w*|bücher\w*|buecher\w*|büch\w*|buch|texte\w*|quellen\w*|veröffentlich\w*|publikation\w*)\b/u.test(
        text,
      )) ||
    /\bwas\b.*\b(lesen|lies\w*)\b/su.test(text)
  );
}
