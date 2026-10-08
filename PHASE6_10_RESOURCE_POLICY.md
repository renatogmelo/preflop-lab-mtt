# Phase 6.10 — Resource Policy V3

## Política

O preflight V3 combina nós, infosets, topologia, registros, regrets, strategy sums, buffers de avaliação, compilação, checkpoint, runtime e margem calibrada. Sua saída é `ALLOW`, `DENY` ou `REQUIRE_VALIDATION`, sempre com razões verificáveis.

| Limite | Valor |
|---|---:|
| Memória máxima | 768 MiB |
| Runtime máximo | 30 s por processo |
| Tier 0 | até 250.000 nós / 20 iterações |
| Tier 1 | até 4× o maior nó validado / 20 iterações |
| Tier 2 | autorização explícita / 1 iteração |
| Calibração mínima | 6 runs concluídos |

## Tiers

- **Tier 0 — Default:** preserva o envelope histórico. Não depende de evidência elevada.
- **Tier 1 — Validated Research:** exige seis medições, isolamento, watchdog e margem adequada. O envelope atual é `4 × 131.069 = 524.276` nós.
- **Tier 2 — Experimental Large Scale:** nunca automático. Exige flag explícita, calibração aprovada, uma iteração e os tetos de memória/runtime.

## Calibração final

Foram executados S2, S3 e S4 duas vezes. O modelo separa overhead fixo do processo de crescimento variável:

- overhead fixo de memória: 79.773.696 B;
- multiplicador variável com margem: `2,6713132854`;
- overhead fixo de runtime: 635,07 ms;
- multiplicador variável de runtime: `2,5379054478`;
- seis runs concluídos;
- isolamento e watchdog validados.

## Decisão S5

| Campo | Estimativa calibrada |
|---|---:|
| Nós | 2.097.149 |
| Infosets | 174.762 |
| Memória lógica residente | 65.361.132 B |
| Pico lógico antes da calibração | 102.061.232 B |
| Pico calibrado | 352.411.221 B |
| Runtime calibrado | 19.263,35 ms |
| Decisão | ALLOW, Tier 2 explícito |

O pico real máximo foi 200.675.328 B e o runtime máximo foi 17.669,10 ms, ambos abaixo das projeções calibradas e dos limites.

## Enforcement

O pai aplica timeout, idle timeout e limite de RSS observado. O filho aplica autorização estrutural antes da compilação e o V8 recebe um old-space limit derivado do teto RSS. Violações encerram o filho; o processo principal persiste exit code, sinal, motivo e métricas parciais.

No Windows, `WorkingSet64` é amostrado e não substitui um hard cap de Job Object. Tier 2 só é permitido porque o pico estimado possui folga ampla; cargas próximas ao teto devem ser recusadas.
