import { performance } from "node:perf_hooks";
import { hashValue } from "../../core/stable";
import type { ResearchNode, UnifiedGameDefinition } from "../unified/game-definition";
import { estimateSyntheticGame, validateSyntheticConfiguration, type SyntheticGameConfiguration } from "./tree-size-estimator";

export const SYNTHETIC_GENERATOR_VERSION = "synthetic-extensive-v0.8.0";

function seededUnit(seed: number, label: string) {
  let state = seed >>> 0;
  for (let index = 0; index < label.length; index += 1) {
    state ^= label.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
}

function chanceProbabilities(configuration: SyntheticGameConfiguration, label: string) {
  const weights = Array.from({ length: configuration.publicSignals }, (_, signal) => 1 + Math.floor(seededUnit(configuration.seed, `${label}|${signal}`) * 9));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function terminalValue(configuration: SyntheticGameConfiguration, privateStates: [number, number], history: string[]) {
  const denominator = Math.max(1, configuration.privateStates - 1);
  let value = (privateStates[0] - privateStates[1]) / denominator;
  if (configuration.dependencyComplexity !== "independent") {
    history.filter((token) => token.startsWith("a")).forEach((token) => {
      const [stageText, actionText] = token.slice(1).split(":");
      const stage = Number(stageText);
      const action = Number(actionText);
      const actor = stage % 2;
      const aligned = action === privateStates[actor] % configuration.actionsPerDecision;
      value += (actor === 0 ? 1 : -1) * (aligned ? 0.45 : -0.12);
    });
  }
  if (configuration.dependencyComplexity === "history-coupled") {
    history.filter((token) => token.startsWith("s")).forEach((token) => {
      const [stageText, signalText] = token.slice(1).split(":");
      const direction = Number(stageText) % 2 === 0 ? 1 : -1;
      value += direction * (Number(signalText) - (configuration.publicSignals - 1) / 2) * 0.08;
    });
  }
  value += (seededUnit(configuration.seed, `utility|${privateStates.join("|")}|${history.join("|")}`) - 0.5) * 0.02;
  return Math.tanh(value);
}

export type GeneratedSyntheticGame = {
  definition: UnifiedGameDefinition;
  estimate: ReturnType<typeof estimateSyntheticGame>;
  generationMs: number;
  definitionHash: string;
  actual: { nodes: number; terminals: number; chanceNodes: number; decisionNodes: number; informationSets: number };
};

export class SyntheticExtensiveGameGenerator {
  generateGame(configuration: SyntheticGameConfiguration): GeneratedSyntheticGame {
    validateSyntheticConfiguration(configuration);
    const estimate = estimateSyntheticGame(configuration);
    const started = performance.now();
    const nodes: Record<string, ResearchNode> = {};
    let nextNode = 0;
    const allocate = () => `g${nextNode++}`;
    const root = allocate();
    const rootOutcomes: Array<{ action: string; probability: number; next: string }> = [];
    const informationSets = new Set<string>();
    const buildStage = (stage: number, privateStates: [number, number], publicHistory: string[]): string => {
      if (stage === configuration.stages) {
        const id = allocate();
        const value = terminalValue(configuration, privateStates, publicHistory);
        nodes[id] = { id, kind: "terminal", utilities: [value, -value] };
        return id;
      }
      const actor = stage % 2 as 0 | 1;
      const decisionId = allocate();
      const actions = Array.from({ length: configuration.actionsPerDecision }, (_, action) => `a${action}`);
      const informationSet = `G|p${actor}|own${privateStates[actor]}|stage${stage}|${publicHistory.join(".")}`;
      informationSets.add(informationSet);
      const transitions: Record<string, string> = {};
      actions.forEach((actionName, action) => {
        const chanceId = allocate();
        transitions[actionName] = chanceId;
        const actionHistory = [...publicHistory, `a${stage}:${action}`];
        const probabilities = chanceProbabilities(configuration, `${privateStates.join("|")}|${actionHistory.join("|")}`);
        const outcomes = probabilities.map((probability, signal) => {
          const signalHistory = [...actionHistory, `s${stage}:${signal}`];
          return { action: `s${signal}`, probability, next: buildStage(stage + 1, privateStates, signalHistory) };
        });
        nodes[chanceId] = { id: chanceId, kind: "chance", outcomes };
      });
      nodes[decisionId] = {
        id: decisionId,
        kind: "decision",
        player: actor,
        informationSet,
        stage: stage === 0 ? "initial" : "continuation",
        actions,
        transitions,
        observation: {
          ownPrivateState: privateStates[actor],
          opponentPrivateState: privateStates[actor === 0 ? 1 : 0],
          publicHistory: [...publicHistory],
        },
      };
      return decisionId;
    };
    const privateDeals = configuration.privateStates ** 2;
    for (let first = 0; first < configuration.privateStates; first += 1) {
      for (let second = 0; second < configuration.privateStates; second += 1) {
        rootOutcomes.push({ action: `private-${first}-${second}`, probability: 1 / privateDeals, next: buildStage(0, [first, second], []) });
      }
    }
    nodes[root] = { id: root, kind: "chance", outcomes: rootOutcomes };
    const definition: UnifiedGameDefinition = {
      id: configuration.id,
      name: `Synthetic ${configuration.id}`,
      description: `Generated ${configuration.stages}-stage imperfect-information game.`,
      players: ["Player 0", "Player 1"],
      root,
      zeroSum: true,
      nodes,
      research: { family: "parametric-synthetic", seed: configuration.seed, generatorVersion: SYNTHETIC_GENERATOR_VERSION },
    };
    const values = Object.values(nodes);
    const actual = {
      nodes: values.length,
      terminals: values.filter((node) => node.kind === "terminal").length,
      chanceNodes: values.filter((node) => node.kind === "chance").length,
      decisionNodes: values.filter((node) => node.kind === "decision").length,
      informationSets: informationSets.size,
    };
    if (actual.nodes !== estimate.nodes || actual.terminals !== estimate.terminals || actual.chanceNodes !== estimate.chanceNodes || actual.decisionNodes !== estimate.decisionNodes || actual.informationSets !== estimate.informationSets) {
      throw new Error(`Generated structure differs from estimate for ${configuration.id}.`);
    }
    return { definition, estimate, generationMs: performance.now() - started, definitionHash: hashValue(definition), actual };
  }
}
