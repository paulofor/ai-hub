# Modelo de Dados — Módulo de Vídeo

Este documento descreve o modelo de dados do **módulo de vídeos comerciais com avatar**. O objetivo é centralizar as entidades necessárias para controlar o ciclo de vida completo de um vídeo: planejamento, roteiros, recursos auxiliares e histórico de renderizações.

## Visão Geral

O módulo é composto por quatro entidades principais:

| Tabela                | Responsabilidade                                                                 |
|-----------------------|-----------------------------------------------------------------------------------|
| `video_projects`      | Registro mestre do vídeo, incluindo objetivo, público-alvo e estilo escolhido.   |
| `video_scenes`        | Sequência de cenas que compõem o roteiro do vídeo.                               |
| `video_assets`        | Recursos auxiliares usados no vídeo (imagens, áudios, roteiros auxiliares etc.). |
| `video_render_jobs`   | Histórico de renderizações solicitadas a provedores externos.                    |

Cada projeto pode possuir N cenas, N assets e múltiplos jobs de renderização. Todas as dependências usam `ON DELETE CASCADE` para facilitar a limpeza caso um projeto seja removido.

## Estrutura das Tabelas

### `video_projects`

| Coluna              | Tipo                | Detalhes                                                                 |
|---------------------|---------------------|--------------------------------------------------------------------------|
| `id`                | BIGINT AUTO         | Identificador único.                                                     |
| `code`              | VARCHAR(50)         | Código legível usado pelas integrações (único).                          |
| `title`             | VARCHAR(255)        | Título curto do vídeo.                                                   |
| `description`       | TEXT                | Resumo detalhado ou briefing do roteiro.                                 |
| `product_name`      | VARCHAR(255)        | Produto ou oferta apresentada no vídeo.                                  |
| `status`            | VARCHAR(40)         | Estado atual (`draft`, `approved`, `rendering`, `completed`, …).         |
| `language`          | VARCHAR(10)         | Idioma principal (ex.: `pt-BR`, `en-US`).                                |
| `tone`              | VARCHAR(80)         | Linha editorial sugerida (amigável, técnico etc.).                       |
| `target_audience`   | VARCHAR(255)        | Público-alvo principal.                                                  |
| `primary_goal`      | VARCHAR(255)        | Objetivo macro (ex.: captar leads, vender curso).                        |
| `call_to_action_url`| VARCHAR(500)        | Link para onde o lead será direcionado.                                  |
| `avatar_style`      | VARCHAR(100)        | Estilo de avatar (humano, cartoon, realista…).                           |
| `hero_image_url`    | VARCHAR(500)        | Imagem de capa/miniatura do vídeo.                                       |
| `owner_email`       | VARCHAR(255)        | Responsável pela criação do projeto (capturado via `X-User`).            |
| `last_synced_at`    | DATETIME            | Momento da última sincronização com o provedor de render.                |
| `created_at`        | TIMESTAMP           | Criado automaticamente.                                                  |
| `updated_at`        | TIMESTAMP           | Atualizado automaticamente.                                              |

Índices adicionais:

- `uk_video_projects_code` garante códigos únicos.

### `video_scenes`

| Coluna                 | Tipo         | Detalhes                                                               |
|------------------------|--------------|------------------------------------------------------------------------|
| `id`                   | BIGINT AUTO  | Identificador.                                                         |
| `project_id`           | BIGINT       | FK para `video_projects`.                                              |
| `sequence_index`       | INT          | Ordem da cena no roteiro (1 … N).                                      |
| `title`                | VARCHAR(255) | Referência rápida da cena.                                             |
| `script`               | TEXT         | Texto completo que o avatar irá narrar/exibir.                         |
| `visual_style`         | VARCHAR(100) | Direção de arte sugerida (close, palco, slide etc.).                    |
| `voiceover_url`        | VARCHAR(500) | Áudio pré-gravado para a cena (quando aplicável).                      |
| `duration_seconds`     | INT          | Duração estimada.                                                       |
| `call_to_action_label` | VARCHAR(100) | Texto do CTA exibido na tela.                                          |
| `primary_asset_url`    | VARCHAR(500) | Recurso visual principal da cena.                                      |
| `created_at`           | TIMESTAMP    | Criado automaticamente.                                                |
| `updated_at`           | TIMESTAMP    | Atualizado automaticamente.                                            |

