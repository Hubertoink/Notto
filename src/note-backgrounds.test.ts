// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { noteBackground, noteBackgrounds, readNoteBackground } from './note-backgrounds';

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
});
