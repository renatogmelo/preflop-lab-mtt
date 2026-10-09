import { createHash } from "node:crypto";
import type { Player } from "../../core/types";
import type { CompactIndexedTree, CompactProbability } from "../compact/compact-tree";

function policyHash(policy: Int16Array) {
  return createHash("sha256").update(new Uint8Array(policy.buffer, policy.byteOffset, policy.byteLength)).digest("hex");
}

export function evaluateGenericCompactGame(tree: CompactIndexedTree, probability: CompactProbability) {
  const strategyValue = new Float64Array(tree.kind.length);
  for (let node = tree.kind.length - 1; node >= 0; node -= 1) {
    const kind = tree.kind[node];
    if (kind === 0) { strategyValue[node] = tree.terminalP0[node]; continue; }
    const first = tree.firstChild[node];
    const count = tree.childCount[node];
    let value = 0;
    for (let action = 0; action < count; action += 1) {
      const child = first + action;
      const weight = kind === 1 ? tree.edgeProbability[child] : probability(tree.informationSet[node], action);
      value += weight * strategyValue[child];
    }
    strategyValue[node] = value;
  }
  const bestResponse = (player: Player) => {
    const reach = new Float64Array(tree.kind.length);
    const value = new Float64Array(tree.kind.length);
    const scores = new Float64Array(tree.totalInformationSetActions);
    const policy = new Int16Array(tree.informationSetActionCount.length);
    policy.fill(-1);
    reach[tree.root] = 1;
    for (let node = 0; node < tree.kind.length; node += 1) {
      const kind = tree.kind[node];
      if (kind === 0) continue;
      const first = tree.firstChild[node];
      const count = tree.childCount[node];
      for (let action = 0; action < count; action += 1) {
        const child = first + action;
        const weight = kind === 1
          ? tree.edgeProbability[child]
          : tree.actor[node] === player ? 1 : probability(tree.informationSet[node], action);
        reach[child] += reach[node] * weight;
      }
    }
    for (let levelIndex = tree.levels.length - 1; levelIndex >= 0; levelIndex -= 1) {
      const level = tree.levels[levelIndex];
      const playerInfos = new Set<number>();
      for (let local = 0; local < level.count; local += 1) {
        const node = level.offset + local;
        if (tree.kind[node] === 0) {
          value[node] = player === 0 ? tree.terminalP0[node] : -tree.terminalP0[node];
        } else if (tree.kind[node] === 2 && tree.actor[node] === player) {
          const info = tree.informationSet[node];
          playerInfos.add(info);
          const actionOffset = tree.informationSetActionOffset[info];
          for (let action = 0; action < tree.childCount[node]; action += 1) scores[actionOffset + action] += reach[node] * value[tree.firstChild[node] + action];
        }
      }
      for (const info of playerInfos) {
        const actionOffset = tree.informationSetActionOffset[info];
        const count = tree.informationSetActionCount[info];
        let bestAction = 0;
        for (let action = 1; action < count; action += 1) if (scores[actionOffset + action] > scores[actionOffset + bestAction]) bestAction = action;
        policy[info] = bestAction;
      }
      for (let local = 0; local < level.count; local += 1) {
        const node = level.offset + local;
        const kind = tree.kind[node];
        if (kind === 0) continue;
        const first = tree.firstChild[node];
        const count = tree.childCount[node];
        if (kind === 2 && tree.actor[node] === player) {
          value[node] = value[first + policy[tree.informationSet[node]]];
          continue;
        }
        let result = 0;
        for (let action = 0; action < count; action += 1) {
          const child = first + action;
          const weight = kind === 1 ? tree.edgeProbability[child] : probability(tree.informationSet[node], action);
          result += weight * value[child];
        }
        value[node] = result;
      }
    }
    return { value: value[tree.root], policy, policyHash: policyHash(policy) };
  };
  const response0 = bestResponse(0);
  const response1 = bestResponse(1);
  const utilities: [number, number] = [strategyValue[tree.root], -strategyValue[tree.root]];
  const nashConv = (response0.value - utilities[0]) + (response1.value - utilities[1]);
  return {
    utilities,
    bestResponseValues: [response0.value, response1.value] as [number, number],
    nashConv,
    exploitability: nashConv / 2,
    policyHashes: [response0.policyHash, response1.policyHash] as [string, string],
  };
}
