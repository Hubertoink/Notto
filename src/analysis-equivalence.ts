import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const markdown = unified().use(remarkParse).use(remarkGfm);
type Node = {
  type: string;
  children?: Node[];
  value?: string;
  url?: string;
  title?: string | null;
  identifier?: string;
  alt?: string | null;
  lang?: string | null;
  meta?: string | null;
  checked?: boolean | null;
  ordered?: boolean | null;
  start?: number | null;
};
type Token = string | { url: string; label: string; title: string };
const whitespace = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Compare presentation separately from the original text used for citations.
 * Keep order, code, task states, strike-through and source destinations meaningful.
 */
function tokens(content: string): Token[] {
  const tree = markdown.parse(content);
  const definitions = new Map<string, Node>();
  function collect(node: Node) {
    if (node.type === 'definition') definitions.set(node.identifier!, node);
    node.children?.forEach(collect);
  }
  collect(tree);
  const result: Token[] = [];
  let pending = '';
  function flush() {
    if (whitespace(pending)) result.push(whitespace(pending));
    pending = '';
  }
  function marker(value: unknown) {
    flush();
    // Separate structural markers from plain text, including literal JSON in notes.
    result.push({ url: '', label: JSON.stringify(value), title: 'structure' });
  }
  function label(node: Node): string {
    return node.value ?? node.children?.map(label).join('') ?? '';
  }
  function visit(node: Node) {
    const children = () => node.children?.forEach(visit);
    switch (node.type) {
      case 'text':
        pending += node.value;
        return;
      case 'root':
        children();
        return;
      case 'emphasis':
      case 'strong':
        children();
        return;
      case 'paragraph':
      case 'heading':
        pending += ' ';
        children();
        pending += ' ';
        return;
      case 'break':
      case 'thematicBreak':
        pending += ' ';
        return;
      case 'definition':
        return;
      case 'list':
        if (node.ordered) marker(['ordered', node.start]);
        children();
        if (node.ordered) marker(['end-ordered']);
        return;
      case 'listItem':
        if (typeof node.checked === 'boolean') marker(['checked', node.checked]);
        children();
        return;
      case 'link':
      case 'linkReference': {
        const target = node.type === 'link' ? node : definitions.get(node.identifier!);
        if (!target) break;
        flush();
        result.push({ url: target.url!, label: whitespace(label(node)), title: target.title ?? '' });
        return;
      }
      case 'image':
      case 'imageReference': {
        const target = node.type === 'image' ? node : definitions.get(node.identifier!);
        marker(['image', target?.url, target?.title, node.alt]);
        return;
      }
      case 'code':
      case 'inlineCode':
        marker([node.type, node.value, node.lang, node.meta]);
        return;
    }
    // Preserve semantic/unknown Markdown constructs conservatively.
    marker([node.type, node.value]);
    children();
    marker(['end', node.type]);
  }
  visit(tree);
  flush();
  return result;
}

export function sameAnalysisContent(before: string, after: string) {
  if (before === after) return true;
  const left = tokens(before),
    right = tokens(after);
  return (
    left.length === right.length &&
    left.every((token, index) => {
      const other = right[index];
      if (typeof token === 'string' || typeof other === 'string') return token === other;
      if (token.url !== other.url || token.title !== other.title) return false;
      if (token.label === other.label) return true;
      // Turning a bare URL into a named link adds presentation, not a new source.
      // Renaming an already named link, or changing its destination, remains an edit.
      return /^https?:\/\//i.test(token.url) && (token.label === token.url || other.label === other.url);
    })
  );
}
