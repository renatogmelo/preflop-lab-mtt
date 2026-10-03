# Preflop Lab — Progresso

Atualizado em: 2026-10-03

## Objetivo atual

Concluir a evolução vertical do Preflop Lab para uma plataforma de estudo MTT 8-max ChipEV: Strategy Data Layer honesta, Explorer, centro de treino, inteligência de aprendizado, Academy, Analyze/Progress, persistência D1, documentação e hardening.

## Estado atual

### Foundation — concluída

- Auditoria integral do repositório, engine, simulador, UI, persistência e testes.
- Tipos de domínio separados em `app/core/domain.ts`.
- Catálogo completo das 169 classes, normalização, combinações e baralho em `app/core/hands.ts`.
- Heurísticas legadas isoladas em provider explicitamente `modeled`.
- `StrategyRepository` desacopla Trainer e Strategy Data.
- Datasets possuem metadata, versão, source type, stacks, sizings e nodes suportados.
- Lookups ausentes retornam `Strategy unavailable`; não há fallback silencioso.
- EV heurístico removido da UI e do grading. Sem EV confiável, a aplicação mostra `Indisponível`.
- Arquitetura de nodes contém identidade estável, pai, pote, histórico, ator, ações e estratégia.
- Importadores JSON/CSV e validação de frequências, mãos, posições, stacks, nodes e metadata.
- Trainer e decisões adversárias agora consultam o repositório, nunca o gerador diretamente.

### Explorer — concluído funcionalmente

- Range Explorer com matriz 13×13 e estratégia mista proporcional.
- Painel de mão com classificação, conceitos, EV disponível/indisponível e mãos próximas.
- Tree Explorer com breadcrumbs e travessia de nodes.
- Compare 20bb/40bb/100bb.
- Diff entre stacks, threshold configurável e detalhe por mão.
- Procedência visível: modelo educacional versus dataset verificado.
- Estado explícito para sizing/node indisponível e alternativas somente por escolha do usuário.

### Training Engine — concluído funcionalmente

- Decision Trainer existente preservado e migrado para Strategy Data.
- Histórico correto da ação, pot, stacks e revelação didática das mãos adversárias.
- Confidence 1–5 antes da decisão.
- Frequency Trainer com distribuição completa e MAE em pontos percentuais.
- Range Trainer para construir a matriz e comparar missing hands, excess hands, ação errada e composição.
- Boundary Trainer prioriza estratégias mistas, mudança de ação e distância entre vizinhas.
- Mixed Strategy Trainer.
- Leak Trainer gera treino apenas quando existe amostra mínima real.
- Custom Session Builder com stack, posição, situação, dificuldade, quantidade e filtro de mixed.
- Preset custom local; decisões principais sincronizadas com D1 quando disponível.

### Learning Intelligence — concluída no núcleo

- Estado de aprendizado por `node + hand`.
- Scheduling determinístico inspirado em revisão espaçada.
- Erros confiantes retornam rapidamente e são classificados como misconception.
- Mastery considera accuracy, erro de frequência, calibração, streak, recência e volume.
- Evidência impede mastery alta por uma única resposta.
- Fila de revisões vencidas priorizada por misconception, fraqueza, erro e EV quando disponível.
- Detecção de leaks por node, posição, faixa de stack e classe de mão.
- Reforço de mãos vizinhas e algoritmo de fronteiras.
- Relatório de sessão com accuracy, frequency MAE, EV quando disponível, misconceptions e recomendação.

### Education — concluída verticalmente

- Academy com 13 capítulos: Foundations até Advanced Preflop Thinking.
- Cada aula contém teoria, exemplo, matriz interativa, mini teste, explicação e prática conectada ao Trainer.
- Progresso de aulas salvo localmente; tabela D1 já preparada para migração.
- Linguagem acessível sem esconder conceitos avançados.

### Analyze e Progress — concluídos funcionalmente

- Analyze com histórico, revisão, marcadas, misconceptions, leaks e heatmaps.
- Heatmaps para accuracy, frequency accuracy, confidence, attempts e mastery.
- Diagnóstico recusa afirmar leaks sem amostra suficiente.
- Session report das últimas 50 decisões.
- Progress com mastery hierárquica por cenário, confronto e stack band.
- Today's Training combina reviews vencidas, leaks, misconceptions e fronteiras.
- Histórico visual de precisão.
- Preferência de interface Beginner/Advanced/Professional preparada na UI.

### Persistência — schema e integração concluídos

