# Codex-RS: funcionamento e por que "RS"

## O que é o `codex-rs`

`codex-rs` é a implementação principal (moderna) do Codex CLI escrita em **Rust**. No repositório, ela aparece dentro de `exemplos/codex-rs/` com vários crates e componentes (CLI, core, protocolo, app-server, etc.).

Em termos práticos, o `codex-rs` é o "motor" que:

- interpreta sua solicitação;
- monta contexto do projeto;
- chama modelo(s) configurado(s);
- decide quando usar ferramentas (shell, leitura/escrita de arquivos, MCP, web);
- aplica alterações e reporta resultados.

## Por que "RS"?

"**rs**" é uma convenção comum para indicar projetos em **RuSt** (extensão de arquivos Rust é `.rs`).

Então `codex-rs` significa, essencialmente:

- **codex** = produto/agent;
- **rs** = implementação em Rust.

Também serve para diferenciar de implementações anteriores (por exemplo, versões legadas em TypeScript/Node).

## Arquitetura em alto nível

Dentro de `codex-rs`, a organização segue módulos/crates com responsabilidades claras:

- **CLI (`cli`)**: interface de linha de comando; parse de flags; inicialização de sessão.
- **Core (`core`)**: orquestração principal do agente (loop de raciocínio, ferramentas, estado).
- **API client (`codex-api`, `codex-client`)**: camada de comunicação com provedores/modelos.
- **Protocolo (`protocol`)**: tipos e contratos de mensagens/eventos usados entre componentes.
- **App Server (`app-server`)**: servidor para integração via JSON-RPC/MCP (útil para GUIs e integrações externas).
- **Integrações auxiliares**: MCP server/client, proxies, sandbox, telemetria, utilitários.

Essa separação facilita manutenção, testes e evolução de cada parte sem acoplamento excessivo.

## Fluxo de execução (simplificado)

1. Usuário executa comando (ex.: `codex ...`).
2. CLI carrega configuração e contexto do diretório.
3. Core inicia uma sessão do agente.
4. Modelo gera passos/itens (mensagens e possíveis chamadas de ferramenta).
5. Ferramentas executam ações aprovadas (com políticas/sandbox).
6. Resultados retornam ao modelo para próxima decisão.
7. Agente encerra com resposta final e/ou alterações em arquivo.

## Autenticação e acesso a modelos

No ecossistema `codex-rs`, existem dois modos principais quando a integração é com OpenAI:

- **API key** (`apiKey`): você fornece chave.
- **ChatGPT managed** (`chatgpt`): login via navegador/OAuth e tokens gerenciados pela aplicação.

No `app-server`, isso aparece nos endpoints de conta (`account/login/start`, `account/read`, etc.), com suporte explícito ao fluxo `chatgpt`.

## Vantagens de usar Rust nesta base

Escolher Rust para o `codex-rs` traz benefícios importantes para esse tipo de agente:

- **Performance**: baixa latência e bom uso de CPU/memória;
- **Confiabilidade**: segurança de memória e menos classes de bugs em runtime;
- **Concorrência robusta**: bom suporte para IO assíncrono e workloads paralelos;
- **Distribuição**: binários estáticos e simples de instalar;
- **Base escalável**: adequada para crescer em features de segurança, sandbox e integrações.

## Resumo

`codex-rs` é a implementação em Rust do Codex, focada em robustez, performance e modularidade. O sufixo `rs` existe justamente para sinalizar essa escolha tecnológica e distinguir essa linha da implementação legada.
