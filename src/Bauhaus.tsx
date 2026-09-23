import type { CSSProperties } from 'react';

type Shape = 'circle' | 'square' | 'triangle' | 'semicircle' | 'ring' | 'bar';
type Tone = 'red' | 'blue' | 'yellow' | 'ink';
const shapes: Shape[] = ['circle', 'square', 'triangle', 'semicircle', 'ring', 'bar'];
const tones: Tone[] = ['red', 'blue', 'yellow', 'ink'];

// A name has the same visual identity across views, sessions and devices.
export function tagIdentity(name: string) {
  let hash = 2166136261;
  for (const character of name.trim().replace(/^#/, '').normalize('NFC').toLocaleLowerCase('de')) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  }
  return {
    shape: shapes[hash % shapes.length],
    tone: tones[(hash >>> 8) % tones.length],
    rotation: ((hash >>> 16) % 4) * 90,
  };
}

export function GeometricMark({
  shape,
  tone,
  rotation = 0,
}: {
  shape: Shape;
  tone: Tone;
  rotation?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`geometric-mark geometric-mark--${shape} geometric-mark--${tone}`}
      style={{ '--mark-rotation': `${rotation}deg` } as CSSProperties}
    />
  );
}

export function TagMark({ name }: { name: string }) {
  return <GeometricMark {...tagIdentity(name)} />;
}

export function TagLabel({ name }: { name: string }) {
  return (
    <span className="tag-label">
      <TagMark name={name} />
      <span>{name}</span>
    </span>
  );
}

export function BauhausComposition({ className = '' }: { className?: string }) {
  return (
    <svg className={`bauhaus-composition ${className}`} viewBox="0 0 300 580" fill="none" aria-hidden="true">
      <circle cx="204" cy="141" r="130" fill="var(--bauhaus-red)" />
      <path d="M50 267H254V479H50z" fill="var(--bauhaus-blue)" />
      <path d="M32 554H254V332L32 554Z" fill="var(--bauhaus-yellow)" />
      <path d="M254 12V566M254 488H300" stroke="currentColor" strokeWidth="9" />
    </svg>
  );
}