- D1 habilitado como binding `DB`.
- Migration Drizzle gerada para sete tabelas:
  - user profiles/preferences;
  - decisions;
  - learning states;
  - study notes;
  - bookmarks;
  - custom sessions;
  - academy progress.
- API `/api/user-data` usa identidade privada do ChatGPT em produção.
- Histórico local existente é mesclado e migrado de forma idempotente.
- Aplicação mantém fallback local explícito quando D1 não está presente no desenvolvimento.

## Decisões arquiteturais

1. O Trainer consome apenas `StrategyRepository`.
2. Fonte modelada pode preencher a experiência educacional, mas nunca é apresentada como solve verificado.
3. Frequências modeladas são aproximadas; EV permanece nulo.
4. Nenhuma configuração de sizing ganha estratégia inventada.
5. Analytics trabalham com evidência e limiares mínimos.
6. Mastery é evidence-capped e hierárquica.
7. D1 é a fonte durável; localStorage é fallback/migração e preferência transitória.
8. O site privado fornece identidade; nenhum login paralelo será criado.
9. MTT 8-max ChipEV continua sendo o núcleo; ICM permanece apenas preparado nos tipos.
10. Academy, treino e análise compartilham o mesmo domínio e Strategy Data.

## Arquivos importantes modificados

- `app/core/domain.ts`
- `app/core/hands.ts`
- `app/core/modeled-provider.ts`
- `app/core/strategy-data.ts`
- `app/core/learning.ts`
- `app/engine.ts`
- `app/simulation.ts`
- `app/components/strategy-matrix.tsx`
- `app/views/explore-view.tsx`
- `app/views/training-lab.tsx`
- `app/views/learn-view.tsx`
- `app/views/analytics-view.tsx`
- `app/api/user-data/route.ts`
- `app/page.tsx`
- `app/globals.css`
- `db/schema.ts`
- `drizzle/0000_superb_robbie_robertson.sql`
- `.openai/hosting.json`
- `tests/core.test.mjs`
- `tests/learning.test.mjs`
- `tests/rendered-html.test.mjs`

## Testes realizados

- Build Vinext limpa após Strategy Data, Explorer, Training Engine, D1, Academy e Analytics.
- ESLint limpo.
- 21 testes passando:
  - 52 cartas e mesas sem colisões;
  - normalização e 169 classes/1326 combos;
  - procedência modelada e ausência de EV inventado;
  - recusa de sizing não suportado;
  - pot e histórico dos nodes;
  - compatibilidade de cenário;
  - validação e importação;
  - confidence/misconception;
  - revisão espaçada determinística;
  - mastery limitada por evidência;
  - fila de review;
  - fronteiras;
  - leak sintético;
  - mastery hierárquica;
  - renderização e acessibilidade básica;
  - 840+ formações de treino sem situações incompatíveis;
  - regressões de UTG first-to-act, ordem de 3-bet e resolução da rodada.
- Migration gerada com Drizzle: 7 tabelas.
- Inspeção visual automatizada não pôde ser executada porque o runtime do navegador encontrou uma falha de ACL do Windows; validação por build/render server permaneceu verde.

## Problemas conhecidos

- O único dataset disponível continua sendo um modelo educacional aproximado, não um solve verificado.
- Sem dataset verificado, Golden Tests de valores estratégicos e EV não podem ser honestamente criados.
- A travessia do Tree Explorer cobre as linhas principais implementadas; cold 4-bets e toda a árvore combinatória aguardam dataset correspondente.
- Academy progress e custom presets possuem schema D1, mas ainda usam armazenamento local na UI.
- Study Notes e Bookmarks possuem persistência preparada, mas ainda não estão expostos na interface.
- Interface Level está visível, mas ainda não altera densidade de todas as explicações.
- Search global, hotkeys configuráveis e auto-next ainda precisam de acabamento.
- É necessário validar visualmente a aplicação publicada em desktop/mobile assim que o runtime do navegador estiver disponível.

## Próximo passo

1. Publicar a versão validada com Sites e verificar o deployment.
2. Validar visualmente desktop/mobile quando o runtime do navegador deixar de falhar por ACL.
3. Adicionar um dataset verificado/licenciado para habilitar EV, golden tests e precisão de solve.
4. Expandir Tree Explorer para cold 4-bets e linhas profundas quando esses nodes existirem no dataset.
5. Sincronizar marcações editadas e leitura de presets/notas da nuvem na UI.
