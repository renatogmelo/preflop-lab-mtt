"use client";

import { ACTIONS, type ActionKey, type StrategyAction, type StrategyNode } from "../core/domain";
import { HAND_CLASSES, MATRIX_RANKS } from "../core/hands";
import { dominantAction } from "../core/strategy-data";

function strategyBackground(actions: StrategyAction[]) {
  let cursor = 0;
  const stops: string[] = [];
  actions.filter((item) => item.frequency > 0).forEach((item) => {
    const start = cursor;
    cursor += item.frequency;
    stops.push(`${ACTIONS[item.action].color} ${start}% ${cursor}%`);
  });
  return stops.length ? `linear-gradient(90deg,${stops.join(",")})` : "#202a25";
}

export function StrategyMatrix({
  node,
  selectedHand,
  onSelect,
  compact = false,
  cellClass,
}: {
  node: StrategyNode;
  selectedHand?: string;
  onSelect?: (hand: string) => void;
  compact?: boolean;
  cellClass?: (hand: string, actions: StrategyAction[]) => string;
}) {
  return <div className={`strategy-matrix ${compact ? "compact" : ""}`} role="grid" aria-label={`Matriz de estratégia de ${node.actingPosition}`}>
    {MATRIX_RANKS.flatMap((row, rowIndex) => MATRIX_RANKS.map((col, colIndex) => {
      const hand = rowIndex === colIndex ? row + col : rowIndex < colIndex ? row + col + "s" : col + row + "o";
      const actions = node.strategyByHand[hand] ?? [];
      const primary = dominantAction(actions);
      const mixed = actions.filter((item) => item.frequency >= 5).length > 1;
      const customClass = cellClass?.(hand, actions) ?? "";
      return <button
        type="button"
        role="gridcell"
        key={hand}
        className={`strategy-cell ${selectedHand === hand ? "selected" : ""} ${mixed ? "mixed" : ""} ${customClass}`}
        style={{ background: strategyBackground(actions) }}
        title={`${hand}: ${actions.map((item) => `${ACTIONS[item.action].label} ${item.frequency}%`).join(" · ")}`}
        onClick={() => onSelect?.(hand)}
        aria-label={`${hand}, ação principal ${ACTIONS[primary.action].label}, ${primary.frequency}%`}
      >
        <span>{hand}</span>
        {!compact && <small>{primary.frequency}%</small>}
      </button>;
    }))}
  </div>;
}

export function StrategyLegend({ actions }: { actions: ActionKey[] }) {
  return <div className="range-legend">{actions.map((action) =>
    <span key={action}><i style={{ background: ACTIONS[action].color }} />{ACTIONS[action].label}</span>
  )}</div>;
}

export function handClassIndex(hand: string) {
  return HAND_CLASSES.indexOf(hand);
}

