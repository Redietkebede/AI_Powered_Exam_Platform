import { AdaptiveEngine } from './adaptive';

export const bayesianEngine: AdaptiveEngine = {
  getNextDifficulty({ history }) {
    if (!history.length) return 3;
    const last = history[history.length - 1];
    let next = last.correct ? last.difficulty + 1 : last.difficulty - 1;
    return Math.max(1, Math.min(5, next));
  }
};
