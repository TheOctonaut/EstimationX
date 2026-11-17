export const DECK = ["0", "1", "2", "3", "5", "8", "13", "21", "?", "☕"] as const;

export type CardValue = (typeof DECK)[number];

export const FIBONACCI = DECK.map(Number).filter((n) => Number.isFinite(n));

export function isCardValue(value: unknown): value is CardValue {
  return typeof value === "string" && (DECK as readonly string[]).includes(value);
}

/** Nearest Fibonacci card; ties round up to the larger card. */
export function nearestFibonacci(value: number): number {
  let best = FIBONACCI[0];
  for (const candidate of FIBONACCI) {
    if (Math.abs(candidate - value) <= Math.abs(best - value)) best = candidate;
  }
  return best;
}

export interface Summary {
  average: number | null;
  nearest: number | null;
  numericVotes: number;
  totalVotes: number;
  distribution: { value: string; count: number }[];
}

export function summarize(votes: string[]): Summary {
  const numeric = votes.map(Number).filter((n) => Number.isFinite(n));
  const average = numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : null;
  const counts = new Map<string, number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  return {
    average,
    nearest: average === null ? null : nearestFibonacci(average),
    numericVotes: numeric.length,
    totalVotes: votes.length,
    distribution: DECK.filter((card) => counts.has(card)).map((value) => ({
      value,
      count: counts.get(value)!,
    })),
  };
}
