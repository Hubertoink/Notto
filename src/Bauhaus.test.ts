import { expect, it } from 'vitest';
import { tagIdentity } from './Bauhaus';

it('keeps tag identities independent of discovery order and unrelated tags', () => {
  const names = ['Jugendarbeit', 'Design', 'Medien', 'Cocktails', 'Ideen'];
  const before = Object.fromEntries(names.map((name) => [name, tagIdentity(name)]));
  for (let i = 0; i < 100; i++) tagIdentity(`Neuer Tag ${i}`);
  const after = Object.fromEntries([...names].reverse().map((name) => [name, tagIdentity(name)]));
  expect(after).toEqual(before);
  expect(new Set(Object.values(before).map((identity) => JSON.stringify(identity))).size).toBe(names.length);
});

it('gives case, hashtag notation and Unicode equivalents the same identity', () => {
  expect(tagIdentity('  #JUGENDARBEIT  ')).toEqual(tagIdentity('jugendarbeit'));
  expect(tagIdentity('Gespräche')).toEqual(tagIdentity('Gespra\u0308che'));
});
