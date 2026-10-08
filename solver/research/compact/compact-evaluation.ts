import { createHash } from "node:crypto";
import type { Player } from "../../core/types";
import type { CompactIndexedTree, CompactProbability } from "./compact-tree";

export type CompactStrategyEvaluation = {
  utilities: [number, number];
  nodesVisited: number;
  temporaryBytes: number;
};

export type CompactBestResponse = {
  player: Player;
  value: number;
  policy: Int16Array;
  policyHash: string;
  nodesVisited: number;
  temporaryBytes: number;
};

export type CompactNashConv = {
  utilities: [number, number];
  bestResponseValues: [number, number];
  nashConv: number;
  exploitability: number;
  nodesVisited: number;
  temporaryBytes: number;
  policyHashes: [string, string];
};

function hashTypedArray(value: Int16Array) {
  return createHash("sha256")
    .update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    .digest("hex");
}

export function evaluateCompactStrategy(
  tree: CompactIndexedTree,
  probability: CompactProbability,
): CompactStrategyEvaluation {
  const value = new Float64Array(tree.kind.length);
  for (let node = tree.kind.length - 1; node >= 0; node -= 1) {
    const kind = tree.kind[node];
    if (kind === 0) {
      value[node] = tree.terminalP0[node];
      continue;
    }
    const first = tree.firstChild[node];
    const count = tree.childCount[node];
    let result = 0;
    if (kind === 1) {
      for (let action = 0; action < count; action += 1) {
        const child = first + action;
        result += tree.edgeProbability[child] * value[child];
      }
    } else {
      const informationSet = tree.informationSet[node];
      for (let action = 0; action < count; action += 1) {
        result += probability(informationSet, action) * value[first + action];
      }
    }
    value[node] = result;
  }
  const root = value[tree.root];
  return {
    utilities: [root, -root],
    nodesVisited: tree.kind.length,
    temporaryBytes: value.byteLength,
  };
}

export class CompactBestResponseEvaluatorV2 {
  constructor(readonly tree: CompactIndexedTree) {}

  evaluate(player: Player, probability: CompactProbability): CompactBestResponse {
    const nodeCount = this.tree.kind.length;
    const counterfactualReach = new Float64Array(nodeCount);
    const value = new Float64Array(nodeCount);
    const policy = new Int16Array(this.tree.informationSetActionCount.length);
    policy.fill(-1);
    const actionScore = new Float64Array(this.tree.totalInformationSetActions);
    counterfactualReach[this.tree.root] = 1;

    for (let node = 0; node < nodeCount; node += 1) {
      const kind = this.tree.kind[node];
      if (kind === 0) continue;
      const first = this.tree.firstChild[node];
      const count = this.tree.childCount[node];
      if (kind === 1) {
        for (let action = 0; action < count; action += 1) {
          const child = first + action;
          counterfactualReach[child] += counterfactualReach[node] * this.tree.edgeProbability[child];
        }
        continue;
      }
      const actor = this.tree.actor[node] as Player;
      const informationSet = this.tree.informationSet[node];
      for (let action = 0; action < count; action += 1) {
        const weight = actor === player ? 1 : probability(informationSet, action);
        counterfactualReach[first + action] += counterfactualReach[node] * weight;
      }
    }

    for (let levelIndex = this.tree.levels.length - 1; levelIndex >= 0; levelIndex -= 1) {
      const level = this.tree.levels[levelIndex];
      if (level.kind === "terminal") {
        for (let local = 0; local < level.count; local += 1) {
          const node = level.offset + local;
          value[node] = player === 0 ? this.tree.terminalP0[node] : -this.tree.terminalP0[node];
        }
        continue;
      }
      if (level.kind === "decision" && (level.stage % 2) === player) {
        for (let local = 0; local < level.count; local += 1) {
          const node = level.offset + local;
          const informationSet = this.tree.informationSet[node];
          const actionOffset = this.tree.informationSetActionOffset[informationSet];
          const first = this.tree.firstChild[node];
          for (let action = 0; action < this.tree.childCount[node]; action += 1) {
            actionScore[actionOffset + action] += counterfactualReach[node] * value[first + action];
          }
        }
        for (let local = 0; local < level.count; local += 1) {
          const node = level.offset + local;
          const informationSet = this.tree.informationSet[node];
          if (policy[informationSet] < 0) {
            const actionOffset = this.tree.informationSetActionOffset[informationSet];
            const count = this.tree.informationSetActionCount[informationSet];
            let bestAction = 0;
            let bestScore = actionScore[actionOffset];
            for (let action = 1; action < count; action += 1) {
              const score = actionScore[actionOffset + action];
              if (score > bestScore) {
                bestScore = score;
                bestAction = action;
              }
            }
            policy[informationSet] = bestAction;
          }
          value[node] = value[this.tree.firstChild[node] + policy[informationSet]];
        }
        continue;
      }
      for (let local = 0; local < level.count; local += 1) {
        const node = level.offset + local;
        const kind = this.tree.kind[node];
        const first = this.tree.firstChild[node];
        const count = this.tree.childCount[node];
        let result = 0;
        if (kind === 1) {
          for (let action = 0; action < count; action += 1) {
            const child = first + action;
            result += this.tree.edgeProbability[child] * value[child];
          }
        } else {
          const informationSet = this.tree.informationSet[node];
          for (let action = 0; action < count; action += 1) {
            result += probability(informationSet, action) * value[first + action];
          }
        }
        value[node] = result;
      }
    }
    const temporaryBytes = counterfactualReach.byteLength + value.byteLength + policy.byteLength + actionScore.byteLength;
    return {
      player,
      value: value[this.tree.root],
      policy,
      policyHash: hashTypedArray(policy),
      nodesVisited: nodeCount * 2,
      temporaryBytes,
    };
  }
}

export class CompactNashConvEvaluatorV2 {
  private readonly bestResponse: CompactBestResponseEvaluatorV2;

  constructor(readonly tree: CompactIndexedTree) {
    this.bestResponse = new CompactBestResponseEvaluatorV2(tree);
  }

  evaluate(probability: CompactProbability): CompactNashConv {
    const strategy = evaluateCompactStrategy(this.tree, probability);
    const response0 = this.bestResponse.evaluate(0, probability);
    const response1 = this.bestResponse.evaluate(1, probability);
    const nashConv = (response0.value - strategy.utilities[0]) + (response1.value - strategy.utilities[1]);
    return {
      utilities: strategy.utilities,
      bestResponseValues: [response0.value, response1.value],
      nashConv,
      exploitability: nashConv / 2,
      nodesVisited: strategy.nodesVisited + response0.nodesVisited + response1.nodesVisited,
      temporaryBytes: Math.max(strategy.temporaryBytes, response0.temporaryBytes, response1.temporaryBytes),
      policyHashes: [response0.policyHash, response1.policyHash],
    };
  }
}
