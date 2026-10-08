# Node independente dos workspaces

A imagem já instala Node, npm e npx em `/usr/local`. O incidente registrado no
diário ocorreu porque `/usr/local/bin/node` apontava a um workspace eliminado.
Esta entrega preserva a instalação oficial e acrescenta prevenção e detecção;
não atribui a criação do atalho a uma execução sem evidência.

## Matriz de aceite definida antes dos testes

| Caso | Evidência exigida |
| --- | --- |
| Instalação existente | Node/npm/npx funcionam e resolvem dentro de `/usr/local` |
| Dois jobs sucessivos | Node, scripts npm e binário local via npx funcionam no segundo workspace após remover o primeiro |
| Atalho para outro job ainda existente | Verificação rejeita cada ferramenta fora do prefixo persistente |
| Atalho quebrado / comando ausente | Diagnóstico identifica a ferramenta e retorna falha |
| CLI não executa | Falha de `--version` impede aceite; limite de tempo por ferramenta |
| Preflight saudável / inválido | Estado válido é registrado; inválido encerra antes de clone/inferência em perfis API, técnico, MKT e sandbox |
| Compatibilidade de desenvolvimento | Hosts sem helper continuam usando seu toolchain; a imagem entregue inclui o helper |
| Harness | Instrução em ambos os runners preserva ferramentas globais e limita versões adicionais ao job |
| Publicação | Build usa o runtime validado; CI do PR testa a camada real; deploy executa a mesma verificação |
| Isolamento e métricas | Fixtures temporárias, npm offline, sem inferência paga, credenciais, dados ou eventos comerciais |

Não há alteração visual; navegadores e dispositivos não se aplicam. As versões,
caminhos reais e falhas ficam no log existente da execução e nos logs da CI/deploy.
O teste usa a própria camada `node-runtime` herdada pela imagem de produção.

Na sandbox, executar com o projeto Compose exclusivo informado pelo job:

```sh
docker compose -p <projeto-exclusivo-do-job> -f apps/sandbox-orchestrator/tests/node-runtime-compose.yml run --build --rm node-runtime
docker compose -p <projeto-exclusivo-do-job> -f apps/sandbox-orchestrator/tests/node-runtime-compose.yml down --volumes --remove-orphans
```

`SANDBOX_NODE_INSTALL_ROOT` permite testar o helper contra uma instalação
sintética sem alterar `/usr/local`. Não é necessário configurá-lo em produção.
A verificação não reinstala ferramentas nem troca atalhos. O ambiente permite
alterações privilegiadas: a instrução reduz recorrência e o preflight detecta
danos antes da inferência, sem prometer isolamento imutável entre agentes.
