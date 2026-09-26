import { z } from 'zod';

export function noteCommands(content: string) {
  const commands: { prompt: string; start: number; end: number }[] = [];
  let offset = 0,
    fence = '';
  for (const line of content.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
    } else if (!fence && /^ {0,3}\/ki(?:\s|$)/i.test(line)) {
      commands.push({
        prompt: line.replace(/^ {0,3}\/ki\s*/i, '').trim(),
        start: offset,
        end: offset + line.length,
      });
    }
    offset += line.length + 1;
  }
  return commands;
}

export function commandUrls(text: string) {
  return [
    ...new Set(
      (text.match(/https?:\/\/[^\s<>"`]+/gi) || []).map((value) => value.replace(/[).,;!?\]}]+$/, '')),
    ),
  ];
}

export function withoutNoteCommands(content: string, prompts?: readonly string[]) {
  return noteCommands(content)
    .filter((command) => !prompts || prompts.includes(command.prompt))
    .reduceRight(
      (text, command) =>
        text.slice(0, command.start) + text.slice(command.end + (text[command.end] === '\n' ? 1 : 0)),
      content,
    );
}

export function commandEvidence(content: string, quote: string) {
  const value = quote.trim().toLocaleLowerCase('de');
  return (
    !!value &&
    noteCommands(content).some(
      ({ prompt, start, end }) =>
        content.slice(start, end).trim().toLocaleLowerCase('de') === value ||
        prompt.toLocaleLowerCase('de') === value,
    )
  );
}

export const commandAnswerSchema = z.object({
  summary: z.string().max(6000),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        detail: z.string().min(1).max(2000),
        source: z.number().int().min(0),
        target: z.string().max(30).nullable(),
        quote: z.string().max(500),
      }),
    )
    .max(8),
});

export interface CommandResult {
  summary: string;
  /** Web-search answer with provider-verified, clickable citations. */
  research?: string;
  searched?: boolean;
  searchQueries?: string[];
  partial?: boolean;
  items: {
    title: string;
    detail: string;
    url?: string;
    imageId?: string;
    imageError?: string;
    imageCaption?: string;
  }[];
  sources: { title: string; url: string }[];
  warnings: string[];
}
export interface NoteCommand {
  id: string;
  note_id: string;
  revision: string;
  prompt: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  stage: string;
  error: string | null;
  result: CommandResult | null;
  created_at: string;
}
