# Strategy Data

## Objetivo

Strategy Data é a única fonte consumida pelo produto. O Trainer não sabe se os dados vieram de solve, importação ou modelo educacional.

## Metadata

Cada dataset declara:

- `id`, `name`, `version`;
- `createdAt`, `updatedAt`;
- `sourceType`: `verified | imported | modeled | estimated`;
- game type, model, formato, jogadores e ante;
- stacks e sizings disponíveis;
- famílias de nodes suportadas;
- notas e status enabled.

Alterações estratégicas exigem nova versão. IDs devem ser estáveis.

## Query exata

`StrategyQuery` contém dataset, game/model/format, stack, hero, scenario, villain/caller e sizings. O lookup usa a query normalizada como chave exata.

O provider não pode responder a 2.5x com dados de 2.1x. Ele retorna `unavailable` e pode listar configurações existentes para escolha explícita.

## Node

Um `StrategyNode` contém:

- `id` e `parentNodeId`;
- posição atuante e stack efetivo;
- pot e action history;
- sizings;
- ações disponíveis;
- `strategyByHand` para as 169 classes;
- child node IDs;
- query original;
- provenance.

O pot inicial MTT 8-max BBA é 2.5bb: SB 0.5bb + BB 1bb + BB ante 1bb. “Pote não aberto” significa sem ação voluntária anterior, não ausência de blinds/ante.

## Frequências e EV

Cada mão contém ações com `frequency` entre 0 e 100 cuja soma deve ser 100 (com tolerância mínima de arredondamento).

`ev` é `number | null`. Use `null` quando não existir EV confiável. Nunca estime casas decimais apenas para preencher a interface.

Provenance informa:

- precisão de frequência: exact, rounded ou estimated;
- disponibilidade de EV;
- label e versão;
- se o node é exato.

## Validação

`validateDataset` rejeita:

- metadata incompleta;
- mão inválida ou ausente;
- ação desconhecida;
- frequência fora de 0–100;
- soma diferente de 100;
- posição, stack ou histórico inválido;
- query incompatível;
- IDs/nodes inconsistentes.

Importadores JSON/CSV retornam relatório; não instalam conteúdo inválido silenciosamente.

## Importação

JSON usa `SerializedStrategyDataset`: metadata + nodes completos.

CSV é convertido para a mesma estrutura interna. Cada linha precisa identificar query/node, hand, action, frequency e EV opcional. O parser nunca presume sizing ausente fora das defaults declaradas pelo dataset.

## Dataset Manager

`StrategyRepository` oferece instalação, enable/disable, listagem, lookup e inspeção por mão. Providers podem ser lazy no futuro, desde que preservem a mesma interface.

## Golden tests

Golden tests só devem existir para datasets verificados e licenciados. O modelo educacional tem testes de invariantes e provenance, não snapshots que fingem validar teoria GTO.


## Trust Level e workflow

`StrategyTrustLevel` possui `verified | curated | modeled | experimental`. `DatasetWorkflowStatus` possui `draft | review_required | reviewed | published | deprecated`.

Metadata agora inclui geração/revisão, metodologia, precisão, EV, exatidão, licença e changelog. Cada node replica essas informações essenciais em provenance.

O modelo embutido mantém obrigatoriamente:

```text
trustLevel = modeled
sourceType = modeled
isExact = false
frequencyPrecision = estimated
evAvailable = false
```

## Resolução composta e fallback

O dataset id `auto` solicita resolução composta. A prioridade é Verified, Curated e Modeled. O último só participa quando `allowModeledFallback` está habilitado. Experimental exige política explícita e nunca substitui automaticamente uma fonte superior.

Curated só participa com status `published`. Nodes ausentes continuam ausentes; datasets parciais são suportados.

## Preflop Lab Reference Strategy

`datasets/preflop-lab-reference/` contém a metadata canônica da base original curada. A cobertura publicada inicial é zero. O editor suporta matriz 169, frequências, validação da soma, cópia explícita de rascunho, diff, notas, SemVer, JSON import/export e workflow editorial.

## Coverage e Golden Tests

O catálogo atual contém 252 combinações de cenário × posição elegível × stack canônico. A cobertura real está em `DATASET_COVERAGE.md`.

`app/core/golden.ts` cria e compara snapshots explícitos. Verified sem golden é reportado como erro de governança. Modeled usa testes de invariantes, nunca golden values que insinuem precisão GTO.

## Solver datasets

O exporter do solver preserva no dataset:

- solver/version, algoritmo e par?metros;
- game definition hash e solve id;
- itera??es, runtime e m?tricas dispon?veis;
- continuation model, abstra??o e validation report id.

Todo output nasce `Experimental`. O POC `solver-experimental-6a62393e944f6db2` est? instalado para inspe??o expl?cita, mas ? exclu?do do auto-resolution e n?o altera a cobertura MTT 8-max atual.

## Phase 4 solver artifacts

O Hold'em Preflop V2 preserva estrat?gia por combo e hist?rico p?blico, mas permanece fora do `StrategyRepository`: usa continuation Level 0 e n?o possui exploitability. O range inspector calcula pesos condicionais por `prior ? strategy reach`, normaliza e aplica blockers exatos; ele n?o cria ranges por filtros heur?sticos.

Continuation artifacts s?o evid?ncia t?cnica separada, n?o StrategyDataset. S? uma futura exporta??o que cumpra `VERIFIED_POLICY.md` poder? alimentar treino normal. Experimental continua opt-in e exclu?do da resolu??o autom?tica.


## Phase 5 Experimental dataset

datasets/solver-experimental/preflop-lab-solver-experimental-v0.3.0.json records the reduced-game mean solved-provider strategy, methodology, hashes, provider distances, seed variance, coupling metrics and limitations. It is evidence for Solver Lab only, is not installed into normal Trainer resolution and does not change Verified or Curated coverage.
