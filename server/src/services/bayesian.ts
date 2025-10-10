import { Level } from "./adaptive";

type HistoryItem = { difficulty: Level; correct: boolean };

export type AdaptiveEngine = {
  getNextDifficulty(input: { history: HistoryItem[] }): Level;
};

/** Super simple “move up on correct, down on wrong” Bayesian-ish stepper */
export const bayesianEngine: AdaptiveEngine = {
  getNextDifficulty({ history }) {
    if (!history.length) return 3;
    const last = history[history.length - 1];
    const next = last.correct ? last.difficulty + 1 : last.difficulty - 1;
    return Math.max(1, Math.min(5, next)) as Level;
  },
};
