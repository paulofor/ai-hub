import assert from 'node:assert/strict';
import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const packageRoot = process.cwd();
const repositoryRoot = path.resolve(packageRoot, '../..');
const startAgentScript = path.join(packageRoot, 'scripts/start-sandbox-ssh-agent');
const healthScript = path.join(packageRoot, 'scripts/sandbox-ssh-agent-health');
const sshWrapper = path.join(packageRoot, 'scripts/sandbox-ssh');

type AgentFixture = {
  directory: string;
  privateKey: string;
  publicKey: string;
  knownHosts: string;
  socket: string;
};

async function createAgentFixture(): Promise<AgentFixture> {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sandbox-ssh-agent-test-'));
  const privateKey = path.join(directory, 'id_ed25519');
  const hostKey = path.join(directory, 'ssh_host_ed25519_key');
  const knownHosts = path.join(directory, 'known_hosts');
  const socket = path.join(directory, 'agent.sock');

  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', privateKey]);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey]);
  await fsp.chmod(privateKey, 0o600);
  const hostPublicFields = (await fsp.readFile(`${hostKey}.pub`, 'utf8')).trim().split(/\s+/);
  await fsp.writeFile(knownHosts, `allowed.test ${hostPublicFields[0]} ${hostPublicFields[1]}\n`);

  return {
    directory,
    privateKey,
    publicKey: `${privateKey}.pub`,
    knownHosts,
    socket,
  };
}

function agentEnvironment(fixture: AgentFixture): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SSH_AUTH_SOCK: fixture.socket,
    SANDBOX_SSH_PRIVATE_KEY_FILE: fixture.privateKey,
    SANDBOX_SSH_KNOWN_HOSTS_FILE: fixture.knownHosts,
    SANDBOX_SSH_ALLOWED_DESTINATIONS: 'root@allowed.test',
  };
}

async function waitForAgentReady(child: ChildProcess, socket: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  const readyFile = path.join(path.dirname(socket), 'ready');
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`ssh-agent encerrou antes de criar o socket: ${child.exitCode}`);
    }
    try {
      const stat = await fsp.stat(socket);
      if (stat.isSocket() && fs.existsSync(readyFile)) return;
    } catch {
      // O socket ainda está sendo criado.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timeout aguardando prontidão do ssh-agent');
}

async function stopAgent(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout encerrando ssh-agent')), 5_000)),
  ]);
}

function loadedPublicKey(socket: string): string {
  return execFileSync('ssh-add', ['-L'], {
    encoding: 'utf8',
    env: { ...process.env, SSH_AUTH_SOCK: socket },
  }).trim().split(/\s+/).slice(0, 2).join(' ');
}

test('carrega a identidade em agente lateral e preserva o fingerprint após reinício', async () => {
  const fixture = await createAgentFixture();
  const expectedPublicKey = (await fsp.readFile(fixture.publicKey, 'utf8'))
    .trim().split(/\s+/).slice(0, 2).join(' ');
  const privateKeyContents = await fsp.readFile(fixture.privateKey, 'utf8');

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const child = spawn(startAgentScript, [], {
        env: agentEnvironment(fixture),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { output += chunk.toString(); });

      try {
        await waitForAgentReady(child, fixture.socket);
        assert.equal(loadedPublicKey(fixture.socket), expectedPublicKey);
        assert.equal(execFileSync(healthScript, [], {
          env: { ...process.env, SSH_AUTH_SOCK: fixture.socket },
        }).length, 0);
        assert.doesNotMatch(output, /BEGIN OPENSSH PRIVATE KEY/);
        assert.ok(!output.includes(privateKeyContents));
      } finally {
        await stopAgent(child);
      }
    }
  } finally {
    await fsp.rm(fixture.directory, { recursive: true, force: true });
  }
});

