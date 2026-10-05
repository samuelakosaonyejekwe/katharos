import { describe, expect, it } from 'vitest';
import { builtInCases, evaluate } from '../src/domain/evaluate';

describe('accuracy evaluation', () => {
  it('reader misses no encumbrance on the built-in set', () => {
    const r = evaluate(builtInCases());
    for (const c of r.results) if (c.missed.length || c.extra.length || !c.ownersOk || !c.kindOk || !c.dateOk) console.log(JSON.stringify(c));
    expect(r.missed).toBe(0);
    expect(r.extra).toBe(0);
    expect(r.ownerAccuracy).toBe(1);
    expect(r.fieldAccuracy).toBe(1);
  });
});
