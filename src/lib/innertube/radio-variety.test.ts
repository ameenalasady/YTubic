import { describe, expect, it } from "vitest";
import { diversify } from "./radio-variety";
import type { ShelfItem } from "./types";

const track = (id: string, artist: string): ShelfItem =>
  ({
    id,
    kind: "song",
    title: id,
    artists: [{ name: artist }],
  }) as unknown as ShelfItem;

/** Deterministic pseudo-random source so the tests are repeatable. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe("diversify", () => {
  const pool = Array.from({ length: 40 }, (_, i) =>
    track(`t${i}`, `artist${i % 12}`),
  );

  it("keeps exactly the same tracks", () => {
    const out = diversify(pool, seeded(1));
    expect(out).toHaveLength(pool.length);
    expect(new Set(out.map((t) => t.id))).toEqual(
      new Set(pool.map((t) => t.id)),
    );
  });

  it("gives different orders for different random draws", () => {
    const a = diversify(pool, seeded(1))
      .map((t) => t.id)
      .join();
    const b = diversify(pool, seeded(2))
      .map((t) => t.id)
      .join();
    expect(a).not.toBe(b);
  });

  it("changes the head of the list, not just the tail", () => {
    const heads = new Set<string>();
    for (let s = 1; s <= 20; s++) {
      heads.add(diversify(pool, seeded(s))[0].id);
    }
    expect(heads.size).toBeGreaterThan(3);
  });

  it("keeps the original order when the draw is always zero", () => {
    const out = diversify(pool, () => 0).map((t) => t.id);
    expect(out).toEqual(pool.map((t) => t.id));
  });

  it("avoids the same artist twice in a row when it can", () => {
    const crowded = [
      track("a1", "A"),
      track("a2", "A"),
      track("b1", "B"),
      track("a3", "A"),
      track("c1", "C"),
      track("b2", "B"),
    ];
    const out = diversify(crowded, () => 0);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].artists?.[0].name).not.toBe(out[i - 1].artists?.[0].name);
    }
  });
});
