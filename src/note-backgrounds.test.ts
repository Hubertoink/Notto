// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  aiAnnotationBackgrounds,
  noteBackground,
  noteBackgrounds,
  readNoteBackground,
} from './note-backgrounds';

describe('note backgrounds', () => {
  beforeEach(() => localStorage.clear());

  it('contains the five PG previews and a clear option', () => {
    expect(noteBackgrounds).toHaveLength(6);
    expect(noteBackgrounds.filter((item) => item.src)).toHaveLength(5);
    expect(noteBackground('none').src).toBeUndefined();
  });

  it('falls back to no background for unknown or missing preferences', () => {
    expect(readNoteBackground()).toBe('none');
    localStorage.setItem('notto-note-background', 'unknown');
    expect(readNoteBackground()).toBe('none');
    localStorage.setItem('notto-note-background', 'night');
    expect(readNoteBackground()).toBe('night');
  });

  it('keeps the AI annotation backgrounds separate from note backgrounds', () => {
    expect(aiAnnotationBackgrounds).toHaveLength(3);
    expect(aiAnnotationBackgrounds.every((src) => src.startsWith('/ai-backgrounds/'))).toBe(true);
    expect(noteBackgrounds.some((item) => aiAnnotationBackgrounds.includes(item.src as never))).toBe(false);
  });
});
