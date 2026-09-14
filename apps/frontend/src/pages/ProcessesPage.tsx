import { FormEvent, useEffect, useState } from 'react';
import client from '../api/client';
import ConfirmButton from '../components/ConfirmButton';

interface ProcessRecord {
  id: number;
  number: string;
  text: string;
  parentProcessId?: number;
  parentProcessNumber?: string;
  updatedAt: string;
}

export default function ProcessesPage() {
  const [items, setItems] = useState<ProcessRecord[]>([]);
  const [number, setNumber] = useState('');
  const [processText, setProcessText] = useState('');
  const [parentProcessId, setParentProcessId] = useState('');
  const [editing, setEditing] = useState<ProcessRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = () => client.get<ProcessRecord[]>('/processes').then(r => setItems(r.data)).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  const reset = () => { setNumber(''); setProcessText(''); setParentProcessId(''); setEditing(null); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const payload = { number: number.trim(), text: processText.trim(), parentProcessId: parentProcessId ? Number(parentProcessId) : null };
      if (editing) await client.put(`/processes/${editing.id}`, payload); else await client.post('/processes', payload);
      reset(); await load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const edit = (item: ProcessRecord) => { setEditing(item); setNumber(item.number); setProcessText(item.text); setParentProcessId(item.parentProcessId?.toString() ?? ''); };
  const remove = async (id: number) => { await client.delete(`/processes/${id}`); if (editing?.id === id) reset(); await load(); };
  return <div className="space-y-6">
    <div><h2 className="text-2xl font-semibold">Processos</h2><p className="text-sm text-slate-500">Cadastre processos e subprocessos que podem ser associados às solicitações.</p></div>
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-white/70 p-5 dark:border-slate-800 dark:bg-slate-900/60">
      <div><label htmlFor="parent-process" className="text-sm font-medium">Vincular como subprocesso de</label><select id="parent-process" value={parentProcessId} onChange={e => setParentProcessId(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 dark:bg-slate-950"><option value="">Nenhum (processo principal)</option>{items.filter(item => !item.parentProcessId && item.id !== editing?.id).map(item => <option key={item.id} value={item.id}>{item.number} — {item.text}</option>)}</select></div>
      <div><label htmlFor="process-number" className="text-sm font-medium">Número</label><input id="process-number" required maxLength={80} value={number} onChange={e => setNumber(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 dark:bg-slate-950" placeholder={parentProcessId ? `Ex.: ${items.find(item => item.id === Number(parentProcessId))?.number ?? '6'}.1` : 'Ex.: 6'} />{parentProcessId && <p className="mt-1 text-xs text-slate-500">Use o número do processo principal seguido de ponto e sequência, como 6.1 ou 5.2.</p>}</div>
      <div><label htmlFor="process-text" className="text-sm font-medium">Texto</label><textarea id="process-text" required maxLength={500} value={processText} onChange={e => setProcessText(e.target.value)} className="mt-1 min-h-24 w-full rounded-md border px-3 py-2 dark:bg-slate-950" placeholder="Nome ou descrição do processo" /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2"><button disabled={saving} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando...' : editing ? 'Atualizar processo' : 'Cadastrar processo'}</button>{editing && <button type="button" onClick={reset} className="rounded-md border px-4 py-2 text-sm">Cancelar</button>}</div>
    </form>
    <div className="overflow-x-auto rounded-xl border bg-white/70 dark:border-slate-800 dark:bg-slate-900/60"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="px-4 py-3">Número</th><th className="px-4 py-3">Tipo / vínculo</th><th className="px-4 py-3">Texto</th><th className="px-4 py-3">Ações</th></tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{item.number}</td><td className="px-4 py-3">{item.parentProcessNumber ? `Subprocesso de ${item.parentProcessNumber}` : 'Processo principal'}</td><td className="px-4 py-3">{item.text}</td><td className="flex gap-3 px-4 py-3"><button onClick={() => edit(item)} className="text-emerald-700 hover:underline">Editar</button><ConfirmButton label="Excluir" confirmLabel="Confirmar exclusão" onConfirm={() => remove(item.id)} /></td></tr>)}{items.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Nenhum processo cadastrado.</td></tr>}</tbody></table></div>
  </div>;
}
