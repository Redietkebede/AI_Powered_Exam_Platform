// server/src/services/elo.ts
const S = 400 / Math.log(10); // logistic scale

export function bandFromElo(r: number) {
  if (r < 880) return 1; // 800–879
  if (r < 960) return 2; // 880–959
  if (r < 1040) return 3; // 960–1039
  if (r < 1120) return 4; // 1040–1119
  return 5; // 1120–1200+
}

export function expected(user: number, item: number) {
  const x = (user - item) / S;
  return 1 / (1 + Math.exp(-x));
}

// Map correctness + pace r=actual/expected to [0,1]
export function actualScore(correct: boolean, r: number) {
  let bonus = 0;
  if (correct) bonus = r <= 0.8 ? 0.1 : r <= 1.2 ? 0.05 : 0.0;
  else if (r <= 0.8) bonus = -0.1;
  const a = Math.max(0, Math.min(1, (correct ? 1 : 0) + bonus));
  return a;
}

export function updateEloPair(
  userRating: number,
  itemRating: number,
  correct: boolean,
  r: number, // pace ratio
  K_user = 16,
  K_item = 8
) {
  const a = actualScore(correct, r);
  const p = expected(userRating, itemRating);
  const dUser = Math.max(-24, Math.min(24, K_user * (a - p)));
  const dItem = Math.max(-24, Math.min(24, K_item * (p - a)));
  return {
    userAfter: Math.round(userRating + dUser),
    itemAfter: Math.round(itemRating + dItem),
    expected: p,
    actual: a,
    dUser,
    dItem,
  };
}
