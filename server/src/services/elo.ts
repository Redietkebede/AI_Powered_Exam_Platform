export function updateElo(rating: number, questionDiff: number, correct: boolean) {
  const K = 24;
  const diffAsElo = 800 + (questionDiff - 3) * 100; // map 1..5 → ~600..1000
  const expected = 1 / (1 + 10 ** ((diffAsElo - rating) / 400));
  const score = correct ? 1 : 0;
  return Math.round(rating + K * (score - expected));
}
