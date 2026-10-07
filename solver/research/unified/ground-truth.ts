import type { BehavioralStrategy, Player } from "../../core/types";
import { NashConvEvaluator, StrategyEvaluator } from "../../evaluation/best-response";
import { hashValue } from "../../core/stable";
import type { UnifiedResearchGame } from "./game-tree";

type PurePlan = Record<string, string>;

function combinations(size: number, count: number) {
  const result: number[][] = [];
  const visit = (start: number, values: number[]) => {
    if (values.length === count) { result.push(values); return; }
    for (let index = start; index <= size - (count - values.length); index += 1) visit(index + 1, [...values, index]);
  };
  visit(0, []);
  return result;
}

function cartesianPlans(entries: Array<[string, string[]]>, index = 0, current: PurePlan = {}): PurePlan[] {
  if (index === entries.length) return [{ ...current }];
  const [key, actions] = entries[index];
  return actions.flatMap((action) => cartesianPlans(entries, index + 1, { ...current, [key]: action }));
}

function solveLinear(matrix: number[][], values: number[]) {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < values.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < values.length; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let entry = column; entry <= values.length; entry += 1) augmented[column][entry] /= divisor;
    for (let row = 0; row < values.length; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= values.length; entry += 1) augmented[row][entry] -= factor * augmented[column][entry];
    }
  }
  return augmented.map((row) => row[values.length]);
}

function mixedStrategy(plans: PurePlan[], weights: number[], allEntries: Array<[string, string[]]>) {
  const strategy: BehavioralStrategy = {};
  allEntries.forEach(([key, actions]) => {
    strategy[key] = Object.fromEntries(actions.map((action) => [action, plans.reduce((sum, plan, index) => sum + (plan[key] === action ? weights[index] : 0), 0)]));
  });
  return strategy;
}

export function solveNormalFormGroundTruth(game: UnifiedResearchGame) {
  const byPlayer = ([0, 1] as Player[]).map((player) => {
    const map = new Map<string, string[]>();
    Object.values(game.definition.nodes).forEach((node) => {
      if (node.kind === "decision" && node.player === player) map.set(node.informationSet, [...node.actions]);
    });
    return [...map].sort(([left], [right]) => left.localeCompare(right));
  }) as [Array<[string, string[]]>, Array<[string, string[]]>];
  const plans = [cartesianPlans(byPlayer[0]), cartesianPlans(byPlayer[1])] as [PurePlan[], PurePlan[]];
  const evaluator = new StrategyEvaluator(game);
  const payoff = plans[0].map((left) => plans[1].map((right) => {
    const strategy: BehavioralStrategy = {};
    [...byPlayer[0], ...byPlayer[1]].forEach(([key, actions]) => {
      const action = left[key] ?? right[key];
      strategy[key] = Object.fromEntries(actions.map((candidate) => [candidate, candidate === action ? 1 : 0]));
    });
    return evaluator.evaluate(strategy)[0];
  }));
  const tolerance = 1e-8;
  let solution: { rows: number[]; columns: number[]; rowWeights: number[]; columnWeights: number[]; value: number } | null = null;
  for (let supportSize = 1; supportSize <= Math.min(plans[0].length, plans[1].length) && !solution; supportSize += 1) {
    for (const rows of combinations(plans[0].length, supportSize)) {
      for (const columns of combinations(plans[1].length, supportSize)) {
        const columnSystem = [
          ...rows.map((row) => [...columns.map((column) => payoff[row][column]), -1]),
          [...columns.map(() => 1), 0],
        ];
        const rowSystem = [
          ...columns.map((column) => [...rows.map((row) => payoff[row][column]), -1]),
          [...rows.map(() => 1), 0],
        ];
        const q = solveLinear(columnSystem, [...rows.map(() => 0), 1]);
        const p = solveLinear(rowSystem, [...columns.map(() => 0), 1]);
        if (!p || !q) continue;
        const rowWeights = p.slice(0, supportSize);
        const columnWeights = q.slice(0, supportSize);
        const value = (p.at(-1)! + q.at(-1)!) / 2;
        if ([...rowWeights, ...columnWeights].some((weight) => weight < -tolerance)) continue;
        const rowPayoffs = payoff.map((row) => columns.reduce((sum, column, index) => sum + row[column] * columnWeights[index], 0));
        const columnPayoffs = payoff[0].map((_, column) => rows.reduce((sum, row, index) => sum + rowWeights[index] * payoff[row][column], 0));
        if (rowPayoffs.some((item) => item > value + tolerance) || columnPayoffs.some((item) => item < value - tolerance)) continue;
        solution = { rows, columns, rowWeights, columnWeights, value };
        break;
      }
      if (solution) break;
    }
  }
  if (!solution) throw new Error(`No normal-form equilibrium support found for ${game.id}.`);
  const fullRowWeights = plans[0].map((_, index) => {
    const location = solution!.rows.indexOf(index);
    return location < 0 ? 0 : Math.max(0, solution!.rowWeights[location]);
  });
  const fullColumnWeights = plans[1].map((_, index) => {
    const location = solution!.columns.indexOf(index);
    return location < 0 ? 0 : Math.max(0, solution!.columnWeights[location]);
  });
  const strategy = { ...mixedStrategy(plans[0], fullRowWeights, byPlayer[0]), ...mixedStrategy(plans[1], fullColumnWeights, byPlayer[1]) };
  const evaluation = new NashConvEvaluator(game).evaluate(strategy);
  return {
    method: "independent-normal-form-support-enumeration",
    value: solution.value,
    strategy,
    evaluation,
    pureStrategies: [plans[0].length, plans[1].length] as [number, number],
    supportSizes: [solution.rows.length, solution.columns.length] as [number, number],
    payoffMatrixHash: hashValue(payoff),
    strategyHash: hashValue(strategy),
  };
}
