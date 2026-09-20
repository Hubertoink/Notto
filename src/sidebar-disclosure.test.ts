// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useSidebarDisclosure } from './sidebar-disclosure';
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it('remembers tag and collection expansion independently across remounts and accounts', () => {
  const first = renderHook(() => useSidebarDisclosure('account-a'));
  expect(first.result.current[0]('tags', true)).toBe(true);
  act(() => first.result.current[1]('tags', true));
  act(() => first.result.current[1]('collection:Jugendarbeit'));
  first.unmount();
  const next = renderHook(({ scope }) => useSidebarDisclosure(scope), {
    initialProps: { scope: 'account-a' },
  });
  expect(next.result.current[0]('tags', true)).toBe(false);
  expect(next.result.current[0]('collection:Jugendarbeit')).toBe(true);
  next.rerender({ scope: 'account-b' });
  expect(next.result.current[0]('tags', true)).toBe(true);
  expect(next.result.current[0]('collection:Jugendarbeit')).toBe(false);
});
it('ignores malformed saved preferences', () => {
  localStorage.setItem('notto-sidebar-disclosures', '{invalid');
  const { result } = renderHook(() => useSidebarDisclosure('local'));
  expect(result.current[0]('tags', true)).toBe(true);
  act(() => result.current[1]('tags', true));
  expect(result.current[0]('tags', true)).toBe(false);
});
