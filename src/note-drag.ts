export function positionNoteDragPreview(preview: HTMLElement | null, point: { x: number; y: number }) {
  if (!preview || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  if (point.x === 0 && point.y === 0) return;
  preview.style.left = `${point.x - 92}px`;
  preview.style.top = `${point.y - 29}px`;
}

export function createNoteDragPreview(
  title: string,
  date: string,
  source: HTMLElement,
  point: { x: number; y: number },
) {
  const preview = document.createElement('div');
  preview.className = 'note-drag-preview';
  const dateLabel = document.createElement('span');
  dateLabel.textContent = date;
  const titleLabel = document.createElement('strong');
  titleLabel.textContent = title;
  preview.append(dateLabel, titleLabel);
  source.closest('.notebook')?.appendChild(preview);
  positionNoteDragPreview(preview, point);
  return preview;
}

export function hideNativeDragImage(dataTransfer: DataTransfer, source: HTMLElement) {
  if (!dataTransfer.setDragImage) return null;
  const pixel = document.createElement('canvas');
  pixel.width = 1;
  pixel.height = 1;
  pixel.className = 'note-drag-transparent-image';
  source.closest('.notebook')?.appendChild(pixel);
  dataTransfer.setDragImage(pixel, 0, 0);
  return pixel;
}

export function animateNoteIntoCollection(
  title: string,
  date: string,
  point: { x: number; y: number },
  target: HTMLElement,
) {
  const bounds = target.getBoundingClientRect();
  if (!bounds.width || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const flight = document.createElement('div');
  flight.className = 'note-drag-flight';
  const dateLabel = document.createElement('span');
  dateLabel.textContent = date;
  const titleLabel = document.createElement('strong');
  titleLabel.textContent = title;
  flight.append(dateLabel, titleLabel);
  target.closest('.notebook')?.appendChild(flight);
  const startX = point.x - 92;
  const startY = point.y - 29;
  flight.style.left = `${startX}px`;
  flight.style.top = `${startY}px`;
  if (!flight.animate) {
    flight.remove();
    return;
  }
  target.animate(
    [
      { boxShadow: 'inset 0 0 0 2px var(--nt-accent)', backgroundColor: 'var(--nt-tint)' },
      { boxShadow: 'inset 0 0 0 0 transparent', backgroundColor: 'transparent' },
    ],
    { duration: 420, easing: 'ease-out' },
  );
  const dx = bounds.left + bounds.width / 2 - 92 - startX;
  const dy = bounds.top + bounds.height / 2 - 29 - startY;
  const animation = flight.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0 },
    ],
    { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
  );
  const finish = () => {
    flight.remove();
  };
  void animation.finished.then(finish, finish);
}
