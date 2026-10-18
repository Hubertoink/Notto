import { expect, it } from 'vitest';
// @ts-expect-error Operator script is deliberately plain Node.js.
import { retentionPlan } from './registry-retention.mjs';

const digest = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
it('keeps only deployed images, latest and their OCI children', () => {
  const manifests = new Map(
    Array.from({ length: 12 }, (_, n) => [digest(n), { children: n === 0 ? [digest(11)] : [], created: '' }]),
  );
  const tags = Array.from({ length: 10 }, (_, n) => ({
    name: n === 9 ? 'latest' : `tag-${n}`,
    digest: digest(n),
    created: `2026-10-${String(n + 1).padStart(2, '0')}`,
  }));
  const plan = retentionPlan(tags, manifests, [digest(0)]);
  expect(plan.keptTags).toEqual(['tag-0', 'latest']);
  expect(plan.remove).not.toContain(digest(11));
  expect(plan.remove).toContain(digest(1));
});
it('refuses cleanup without valid deployed manifests or latest', () => {
  expect(() => retentionPlan([], new Map(), [])).toThrow(/required/);
  expect(() => retentionPlan([], new Map(), [digest(0)])).toThrow(/missing/);
  expect(() => retentionPlan([], new Map([[digest(0), { children: [] }]]), [digest(0)])).toThrow(/latest/);
});
it('keeps the tag and index of an older deployed platform manifest', () => {
  const manifests = new Map([
    [digest(0), { children: [digest(1)], created: '' }],
    [digest(1), { children: [], created: '' }],
    [digest(2), { children: [], created: '' }],
    [digest(3), { children: [], created: '' }],
  ]);
  const tags = [
    { name: 'old-running', digest: digest(0), created: '2026-01-01' },
    { name: 'new', digest: digest(2), created: '2026-10-01' },
    { name: 'latest', digest: digest(3), created: '2026-10-02' },
  ];
  const plan = retentionPlan(tags, manifests, [digest(1)]);
  expect(plan.keptTags).toContain('old-running');
  expect(plan.remove).not.toContain(digest(0));
});
it('defaults to no rollback images and removes every older unused version', () => {
  const manifests = new Map([
    [digest(0), { children: [], created: '' }],
    [digest(1), { children: [], created: '' }],
    [digest(2), { children: [], created: '' }],
  ]);
  const tags = [
    { name: 'old', digest: digest(0), created: '2026-01-01' },
    { name: 'current', digest: digest(1), created: '2026-10-01' },
    { name: 'latest', digest: digest(1), created: '2026-10-01' },
    { name: 'unused', digest: digest(2), created: '2026-10-01' },
  ];
  expect(retentionPlan(tags, manifests, [digest(1)])).toEqual({
    keptTags: ['current', 'latest'],
    remove: [digest(0), digest(2)],
  });
});
