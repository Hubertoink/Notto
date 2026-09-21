export function imageLayout(title = '') {
  const match = title.match(/^noto:width=(\d+);mode=(inline|thumbnail)$/);
  return {
    width: match ? Math.max(20, Math.min(100, Number(match[1]))) : 100,
    thumbnail: match?.[2] === 'thumbnail',
  };
}

export function noteImages(content: string) {
  // Ignore fenced code examples; keep source offsets for precise edits.
  const source = content.replace(/(```|~~~)[\s\S]*?\1/g, (block) => ' '.repeat(block.length));
  return [
    ...source.matchAll(
      /!\[((?:\\.|[^\]\\])*)\]\((attachments\/[a-f0-9-]+\.(?:png|jpg|webp|gif|avif))(?:\s+"([^"]*)")?\)/g,
    ),
  ].map((m) => ({
    start: m.index!,
    raw: m[0],
    alt: m[1],
    src: m[2],
    title: m[3] || '',
    ...imageLayout(m[3]),
  }));
}

export function updateImageLayout(content: string, start: number, width: number, thumbnail: boolean) {
  const image = noteImages(content).find((image) => image.start === start);
  if (!image) return content;
  const title = `noto:width=${Math.max(20, Math.min(100, Math.round(width)))};mode=${thumbnail ? 'thumbnail' : 'inline'}`;
  return (
    content.slice(0, start) +
    `![${image.alt}](${image.src} "${title}")` +
    content.slice(start + image.raw.length)
  );
}
