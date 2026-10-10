# Research Engine 1.0 — Segurança e modelo de confiança

## Controles implementados

- Path traversal: outputs e artefatos são relativos ao workspace; `..`, absolutos e symlinks são rejeitados.
- Overwrite: cada run usa UUID e diretório exclusivo; resultados ficam nesse diretório.
- Configuração: schema runtime limita inteiros, versões, algoritmos, tiers, memória e runtime.
- Providers: a CLI seleciona apenas built-ins; não importa ou executa código externo recebido em JSON.
- Processo: o worker é iniciado com `spawn`/argumentos, `windowsHide`, sem shell e sem concatenação executável.
- Recursos: Resource Policy V3, teto de 768 MiB, runtime de 30 s, old-space, RSS observado, watchdog pai e cancelamento cooperativo.
- Artefatos: Result V1 tem checksum; resultado incompleto e mutação falham fechados.
- Checkpoints: V5 valida magic, versão, comprimento, checksum, identidade, algoritmo e configuração antes de mutar estado.
- Concorrência: cada run é isolado por identidade/diretório; a infraestrutura 6.15 de writer locks e recovery permanece preservada.

## Modelo de confiança

Configurações e JSON são não confiáveis. Providers registrados programaticamente são código confiável do processo host; a validação estrutural reduz erros sem criar sandbox de código. Resultados sintéticos são evidência de pesquisa, não dados certificados de poker.

## Limites

Não existe sandbox de provider programático, hard cap nativo por Windows Job Object, garantia contra power loss ou auditoria de supply chain completa. `npm audit` pode reportar dependências do frontend; a release não executa `audit fix` automático porque isso poderia introduzir mudanças breaking sem revisão.
