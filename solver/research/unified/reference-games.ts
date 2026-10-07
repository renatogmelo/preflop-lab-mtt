import type { ResearchNode, UnifiedGameDefinition } from "./game-definition";

function terminal(id: string, value: number): ResearchNode {
  return { id, kind: "terminal", utilities: [value, -value] };
}

export function sequentialHiddenChoiceDefinition(): UnifiedGameDefinition {
  const nodes: Record<string, ResearchNode> = {
    root: { id: "root", kind: "chance", outcomes: [
      { action: "type-high", probability: 0.5, next: "p0-high" },
      { action: "type-low", probability: 0.5, next: "p0-low" },
    ] },
    "p0-high": { id: "p0-high", kind: "decision", player: 0, informationSet: "A:P0:high", stage: "initial", actions: ["pass", "challenge"], transitions: { pass: "high-pass", challenge: "p1-high" } },
    "p0-low": { id: "p0-low", kind: "decision", player: 0, informationSet: "A:P0:low", stage: "initial", actions: ["pass", "challenge"], transitions: { pass: "low-pass", challenge: "p1-low" } },
    "p1-high": { id: "p1-high", kind: "decision", player: 1, informationSet: "A:P1:challenge", stage: "continuation", actions: ["yield", "contest"], transitions: { yield: "high-yield", contest: "high-contest" } },
    "p1-low": { id: "p1-low", kind: "decision", player: 1, informationSet: "A:P1:challenge", stage: "continuation", actions: ["yield", "contest"], transitions: { yield: "low-yield", contest: "low-contest" } },
    "high-pass": terminal("high-pass", 0),
    "low-pass": terminal("low-pass", 0),
    "high-yield": terminal("high-yield", 1),
    "low-yield": terminal("low-yield", 1),
    "high-contest": terminal("high-contest", 2),
    "low-contest": terminal("low-contest", -2),
  };
  return { id: "sequential-hidden-choice-v1", name: "Sequential Hidden Choice", description: "A private type acts first; the responder observes the action but not the type.", players: ["Chooser", "Responder"], root: "root", zeroSum: true, nodes };
}

export function publicSignalGameDefinition(): UnifiedGameDefinition {
  const nodes: Record<string, ResearchNode> = {
    root: { id: "root", kind: "chance", outcomes: [
      { action: "type-high", probability: 0.5, next: "p0-high" },
      { action: "type-low", probability: 0.5, next: "p0-low" },
    ] },
  };
  for (const type of ["high", "low"] as const) {
    nodes[`p0-${type}`] = { id: `p0-${type}`, kind: "decision", player: 0, informationSet: `B:P0:${type}`, stage: "initial", actions: ["safe", "proceed"], transitions: { safe: `${type}-safe`, proceed: `signal-${type}` } };
    nodes[`${type}-safe`] = terminal(`${type}-safe`, 0);
    const good = type === "high" ? 0.75 : 0.25;
    nodes[`signal-${type}`] = { id: `signal-${type}`, kind: "chance", outcomes: [
      { action: "signal-good", probability: good, next: `p1-${type}-good` },
      { action: "signal-bad", probability: 1 - good, next: `p1-${type}-bad` },
    ] };
    for (const signal of ["good", "bad"] as const) {
      nodes[`p1-${type}-${signal}`] = { id: `p1-${type}-${signal}`, kind: "decision", player: 1, informationSet: `B:P1:${signal}`, stage: "continuation", actions: ["allow", "block"], transitions: { allow: `${type}-${signal}-allow`, block: `${type}-${signal}-block` } };
      nodes[`${type}-${signal}-allow`] = terminal(`${type}-${signal}-allow`, 1);
      nodes[`${type}-${signal}-block`] = terminal(`${type}-${signal}-block`, type === "high" ? 2 : -2);
    }
  }
  return { id: "public-signal-game-v1", name: "Public Signal Game", description: "A noisy public signal is revealed between the private first decision and the response.", players: ["Sender", "Receiver"], root: "root", zeroSum: true, nodes };
}

export function coupledDecisionGameDefinition(): UnifiedGameDefinition {
  const nodes: Record<string, ResearchNode> = {
    root: { id: "root", kind: "chance", outcomes: [
      { action: "type-high", probability: 0.5, next: "p0-high" },
      { action: "type-low", probability: 0.5, next: "p0-low" },
    ] },
  };
  const goodProbability = { "high-X": 0.85, "high-Y": 0.6, "low-X": 0.3, "low-Y": 0.1 } as const;
  for (const type of ["high", "low"] as const) {
    nodes[`p0-${type}`] = { id: `p0-${type}`, kind: "decision", player: 0, informationSet: `C:P0:${type}`, stage: "initial", actions: ["route-X", "route-Y"], transitions: { "route-X": `signal-${type}-X`, "route-Y": `signal-${type}-Y` } };
    for (const route of ["X", "Y"] as const) {
      const probability = goodProbability[`${type}-${route}`];
      nodes[`signal-${type}-${route}`] = { id: `signal-${type}-${route}`, kind: "chance", outcomes: [
        { action: "signal-good", probability, next: `p1-${type}-${route}-good` },
        { action: "signal-bad", probability: 1 - probability, next: `p1-${type}-${route}-bad` },
      ] };
      for (const signal of ["good", "bad"] as const) {
        const acceptValue = route === "X" ? 0.8 : 1.2;
        const challengeMagnitude = route === "X" ? 2.4 : 1.6;
        nodes[`p1-${type}-${route}-${signal}`] = { id: `p1-${type}-${route}-${signal}`, kind: "decision", player: 1, informationSet: `C:P1:${route}:${signal}`, stage: "continuation", actions: ["accept", "challenge"], transitions: { accept: `${type}-${route}-${signal}-accept`, challenge: `${type}-${route}-${signal}-challenge` } };
        nodes[`${type}-${route}-${signal}-accept`] = terminal(`${type}-${route}-${signal}-accept`, acceptValue);
        nodes[`${type}-${route}-${signal}-challenge`] = terminal(`${type}-${route}-${signal}-challenge`, type === "high" ? challengeMagnitude : -challengeMagnitude);
      }
    }
  }
  return { id: "coupled-decision-game-v1", name: "Coupled Decision Game", description: "The first private decision changes both the public-signal distribution and the continuation beliefs.", players: ["Router", "Inspector"], root: "root", zeroSum: true, nodes };
}

export function referenceGameDefinitions() {
  return [sequentialHiddenChoiceDefinition(), publicSignalGameDefinition(), coupledDecisionGameDefinition()];
}
