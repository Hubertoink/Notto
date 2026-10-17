import { expect, it } from 'vitest';
import { tagPopupPosition } from './tag-popup';

it('opens hashtag suggestions above a caret near the widget bottom', () => {
  for (const [width, height] of [
    [320, 240],
    [480, 430],
    [800, 600],
  ]) {
    const aboveBottom = height - 40;
    const popup = tagPopupPosition(width - 15, height - 16, aboveBottom, width, height)!;
    expect(popup).not.toBeNull();
    expect(popup.top).toBeGreaterThanOrEqual(0);
    expect(popup.top + popup.maxHeight).toBeLessThanOrEqual(aboveBottom);
    expect(popup.left).toBeGreaterThanOrEqual(0);
    expect(popup.left + 220).toBeLessThanOrEqual(width);
    expect(popup.maxHeight).toBeGreaterThanOrEqual(32);
  }
});

it('keeps suggestions below a caret with enough room', () => {
  const popup = tagPopupPosition(170, 100, 76, 480, 430)!;
  expect(popup.top).toBeGreaterThanOrEqual(100);
  expect(popup.top + popup.maxHeight).toBeLessThanOrEqual(430);
  expect(tagPopupPosition(10, 30, 6, 320, 40)).toBeNull();
});
