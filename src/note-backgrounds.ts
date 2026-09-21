export type NoteBackgroundId = 'none' | 'girl' | 'horse' | 'night' | 'sky' | 'city';

export interface NoteBackground {
  id: NoteBackgroundId;
  label: string;
  src?: string;
}

export const noteBackgrounds: NoteBackground[] = [
  { id: 'none', label: 'Kein Hintergrund' },
  { id: 'girl', label: 'Illustration · Mädchen', src: '/backgrounds/girl.png' },
  { id: 'horse', label: 'Illustration · Wald', src: '/backgrounds/horse.jpg' },
  { id: 'night', label: 'Stadt · Nacht', src: '/backgrounds/night.jpeg' },
  { id: 'sky', label: 'Stadt · Himmel', src: '/backgrounds/sky.jpg' },
  { id: 'city', label: 'Stadt · Lichter', src: '/backgrounds/city.jpg' },
];

/** Decorative backgrounds used only inside the KI-Anmerkungen panel. */
export const aiAnnotationBackgrounds = [
  '/ai-backgrounds/designer-10.png',
  '/ai-backgrounds/designer-11.png',
  '/ai-backgrounds/designer-13.png',
] as const;

export function readNoteBackground(): NoteBackgroundId {
  const id = localStorage.getItem('notto-note-background');
  return noteBackgrounds.some((item) => item.id === id) ? (id as NoteBackgroundId) : 'none';
}

export function noteBackground(id: NoteBackgroundId) {
  return noteBackgrounds.find((item) => item.id === id) || noteBackgrounds[0];
}
