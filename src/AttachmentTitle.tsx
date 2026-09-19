import { useEffect, useState } from 'react';
import { repo } from './repository';

export function attachmentTitle(content: string, id: string) {
  return [...content.matchAll(/!?\[([^\]\n]+)\]\(attachments\/([^\s)]+)\)/g)]
    .find((match) => match[2] === id)?.[1]
    .replace(/\\([\\\[\]_])/g, '$1');
}
export function AttachmentTitle({ content, id, scope }: { content: string; id: string; scope: string }) {
  const [name, setName] = useState('');
  useEffect(() => {
    let active = true;
    setName('');
    void repo
      .attachment(scope, id)
      .then((a) => {
        if (active) setName(a?.name ?? '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [scope, id]);
  return <>{attachmentTitle(content, id) || name || id}</>;
}
