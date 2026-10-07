import { compileGameTree } from "../../tree/compiled";
import { chanceAudit } from "./chance";
import { informationSetAudit } from "./information-sets";
import { zeroSumAudit } from "./utilities";
import type { UnifiedResearchGame } from "./game-tree";

export function validateResearchGame(game: UnifiedResearchGame) {
  const chance = chanceAudit(game.definition);
  const informationSets = informationSetAudit(game);
  const zeroSum = zeroSumAudit(game);
  const tree = compileGameTree(game).statistics;
  return {
    valid: chance.valid && informationSets.valid && zeroSum.valid,
    chance,
    informationSets,
    zeroSum,
    tree,
    privateInformationProtected: informationSets.valid,
    publicHistorySharedByConstruction: true,
  };
}
