import { expect, it } from 'vitest';
import { tagPopupPosition } from './tag-popup';

it('opens hashtag suggestions above a caret near the widget bottom', () => {
  expect(tagPopupPosition(170, 386, 362, 480, 430)).toEqual({ left: 170, top: 162, maxHeight: 200 });
});

it('keeps suggestions below a caret with enough room', () => {
  expect(tagPopupPosition(170, 100, 76, 480, 430)).toEqual({ left: 170, top: 100, maxHeight: 200 });
});
