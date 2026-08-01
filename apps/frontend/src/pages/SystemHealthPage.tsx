import { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../api/client';

type CommandResult = { exitCode?: number; stdout?: string; stderr?: string };
type Job = { jobId?: string; status?: string; profile?: string; startedAt?: string; sandboxPath?: string };
type Health = {
  generatedAt?: string;
  host?: CommandResult;
  sandbox?: { codexAppServer?: { status?: string; ready?: boolean; restartAttempts?: number; lastError?: string }; activeJobs?: Job[]; pendingJobs?: Job[]; status?: string; error?: string };
  queuedRequests?: Array<{ id: number; profile: string; createdAt: string }>;
  maintenanceBusy?: boolean;
};
type AdminConfiguration = { configured: boolean; environmentVariable: string };
const ADMIN_TOKEN_STORAGE_KEY = 'ai-hub:system-health-admin-token';

const readSavedAdminToken = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';
};

const saveAdminToken = (value: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = value.trim();
  if (trimmed) window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmed);
  else window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
};

const forgetAdminToken = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
};

const splitSections = (value = '') => {
  const sections: Record<string, string[]> = {};
  let current = '';
  value.split('\n').forEach((line) => {
    if (line.startsWith('__') && line.endsWith('__')) { current = line.slice(2, -2).toLowerCase(); sections[current] = []; }
    else if (current && line.trim()) sections[current].push(line);
  });
  return sections;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let size = value; let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

export default function SystemHealthPage() {
  const [token, setToken] = useState(() => readSavedAdminToken());
  const [rememberToken, setRememberToken] = useState(() => Boolean(readSavedAdminToken()));
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [configuration, setConfiguration] = useState<AdminConfiguration | null>(null);
  const sections = useMemo(() => splitSections(health?.host?.stdout), [health]);
  const headers = useMemo(() => ({ 'X-Admin-Token': token }), [token]);

  useEffect(() => {
    client.get('/admin/system-health/configuration')
      .then((response) => setConfiguration(response.data))
      .catch(() => setConfiguration(null));
  }, []);

  useEffect(() => {
    if (rememberToken) saveAdminToken(token);
    else forgetAdminToken();
  }, [rememberToken, token]);

  const load = useCallback(async () => {
    if (!token.trim()) { setError('Informe o token administrativo.'); return; }
    setLoading(true); setError('');
    try { const response = await client.get('/admin/system-health', { headers }); setHealth(response.data); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }, [headers, token]);

  const run = async (name: string, jobId?: string, destructive = true) => {
    const label = name.replaceAll('-', ' ');
    if (destructive && !window.confirm(`Confirmar a ação administrativa “${label}”? Ela será auditada e poderá interromper execuções.`)) return;
    setAction(name); setError(''); setMessage('Ação iniciada. Aguarde a conclusão…');
    try {
      const response = await client.post(`/admin/system-health/actions/${name}`, { jobId }, { headers: { ...headers, 'X-Idempotency-Key': crypto.randomUUID() }, timeout: 60000 });
      const result = response.data?.result as CommandResult | undefined;
      setMessage(`Ação concluída.${result?.stdout ? `\n${result.stdout}` : ''}`);
      await load();
    } catch (err) { setError((err as Error).message); setMessage(''); }
    finally { setAction(''); }
  };

  const disk = sections.disk?.[0]?.trim().split(/\s+/) ?? [];
  const services = (sections.services ?? []).map((line) => line.split('|'));
  const stats = new Map((sections.stats ?? []).map((line) => { const parts = line.split('|'); return [parts[0], parts.slice(1)]; }));
  const logs = (sections.logs ?? []).map((line) => { const [name, bytes] = line.split('|'); return { name, bytes: Number(bytes) }; }).sort((a, b) => b.bytes - a.bytes);
  const activeJobs = health?.sandbox?.activeJobs ?? [];

  return <div className="space-y-6">
    <header><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">Administração</p><h2 className="text-3xl font-bold text-slate-900 dark:text-white">Saúde do sistema</h2><p className="mt-2 text-slate-600 dark:text-slate-300">Diagnóstico e recuperação com comandos fixos, confirmação e auditoria. Nenhum comando Linux livre é aceito.</p></header>
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2"><label className="text-sm font-semibold">Token administrativo</label>{configuration && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${configuration.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{configuration.configured ? 'Configurado no servidor' : 'Ainda não configurado'}</span>}</div>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300"><strong>Onde obter:</strong> este token não é criado nem exibido pelo AI Hub. É o valor de <code className="rounded bg-white/70 px-1 py-0.5">HUB_MAINTENANCE_ADMIN_TOKEN</code> definido no arquivo <code className="rounded bg-white/70 px-1 py-0.5">.env</code> da implantação. Solicite-o ao administrador da VPS.</p>
      {configuration?.configured === false && <div className="mt-3 rounded-lg border border-rose-200 bg-white/70 p-3 text-sm text-rose-900"><p className="font-semibold">O servidor ainda não tem esse token.</p><p className="mt-1">Na VPS, gere um segredo com <code>openssl rand -hex 32</code>, grave como <code>HUB_MAINTENANCE_ADMIN_TOKEN=&lt;segredo&gt;</code> no <code>.env</code> do Compose e recrie o container do backend. O segredo nunca será mostrado nesta página.</p></div>}
      <div className="mt-3 flex gap-2"><input type="password" aria-label="Token administrativo" placeholder="Cole o valor configurado na VPS" value={token} onChange={(e) => setToken(e.target.value)} disabled={configuration?.configured === false} className="min-w-0 flex-1 rounded-lg border px-3 py-2 disabled:bg-slate-100 dark:bg-slate-900" autoComplete={rememberToken ? 'current-password' : 'off'}/><button onClick={load} disabled={loading || configuration?.configured === false} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{loading ? 'Atualizando…' : 'Carregar diagnóstico'}</button></div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-700 dark:text-slate-300"><label className="inline-flex items-center gap-2"><input type="checkbox" checked={rememberToken} onChange={(event) => setRememberToken(event.target.checked)} disabled={configuration?.configured === false} className="h-4 w-4 rounded border-slate-300 text-emerald-600"/><span>Lembrar neste navegador</span></label>{rememberToken && <button type="button" onClick={() => { setRememberToken(false); setToken(''); setHealth(null); forgetAdminToken(); }} className="rounded border px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-white dark:text-slate-300">Esquecer token salvo</button>}</div>
      <p className="mt-2 text-xs text-slate-500">Por segurança, o backend informa apenas se o segredo foi configurado. A opção de lembrar salva o token somente neste navegador, não no banco de dados.</p>
    </section>
    {error && <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-800">{error}</div>}
    {message && <pre className="whitespace-pre-wrap rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</pre>}
    {health && <>
      <div className="grid gap-4 md:grid-cols-4">{[['Total', disk[1] ? formatBytes(Number(disk[1])) : '—'], ['Utilizado', disk[2] ? formatBytes(Number(disk[2])) : '—'], ['Disponível', disk[3] ? formatBytes(Number(disk[3])) : '—'], ['Ocupação', disk[4] ?? '—']].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-950"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}</div>
      <section className="rounded-xl border bg-white p-5 dark:bg-slate-950"><h3 className="text-lg font-bold">Serviços e recursos</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="py-2">Serviço</th><th>Estado</th><th>CPU</th><th>Memória</th><th>Processos</th><th>I/O disco</th></tr></thead><tbody>{services.map(([name, status]) => { const metric = stats.get(name) ?? []; return <tr key={name} className="border-b last:border-0"><td className="py-2 font-medium">{name}</td><td>{status}</td><td>{metric[0] ?? '—'}</td><td>{metric[1] ?? '—'}</td><td>{metric[2] ?? '—'}</td><td>{metric[3] ?? '—'}</td></tr>; })}</tbody></table></div></section>
      <div className="grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-white p-5 dark:bg-slate-950"><h3 className="font-bold">Codex App Server</h3><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt>Estado</dt><dd className="font-semibold">{health.sandbox?.codexAppServer?.status ?? health.sandbox?.status ?? 'indisponível'}</dd><dt>Pronto</dt><dd>{health.sandbox?.codexAppServer?.ready ? 'Sim' : 'Não'}</dd><dt>Reinicializações</dt><dd>{health.sandbox?.codexAppServer?.restartAttempts ?? 0}</dd></dl><button onClick={() => run('restart-codex-app-server')} disabled={!!action} className="mt-4 rounded-lg border border-amber-500 px-3 py-2 text-sm font-semibold text-amber-700">Reinicializar Codex App Server</button></section><section className="rounded-xl border bg-white p-5 dark:bg-slate-950"><h3 className="font-bold">Fila</h3><p className="mt-2 text-3xl font-bold">{health.queuedRequests?.length ?? 0}</p><p className="text-sm text-slate-500">solicitações pendentes exibidas</p></section></div>
      <section className="rounded-xl border bg-white p-5 dark:bg-slate-950"><h3 className="font-bold">Jobs ativos</h3>{activeJobs.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nenhum job ativo.</p> : activeJobs.map((job) => <div key={job.jobId} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-mono text-sm">{job.jobId}</p><p className="text-xs text-slate-500">{job.profile} · {job.status}</p></div><div className="flex gap-2"><button onClick={() => run('cancel-job', job.jobId, false)} disabled={!!action} className="rounded border px-3 py-1.5 text-sm">Cancelar</button><button onClick={() => run('force-cancel-job', job.jobId)} disabled={!!action} className="rounded bg-rose-600 px-3 py-1.5 text-sm text-white">Forçar encerramento</button></div></div>)}</section>
      <section className="rounded-xl border bg-white p-5 dark:bg-slate-950"><h3 className="font-bold">Uso de logs por container</h3><div className="mt-3 grid gap-2 md:grid-cols-2">{logs.map((item) => <div key={item.name} className="flex justify-between rounded border p-2 text-sm"><span>{item.name}</span><strong>{formatBytes(item.bytes)}</strong></div>)}</div></section>
      <section className="rounded-xl border border-rose-200 bg-white p-5 dark:bg-slate-950"><h3 className="font-bold text-rose-700">Manutenção controlada</h3><p className="mt-1 text-sm text-slate-500">Pré-visualize antes de limpar. Apenas recursos antigos e escopos fixos são considerados.</p><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => run('preview-orphan-workspaces', undefined, false)} disabled={!!action} className="rounded border px-3 py-2 text-sm">Ver workspaces órfãos</button><button onClick={() => run('cleanup-orphan-workspaces')} disabled={!!action} className="rounded border border-rose-400 px-3 py-2 text-sm text-rose-700">Limpar workspaces órfãos</button><button onClick={() => run('preview-old-logs', undefined, false)} disabled={!!action} className="rounded border px-3 py-2 text-sm">Ver logs antigos</button><button onClick={() => run('cleanup-old-logs')} disabled={!!action} className="rounded border border-rose-400 px-3 py-2 text-sm text-rose-700">Limpar logs antigos</button><button onClick={() => run('cleanup-docker-orphans')} disabled={!!action} className="rounded border border-rose-400 px-3 py-2 text-sm text-rose-700">Limpar Docker órfão</button><button onClick={() => run('restart-sandbox')} disabled={!!action} className="rounded bg-rose-700 px-3 py-2 text-sm font-semibold text-white">Reinicializar sandbox</button></div></section>
    </>}
  </div>;
}
