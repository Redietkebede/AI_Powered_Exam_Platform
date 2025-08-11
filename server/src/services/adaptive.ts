export interface AdaptiveEngine {
  getNextDifficulty(ctx: { history: {correct:boolean, difficulty:number}[] }): number;
}
export { bayesianEngine as adaptiveEngine } from './bayesian';
