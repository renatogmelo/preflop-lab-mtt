import type { StrategyTrustLevel } from "../core/domain";

const TRUST_COPY: Record<StrategyTrustLevel, string> = {
  verified: "Estratégia proveniente de dataset validado.",
  curated: "Estratégia de referência revisada para estudo. Não representa necessariamente um equilibrium solve.",
  modeled: "Aproximação educacional gerada pelo modelo do Preflop Lab.",
  experimental: "Estratégia ainda em validação. Não é usada no treino normal.",
};

export function TrustBadge({ level, compact = false }: { level: StrategyTrustLevel; compact?: boolean }) {
  return <span className={`trust-badge trust-${level}`} title={TRUST_COPY[level]} aria-label={`${level}: ${TRUST_COPY[level]}`}>
    {compact ? level.charAt(0).toUpperCase() : level.toUpperCase()}
  </span>;
}

export function TrustExplanation({ level }: { level: StrategyTrustLevel }) {
  return <p className="trust-explanation"><TrustBadge level={level} />{TRUST_COPY[level]}</p>;
}
