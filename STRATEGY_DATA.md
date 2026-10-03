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
