# Homologação da publicação sem commits novos

## Diagnóstico e decisão

Pergunta de causa raiz: **por que esse erro aconteceu?** O patch do job é calculado
contra o SHA da base no início da execução. Ele é evidência das alterações do
trabalho, mas não prova que a branch remota ainda possui commits para integrar.
Uma branch antiga já incorporada à `main`, ou um merge durante a execução do
modelo, pode deixar esse patch preenchido. O orquestrador tentava `POST /pulls`
sem comparar as branches atuais; seu fallback de 422 só procurava PR aberto.

Em 2026-09-18, a comparação somente leitura de
`paulofor/marketing-hub`, `main...ai-hub/codex-paulofor-marketing-hub-main-chatgpt_codex_mkt`,
retornou `status=behind`, `ahead_by=0`, `behind_by=4` e `files=[]`.

Alternativas consideradas:

| Alternativa | Benefício | Risco | Esforço e aderência |
| --- | --- | --- | --- |
| Capturar somente o texto do 422 | Mudança pequena | Mantém requisição inválida e pode esconder outros erros | Baixo; insuficiente para corrigir a decisão |
| Atualizar a base Git e comparar localmente | Evita dependência HTTP adicional | Clone raso e merges squash exigem tratamento de histórico; a base pode mudar depois | Médio; útil, mas replica a decisão remota |
| Consultar PR aberto e comparação remota antes de criar, reconfirmando o caso específico de corrida | Usa o estado que o GitHub efetivamente publica; reutiliza PR | Requer disponibilidade e respostas válidas da API | Médio; escolhida por corrigir a causa e preservar erros reais |

O diff original permanece como evidência do job. Ausência comprovada de commits
ou de arquivos a integrar encerra a publicação normalmente; não comprova deploy.
Erro de consulta, permissão, transporte ou outro 422 continua sendo erro, com
workspace preservado.

## Matriz definida antes da execução

| Cenário | Critério de aceite local |
| --- | --- |
| Mudanças novas, inclusive arquivo novo | Branch contém o código validado; comparação atual permite exatamente um PR |
| PR aberto para a mesma base/head | URL reutilizada sem POST duplicado |
| Branch idêntica ou atrás da main | Nenhum POST de PR; job COMPLETED, sem erro 422 |
| Branch antiga, main com outras mudanças | Patch histórico não força PR; nenhuma alteração da main é revertida |
| Modelo faz merge durante o job | Comparação atual detecta entrega integrada; não cria outro PR |
| Commits sem diferença líquida | Nenhum PR vazio |
| Merge entre comparação e POST | 422 específico é reconfirmado por comparação; só a ausência comprovada encerra normalmente |
| PR aberto entre consulta e POST | 422 recupera e reutiliza esse PR |
| 422 distinto ou inconsistência após 422 | Job FAILED, erro preservado, sem retry cego |
| 401/403, transporte ou resposta inválida nas consultas | Não criar PR; preservar workspace e diagnóstico sem token |
| Publicação automática desativada | Publicar somente a branch; não consultar/criar PR |
| Push rejeitado, remoto concorrente e teste local falhando | Manter proteções existentes e código recuperável |
| Observabilidade e segregação | Logs diferenciam reutilização/ausência/erro; patch preservado; Git bare temporário e GitHub/modelo simulados, sem métricas de produção nem APIs pagas |
| Navegadores e dispositivos | Não aplicável: contrato/UI inalterados; decisão comum do orquestrador cobre todos os perfis com repositório |

Validação: testes de integração do processador com Git local e respostas HTTP
simuladas, seguidos pela suíte do orquestrador e revisão do diff. Publicação
somente após esses critérios, por PR, CI, merge e pipeline versionada.
