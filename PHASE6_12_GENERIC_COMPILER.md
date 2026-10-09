# Fase 6.12 — Generic Compiler V3

## Provider Contract V2

O contrato separa a semântica do jogo do layout compilado:

- \`initialState\` e \`stateKey\`;
- \`actor\`;
- \`legalActions\`, \`actionKey\` e \`transition\`;
- \`chanceProbability\`;
- \`informationSetKey\` e auditoria de observação/recall;
- \`terminalUtility\`;
- \`semanticIdentity\`;
- capabilities determinísticas, domínio matemático e fast path opcional.

## Pipeline

1. Expande o estado inicial em BFS.
2. Revalida actor, ações e transições para detectar não determinismo.
3. Rejeita ciclos, múltiplos pais, transições inválidas e excesso de budget/profundidade/runtime.
4. Preserva filhos contíguos e índices já emitidos.
5. Registra information sets por chave semântica provisória.
6. Valida ação disponível, actor, profundidade compatível, perfect recall e ausência de vazamento segundo o audit do provider.
7. Canonicaliza os IDs finais pela chave semântica, não pela ordem física dos buffers.
8. Finaliza typed arrays compactos.
9. Executa invariantes estruturais, structural hash e perfil detalhado.

## Famílias adicionadas

- **IrregularBranchingProvider:** branching variável e terminais determinísticos em profundidades diferentes.
- **VariableDepthHiddenInformationProvider:** estados privados/public history e information sets indistinguíveis.
- **AsymmetricChanceProvider:** pesos de chance não uniformes e subárvores assimétricas.

Nos fixtures pequenos, os jogos produziram respectivamente 31, 37 e 13 nós. Os oracles independentes confirmaram EV, best responses, NashConv e exploitability dentro da tolerância 1e-12.

## Dispatch

O Compiler V2 só é selecionado quando o provider declara explicitamente \`synthetic-regular-v2\`, determinismo, contagem exata e configuration hash compatível. Capabilities inconsistentes são rejeitadas. Todos os demais providers seguem o V3.

## Compatibilidade

O resultado continua sendo \`CompactIndexedTree\`. O solver compacto, o avaliador genérico, o cache e o Checkpoint V5 reutilizam a mesma topologia. O V3 não amplia o domínio além de dois jogadores e soma zero.
