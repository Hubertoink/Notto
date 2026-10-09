/** Measure off-screen so typing never temporarily collapses a scrolled note. */
export function resizeNoteTextarea(field: HTMLTextAreaElement) {
  const parent = field.parentElement;
  if (!parent || !field.isConnected) return;
  const width = field.getBoundingClientRect().width;
  if (!width) return;
  const mirror = field.cloneNode(false) as HTMLTextAreaElement;
  mirror.removeAttribute('id');
  mirror.removeAttribute('name');
  mirror.removeAttribute('aria-label');
  mirror.removeAttribute('aria-controls');
  mirror.removeAttribute('aria-activedescendant');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.tabIndex = -1;
  mirror.disabled = true;
  mirror.value = field.value;
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    boxSizing: 'border-box',
    height: '0',
    minHeight: '0',
    maxHeight: 'none',
    overflow: 'hidden',
    flex: 'none',
  });
  parent.append(mirror);
  try {
    const style = getComputedStyle(field);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const height = mirror.scrollHeight + (style.boxSizing === 'border-box' ? border : -padding);
    const next = `${Math.ceil(height)}px`;
    if (field.style.height !== next) field.style.height = next;
  } finally {
    mirror.remove();
  }
}
