export function createTextareaMirror(field: HTMLTextAreaElement) {
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  document.body.appendChild(mirror);
  return {
    rects(start: number, end: number) {
      const style = getComputedStyle(field);
      for (const property of [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'font-variant',
        'line-height',
        'letter-spacing',
        'word-spacing',
        'text-transform',
        'text-indent',
        'text-align',
        'tab-size',
        'padding-top',
        'padding-right',
        'padding-bottom',
        'padding-left',
        'direction',
      ]) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      Object.assign(mirror.style, {
        position: 'fixed',
        visibility: 'hidden',
        pointerEvents: 'none',
        left: '0',
        top: '0',
        width: `${field.clientWidth}px`,
        boxSizing: 'border-box',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        border: '0',
      });
      const marker = document.createElement('span');
      marker.textContent = field.value.slice(start, end) || '\u200b';
      mirror.replaceChildren(
        document.createTextNode(field.value.slice(0, start)),
        marker,
        document.createTextNode(field.value.slice(end)),
      );
      const fieldRect = field.getBoundingClientRect();
      const rects = Array.from(marker.getClientRects());
      if (!rects.length) rects.push(marker.getBoundingClientRect());
      return rects.map((rect) => ({
        left: fieldRect.left + field.clientLeft + rect.left - field.scrollLeft,
        right: fieldRect.left + field.clientLeft + rect.right - field.scrollLeft,
        top: fieldRect.top + field.clientTop + rect.top - field.scrollTop,
        bottom: fieldRect.top + field.clientTop + rect.bottom - field.scrollTop,
      }));
    },
    remove: () => mirror.remove(),
  };
}
