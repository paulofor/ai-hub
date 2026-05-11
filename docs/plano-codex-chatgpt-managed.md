# Plano de implementação: novo menu estilo `/codex` com OpenAI via ChatGPT managed (`chatgpt`)

## Objetivo
Criar dentro da aplicação um novo item de menu semelhante ao `/codex`, com autenticação OpenAI no modo **ChatGPT managed** (`chatgpt`), usando login via navegador/OAuth e tokens gerenciados pela aplicação.

## 1) Escopo funcional
A nova área (ex.: `/codex-chatgpt`) deve incluir:
- autenticação de conta OpenAI via fluxo `chatgpt` (OAuth/browser login);
- visualização de estado da conta (conectado, expirado, desconectado);
- uso das execuções/requests com esse modo de autenticação;
- experiência semelhante ao `/codex` atual para reduzir curva de aprendizado.

Base técnica: o documento de referência já descreve o modo `chatgpt` e cita endpoints de conta no app-server (`account/login/start`, `account/read`).

## 2) Frontend: rotas e entrada no menu
Estratégia recomendada:
1. criar página nova (ex.: `CodexChatgptPage.tsx`);
2. registrar rota no `App.tsx` (mesmo padrão de `/codex`);
3. inserir card/link no dashboard para “Abrir Codex ChatGPT”.

## 3) Contrato de API para conta ChatGPT managed
Definir e estabilizar os endpoints:
- `POST /account/login/start` → inicia fluxo e retorna URL de autenticação;
- endpoint de callback OAuth no backend para troca do `code` por token;
- `GET /account/read` → status de conta/token;
- `POST /account/logout` (se aplicável) → limpeza de sessão/token.

## 4) Fluxo UX de autenticação
Estados mínimos da tela:
- **Desconectado**: botão “Conectar com ChatGPT”;
- **Conectando**: instrução de aguardo/retorno;
- **Conectado**: identidade da conta + validade + ações;
- **Erro/expirado**: chamada para reconectar.

Fluxo:
1. usuário clica “Conectar”;
2. frontend chama `account/login/start`;
3. abre URL OAuth;
4. callback concluído;
5. frontend consulta `account/read`;
6. status OK habilita recursos do menu.

## 5) Segurança e gestão de tokens
Requisitos obrigatórios:
- não expor token no frontend;
- armazenar tokens no backend com criptografia em repouso;
- associar credenciais por usuário/workspace;
- usar refresh token com rotação automática;
- mascarar segredos em logs;
- permitir revogação/limpeza no logout.

## 6) Integração com execução estilo Codex
Para envio de requests no novo menu:
- enviar indicador de modo/provedor (`chatgpt`);
- validar no backend se conta está conectada antes da execução;
- retornar erro funcional claro quando não autenticado;
- manter compatibilidade com pipeline atual de requests do Codex.

## 7) Observabilidade e operação
Implementar:
- auditoria de eventos (login iniciado, concluído, refresh, falha, logout);
- métricas (taxa de sucesso OAuth, latência de conexão, erros por categoria);
- suporte operacional para inspeção de status de autenticação.

## 8) Fases de entrega
### Fase 1 (MVP)
- rota + menu novo;
- conectar/desconectar;
- `account/read` funcional;
- bloqueio de uso sem autenticação.

### Fase 2
- integração completa com requests/executions;
- feedback de estado em tempo real;
- tratamento robusto de expiração.

### Fase 3
- multi-conta (se necessário);
- telemetria avançada e troubleshooting UI;
- hardening de segurança (rotação, política de sessão).

## Checklist técnico
- [ ] Nova rota frontend criada e acessível no menu.
- [ ] Botão “Conectar com ChatGPT” integrado ao `account/login/start`.
- [ ] Callback OAuth operacional no backend.
- [ ] `account/read` refletindo estado real.
- [ ] Tokens nunca expostos ao cliente.
- [ ] Requests do novo menu exigem conta conectada.
- [ ] Logs, auditoria e métricas implementados.