Restrições:

- `fk_video_scenes_project` (`ON DELETE CASCADE`).
- `uk_video_scenes_project_sequence` garante ordens únicas dentro do mesmo projeto.

### `video_assets`

| Coluna         | Tipo         | Detalhes                                                           |
|----------------|--------------|--------------------------------------------------------------------|
| `id`           | BIGINT AUTO  | Identificador.                                                     |
| `project_id`   | BIGINT       | FK para `video_projects`.                                          |
| `type`         | VARCHAR(50)  | Categoria (`image`, `voiceover`, `background_music`, etc.).        |
| `label`        | VARCHAR(150) | Nome amigável.                                                      |
| `source`       | VARCHAR(500) | Caminho/URL do recurso.                                            |
| `description`  | VARCHAR(500) | Observações adicionais.                                            |
| `created_at`   | TIMESTAMP    | Criado automaticamente.                                            |

Índices/relacionamentos:

- `fk_video_assets_project` (`ON DELETE CASCADE`).
- Índice auxiliar `idx_video_assets_project_type (project_id, type)` para buscas rápidas.

### `video_render_jobs`

| Coluna            | Tipo         | Detalhes                                                                 |
|-------------------|--------------|--------------------------------------------------------------------------|
| `id`              | BIGINT AUTO  | Identificador.                                                           |
| `project_id`      | BIGINT       | FK para `video_projects`.                                                |
| `provider`        | VARCHAR(100) | Provedor (ex.: Colossyan, HeyGen).                                       |
| `provider_job_id` | VARCHAR(150) | ID externo retornado pelo provedor.                                      |
| `status`          | VARCHAR(40)  | `queued`, `rendering`, `completed`, `failed` etc.                         |
| `render_profile`  | VARCHAR(150) | Perfil/preset selecionado na renderização.                               |
| `requested_at`    | TIMESTAMP    | Momento em que o job foi criado.                                         |
| `started_at`      | DATETIME     | Início efetivo da renderização.                                          |
| `finished_at`     | DATETIME     | Finalização (ou falha).                                                  |
| `output_url`      | VARCHAR(500) | Link para download/stream do vídeo renderizado.                          |
| `failure_reason`  | TEXT         | Log detalhado de falha (quando `status = failed`).                       |

Relacionamentos:

- `fk_video_render_jobs_project` (`ON DELETE CASCADE`).
- Índice `idx_video_render_jobs_project` para recuperar rapidamente o histórico por projeto.

## Relacionamentos

```
video_projects (1) ──< video_scenes
                └──< video_assets
                └──< video_render_jobs
```

- Cenas e assets são dependentes diretos do projeto.
- Render jobs também dependem diretamente do projeto, permitindo registrar várias tentativas.

## Boas Práticas

- **Códigos estáveis**: o campo `code` deve ser usado em integrações (ex.: workers de geração). Mantenha-os imutáveis.
- **Ordem de cenas**: utilize `sequence_index` sequencial sem buracos para facilitar reordenação no frontend.
- **Tipos de asset**: padronize valores (`image`, `broll`, `voiceover`, `cta_overlay`, etc.) para facilitar filtros.
- **Status**: os workers devem atualizar `video_projects.status` e registrar um `video_render_jobs` a cada renderização.

## Próximos Passos

- Conectar o worker de renderização para popular `video_render_jobs` automaticamente.
- Disponibilizar endpoints para atualizar status das renderizações e realizar reordenação massiva de cenas.
- Integrar a camada de video player no lead-portal para servir os vídeos aprovados.
