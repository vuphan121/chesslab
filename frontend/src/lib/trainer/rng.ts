// Seeded RNG so scheduler sessions are deterministic and unit-testable —
// never use Math.random() in the scheduler (see scheduler.md §3 note).

// mulberry32: small, fast, good-enough PRNG for this use (not cryptographic).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function newRng(seed?: number): () => number {
  return mulberry32(seed ?? Date.now())
}

// uniform returns a random float in [lo, hi).
export function uniform(lo: number, hi: number, rng: () => number): number {
  return lo + rng() * (hi - lo)
}

// weightedChoice picks one item from `items`, with probability proportional
// to weight(item). Assumes items is non-empty and every weight is > 0.
export function weightedChoice<T>(items: T[], weight: (item: T) => number, rng: () => number): T {
  const weights = items.map(weight)
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}
