# Liquibase com MySQL 5.7

Este guia documenta como criar changesets com SQL compatível com **MySQL 5.7** para reduzir erros de sintaxe quando o modelo gera migrações.

## Alvo obrigatório

- **SGBD:** MySQL
- **Versão:** 5.7

Qualquer change set com SQL específico deve declarar explicitamente o `dbms: mysql` ou usar `preConditions` para evitar execução em bancos diferentes.

## Padrões recomendados

### 1) Restrinja SQL específico com `dbms` e `preConditions`

Use `dbms: mysql` quando o SQL é específico do MySQL. Combine com `preConditions` para segurança adicional:

```yaml
- changeSet:
    id: 001-create-user-table
    author: ai-hub
    preConditions:
      onFail: MARK_RAN
      dbms:
        type: mysql
    changes:
      - sql:
          dbms: mysql
          splitStatements: true
          stripComments: true
          sql: |
            CREATE TABLE users (
              id BIGINT NOT NULL AUTO_INCREMENT,
              email VARCHAR(255) NOT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE KEY uk_users_email (email)
            ) ENGINE=InnoDB;
```

### 2) Evite recursos não suportados (ou limitados) no MySQL 5.7

- `WITH` (CTE) e `WINDOW` functions não são suportados no 5.7.
- `CHECK` constraints não são aplicadas no 5.7.
- Colunas `JSON` existem, mas funções avançadas podem ter diferenças.

Quando precisar desses recursos, documente o workaround e garanta que os changesets não sejam executados fora do MySQL 5.7.

### 3) Use `updateSQL` para validar sintaxe antes de aplicar

Antes de subir o change set, rode:

```bash
liquibase updateSQL \
  --changelog-file=apps/backend/src/main/resources/db/changelog/changelog-master.yaml \
  --url=jdbc:mysql://localhost:3306/ai_hub \
  --username=root \
  --password=secret
```

Isso gera o SQL final, permitindo revisar e corrigir sintaxe incompatível antes da execução.

## Changelog de referência

Veja os exemplos em:

- `apps/backend/src/main/resources/db/changelog/changelog-master.yaml`
- `apps/backend/src/main/resources/db/changelog/changeset-001-create-users.yaml`

Esses arquivos servem como base para o modelo e para o time de desenvolvimento.

## Runner efêmero dedicado

O workflow `.github/workflows/liquibase-mysql57.yml` executa a validação em um runner
GitHub-hosted dedicado ao job. A máquina virtual, o daemon Docker e o banco MySQL 5.7
são descartados ao final da execução; nenhum socket Docker do host do AI Hub é exposto
à sandbox.

O workflow é iniciado automaticamente em pull requests que alteram os changelogs,
este guia ou o próprio workflow. Também pode ser iniciado manualmente pela ação
**Liquibase MySQL 5.7** na aba **Actions** do GitHub.

A validação:

1. inicia `mysql:5.7` como service container com credenciais exclusivas da execução;
2. aguarda o healthcheck do banco;
3. aplica o changelog com `liquibase/liquibase:4.27.0`;
4. executa `status --verbose` para confirmar que não restaram changesets pendentes;
5. encerra o job, fazendo o GitHub descartar a VM e todos os containers.

O checkout não persiste credenciais, o workflow possui somente permissão de leitura,
e o container Liquibase recebe o repositório como volume somente leitura, sem
capabilities Linux adicionais e com `no-new-privileges`.
