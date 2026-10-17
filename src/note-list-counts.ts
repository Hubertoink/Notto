import type { Note } from './domain';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const markdown = unified().use(remarkParse);
type Node = { type: string; url?: string; identifier?: string; children?: Node[] };

/** Count current document files once, whether in the library or attached to notes. */
export function noteListCounts(notes: readonly Note[]) {
  const documents = new Set<string>();
  let noteCount = 0;
  for (const note of notes) {
    if (!note.document) noteCount++;
    else documents.add(`${note.scope}:${note.document.attachmentId}`);
    if (!note.content.includes('attachments/')) continue;
    const tree = markdown.parse(note.content);
    const definitions = new Map<string, string>();
    function collect(node: Node) {
      if (node.type === 'definition' && !definitions.has(node.identifier!))
        definitions.set(node.identifier!, node.url!);
      node.children?.forEach(collect);
    }
    function visit(node: Node) {
      const url =
        node.type === 'link'
          ? node.url
          : node.type === 'linkReference'
            ? definitions.get(node.identifier!)
            : undefined;
      const match = url?.match(/^attachments\/([a-f0-9-]+\.(?:pdf|docx|txt|md))$/);
      if (match) documents.add(`${note.scope}:${match[1]}`);
      node.children?.forEach(visit);
    }
    collect(tree);
    visit(tree);
  }
  return { notes: noteCount, documents: documents.size };
}
