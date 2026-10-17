import { createLibrary, createParser, defineComponent } from '@openuidev/lang-core';
import { z } from 'zod';

// Layout refers only to verified result items. It cannot introduce content, URLs or actions.
const indices = z.array(z.number().int().min(0).max(7)).min(1).max(8);
export const presentationComponents = [
  defineComponent({
    name: 'Comparison',
    description: 'Vergleich belegter Aspekte als Tabelle. Mindestens zwei Ergebnisse.',
    props: z.object({ items: indices.min(2) }),
    component: null,
  }),
  defineComponent({
    name: 'Plan',
    description: 'Geordnete Schritte oder Phasen eines Ablaufplans.',
    props: z.object({ items: indices }),
    component: null,
  }),
  defineComponent({
    name: 'SourceCards',
    description: 'Kernaussagen und Vorschläge mit ihren Quellen als Karten.',
    props: z.object({ items: indices }),
    component: null,
  }),
];
export const answerComponent = defineComponent({
  name: 'Answer',
  description: 'Enthält die Abschnitte der Antwort.',
  props: z.object({
    sections: z
      .array(
        z.union([
          presentationComponents[0].ref,
          presentationComponents[1].ref,
          presentationComponents[2].ref,
        ]),
      )
      .min(1)
      .max(4),
  }),
  component: null,
});
export const presentationLibrary = createLibrary({
  components: [answerComponent, ...presentationComponents],
  root: 'Answer',
});
export const presentationInstructions = presentationLibrary.prompt({
  preamble:
    'Die Antwort bleibt im vorgegebenen JSON-Schema. Nur der optionale Inhalt des Felds presentation verwendet die folgende OpenUI-Sprache; niemals die gesamte Antwort in OpenUI ausgeben.',
  additionalRules: [
    'Dieses Format gilt ausschließlich für das Feld presentation der JSON-Antwort, nicht für die gesamte Antwort.',
    'Verwende null für reine Textantworten. Sonst beschreibe nur das Layout mit Answer, Comparison, Plan und SourceCards.',
    'items sind nullbasierte Indizes in das items-Array deiner Antwort. Jedes Ergebnis muss genau einmal vorkommen. Keine Texte, neuen Inhalte, Funktionen, Zustände oder Aktionen in presentation.',
    'Bei Vergleichen ordne vergleichbare Aspekte als eigene items für Comparison an. Bei Ablaufplänen sind items die Schritte in sinnvoller Reihenfolge. Für andere Antworten nutze SourceCards.',
  ],
  examples: ['root = Answer([Comparison([0, 1]), SourceCards([2])])', 'root = Answer([Plan([0, 1, 2])])'],
});

export interface CommandPresentationData {
  version: 1;
  source: string;
}
export interface PresentationSection {
  type: 'Comparison' | 'Plan' | 'SourceCards';
  items: number[];
}

/** Strict static subset; canonicalize before rendering so no generated code is executed. */
export function readPresentation(value: unknown, itemCount: number): PresentationSection[] | null {
  try {
    const data = z.object({ version: z.literal(1), source: z.string().max(4000) }).parse(value);
    if (!itemCount || itemCount > 8 || !/^[\w\s=(),\[\]]+$/.test(data.source)) return null;
    const parsed = createParser(presentationLibrary.toJSONSchema(), 'Answer').parse(data.source);
    if (
      parsed.meta.incomplete ||
      parsed.meta.errors.length ||
      parsed.meta.unresolved.length ||
      parsed.meta.orphaned.length ||
      parsed.meta.statementCount > 12 ||
      parsed.queryStatements.length ||
      parsed.mutationStatements.length ||
      Object.keys(parsed.stateDeclarations).length ||
      parsed.root?.typeName !== 'Answer'
    )
      return null;
    const sections = z
      .array(
        z.object({
          type: z.literal('element'),
          typeName: z.enum(['Comparison', 'Plan', 'SourceCards']),
          partial: z.literal(false),
          props: z.object({ items: indices }).strict(),
        }),
      )
      .min(1)
      .max(4)
      .parse(parsed.root.props.sections);
    const all = sections.flatMap((section) => section.props.items);
    if (
      all.length !== itemCount ||
      new Set(all).size !== itemCount ||
      all.some((i) => i >= itemCount) ||
      sections.some((s) => s.typeName === 'Comparison' && s.props.items.length < 2)
    )
      return null;
    return sections.map((section) => ({ type: section.typeName, items: section.props.items }));
  } catch {
    return null;
  }
}

export function storePresentation(source: unknown, itemCount: number): CommandPresentationData | undefined {
  const sections = readPresentation({ version: 1, source }, itemCount);
  return sections
    ? {
        version: 1,
        source: `root = Answer([${sections.map((s) => `${s.type}([${s.items.join(',')}])`).join(',')}])`,
      }
    : undefined;
}
