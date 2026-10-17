// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { noteBackground, noteBackgrounds, readNoteBackground } from './note-backgrounds';

describe('note backgrounds', () => {
  beforeEach(() => localStorage.clear());

  it('restores a selected background and safely falls back for missing or obsolete preferences', () => {
    expect(readNoteBackground()).toBe('none');
    localStorage.setItem('notto-note-background', 'unknown');
    expect(readNoteBackground()).toBe('none');
    expect(noteBackground(readNoteBackground()).src).toBeUndefined();
    const selected = noteBackgrounds.find((item) => item.src)!;
    localStorage.setItem('notto-note-background', selected.id);
    expect(noteBackground(readNoteBackground())).toEqual(selected);
  });
});