test('mantém o agente vazio e saudável quando o segredo não foi provisionado', async () => {
  const fixture = await createAgentFixture();
  const missingKey = path.join(fixture.directory, 'missing-key');
  const child = spawn(startAgentScript, [], {
    env: { ...agentEnvironment(fixture), SANDBOX_SSH_PRIVATE_KEY_FILE: missingKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForAgentReady(child, fixture.socket);
    const listResult = spawnSync('ssh-add', ['-l'], {
      env: { ...process.env, SSH_AUTH_SOCK: fixture.socket },
    });
    assert.equal(listResult.status, 1);
    assert.equal(spawnSync(healthScript, [], {
      env: { ...process.env, SSH_AUTH_SOCK: fixture.socket },
    }).status, 0);
  } finally {
    await stopAgent(child);
    await fsp.rm(fixture.directory, { recursive: true, force: true });
  }
});

test('rejeita chave privada com permissão ampla e allowlist malformada', async () => {
  const fixture = await createAgentFixture();
  try {
    await fsp.chmod(fixture.privateKey, 0o644);
    const unsafeMode = spawnSync(startAgentScript, [], {
      encoding: 'utf8',
      env: agentEnvironment(fixture),
    });
    assert.equal(unsafeMode.status, 1);
    assert.match(unsafeMode.stderr, /permissão 0600/);

    await fsp.chmod(fixture.privateKey, 0o600);
    const malformedDestination = spawnSync(startAgentScript, [], {
      encoding: 'utf8',
      env: {
        ...agentEnvironment(fixture),
        SANDBOX_SSH_ALLOWED_DESTINATIONS: 'root@allowed.test;malicioso',
      },
    });
    assert.equal(malformedDestination.status, 1);
    assert.match(malformedDestination.stderr, /destino inválido/);
  } finally {
    await fsp.rm(fixture.directory, { recursive: true, force: true });
  }
});

test('wrapper nega destino fora da allowlist antes de tentar a rede', () => {
  const result = spawnSync(sshWrapper, ['root@127.0.0.1', 'true'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SANDBOX_SSH_ALLOWED_DESTINATIONS: 'root@allowed.test',
    },
  });

  assert.equal(result.status, 77);
  assert.match(result.stderr, /destino não autorizado/);
});

test('compose isola a chave privada no sidecar e monta somente o socket no orquestrador', async () => {
  const compose = await fsp.readFile(path.join(repositoryRoot, 'docker-compose.yml'), 'utf8');
  const sidecarStart = compose.indexOf('  sandbox-ssh-agent:');
  const orchestratorStart = compose.indexOf('  sandbox-orchestrator:');
  const mcpStart = compose.indexOf('  mcp-server:');
  assert.ok(sidecarStart > 0 && orchestratorStart > sidecarStart && mcpStart > orchestratorStart);

  const sidecar = compose.slice(sidecarStart, orchestratorStart);
  const orchestrator = compose.slice(orchestratorStart, mcpStart);
  assert.match(sidecar, /network_mode: none/);
  assert.match(sidecar, /read_only: true/);
  assert.match(sidecar, /cap_drop:\n\s+- ALL/);
  assert.match(sidecar, /no-new-privileges:true/);
  assert.match(sidecar, /SANDBOX_SSH_KEY_HOST_DIR[^\n]+:\/run\/secrets\/sandbox-ssh:ro/);
  assert.match(sidecar, /start-sandbox-ssh-agent/);
  assert.match(orchestrator, /sandbox-ssh-agent:\n\s+condition: service_healthy/);
  assert.match(orchestrator, /sandbox-ssh-agent-socket:\/run\/sandbox-ssh-agent:ro/);
  assert.doesNotMatch(orchestrator, /run\/secrets\/sandbox-ssh/);
  assert.doesNotMatch(orchestrator, /SANDBOX_OPS_SSH_PRIVATE_KEY/);
});

test('workflow persiste o segredo fora do repositório e verifica o fingerprint sem expô-lo', async () => {
  const workflow = await fsp.readFile(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
  const publicKey = await fsp.readFile(path.join(packageRoot, 'ssh/operator_key.pub'), 'utf8');
  const knownHosts = await fsp.readFile(path.join(packageRoot, 'ssh/known_hosts'), 'utf8');

  assert.match(publicKey, /^ssh-ed25519 [A-Za-z0-9+/=]+ codex-ops-ai-hub-2026-09-06\n$/);
  for (const host of ['163.245.203.201', '163.245.200.7', '191.252.181.168', '191.252.210.83']) {
    assert.match(knownHosts, new RegExp(`^${host.replaceAll('.', '\\.')} `, 'm'));
  }
  assert.match(workflow, /SANDBOX_OPS_SSH_PRIVATE_KEY: \$\{\{ secrets\.SANDBOX_OPS_SSH_PRIVATE_KEY \}\}/);
  assert.match(workflow, /\/root\/infra\/sandbox-ssh\/id_ed25519/);
  assert.match(workflow, /chmod 600 \/root\/infra\/sandbox-ssh\/id_ed25519/);
  assert.match(workflow, /ssh-keygen -y -f[^\n]+\| awk '\{ print \$1 " " \$2 \}'/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /UserKnownHostsFile=\$HOME\/\.ssh\/known_hosts/);
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no/);
  assert.match(workflow, /docker compose exec -T sandbox-orchestrator test ! -e \/run\/secrets\/sandbox-ssh\/id_ed25519/);
  assert.doesNotMatch(workflow, /echo "\$\{SANDBOX_OPS_SSH_PRIVATE_KEY\}"/);
});

test('topologia Docker de homologação não usa rede, privilégio, socket Docker ou bind mount', async () => {
  const compose = await fsp.readFile(path.join(packageRoot, 'tests/ssh-agent-compose.yml'), 'utf8');

  assert.match(compose, /network_mode: none/);
  assert.match(compose, /cap_drop:\n\s+- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.doesNotMatch(compose, /privileged:/);
  assert.doesNotMatch(compose, /network_mode: host/);
  assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/);
  assert.doesNotMatch(compose, /^\s+- (?:\/root|\.\.?\/|~\/)[^:\n]*:/m);
  assert.match(compose, /ssh-agent-socket:\/run\/sandbox-ssh-agent:ro/);
  const probe = compose.slice(compose.indexOf('  probe:'), compose.indexOf('\nvolumes:'));
  assert.doesNotMatch(probe, /ssh-key-data|run\/secrets\/sandbox-ssh/);
});

test('arquivos versionados do mecanismo não contêm uma chave privada', async () => {
  const files = [
    'Dockerfile',
    'README.md',
    'scripts/start-sandbox-ssh-agent',
    'scripts/sandbox-ssh-agent-health',
    'scripts/sandbox-ssh',
    'ssh/operator_key.pub',
    'ssh/known_hosts',
    'tests/ssh-agent-compose.yml',
    '../../docker-compose.yml',
    '../../.github/workflows/ci.yml',
  ];
  for (const relativePath of files) {
    const contents = await fsp.readFile(path.resolve(packageRoot, relativePath), 'utf8');
    assert.doesNotMatch(contents, /BEGIN OPENSSH PRIVATE KEY/, relativePath);
  }
  assert.equal(fs.existsSync(path.join(packageRoot, 'ssh/id_ed25519')), false);
});
