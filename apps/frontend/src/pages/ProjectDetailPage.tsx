import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import client from '../api/client';
import { useFetch } from '../hooks/useFetch';
import ConfirmButton from '../components/ConfirmButton';
import { useToasts } from '../components/ToastContext';

interface Project {
  repo: string;
  repoUrl: string;
  blueprint?: { name: string };
}

interface RunRecord {
  id: number;
  runId: number;
  attempt: number;
  status?: string;
  conclusion?: string;
  workflowName?: string;
  createdAt: string;
}

interface ResponseRecord {
  id: number;
  repo: string;
  runId: number;
  prNumber?: number;
  rootCause?: string;
  fixPlan?: string;
  unifiedDiff?: string;
  confidence?: number;
  createdAt: string;
}

const ownerHeaders = { 'X-Role': 'owner', 'X-User': 'ui-owner' };

export default function ProjectDetailPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { pushToast } = useToasts();
  const { data: project } = useFetch<Project | null>(
    () => client.get(`/projects/${owner}/${repo}`).then((res) => res.data),
    [owner, repo]
  );
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [comment, setComment] = useState('');
  const [commentPr, setCommentPr] = useState('');
  const [analysisPr, setAnalysisPr] = useState<Record<number, string>>({});
  const [fixBase, setFixBase] = useState('main');
  const [fixTitle, setFixTitle] = useState('Correção automática');

  useEffect(() => {
    client.get(`/projects/${owner}/${repo}/runs`).then((res) => setRuns(res.data));
    client.get(`/projects/${owner}/${repo}/responses`).then((res) => setResponses(res.data));
  }, [owner, repo]);

  const analyzeRun = async (runId: number) => {
    const body: { prNumber?: number } = {};
    const prValue = analysisPr[runId];
    if (prValue) {
      body.prNumber = Number(prValue);
    }
    const response = await client.post(
      `/projects/${owner}/${repo}/runs/${runId}/logs/analyze`,
      body,
      { headers: ownerHeaders }
    );
    pushToast('Análise enviada para a OpenAI');
    setResponses((current) => [...current, response.data]);
  };

  const sendComment = async () => {
    if (!commentPr || !comment.trim()) {
      pushToast('Informe o número do PR e o comentário', 'error');
      return;
    }
    await client.post(
      `/projects/${owner}/${repo}/pr/${commentPr}/comment`,
      { markdown: comment },
      { headers: ownerHeaders }
    );
    pushToast('Comentário publicado no PR');
    setComment('');
  };

  const latestResponse = responses[responses.length - 1];

  const createFixPr = async () => {
    if (!latestResponse?.unifiedDiff) {
      pushToast('Nenhum diff disponível para abrir PR', 'error');
      return;
    }
    const payload = {
      base: fixBase,
      title: fixTitle,
      diff: latestResponse.unifiedDiff
    };
    await client.post(`/projects/${owner}/${repo}/create-fix-pr`, payload, { headers: ownerHeaders });
    pushToast('Pull request de correção criado');
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{owner}/{repo}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Blueprint: {project?.blueprint?.name ?? '—'} ·{' '}
            <a href={project?.repoUrl} target="_blank" rel="noreferrer" className="text-emerald-600">
              Abrir no GitHub
            </a>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5">
          <h3 className="text-lg font-semibold mb-3">Últimos workflow runs</h3>
          <ul className="space-y-3 text-sm">
            {runs.map((run) => (
              <li key={run.id} className="rounded border border-slate-200 dark:border-slate-800 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Run #{run.runId}</p>
                    <p className="text-xs text-slate-500">
                      {run.workflowName ?? 'Workflow'} · {run.status} / {run.conclusion}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="number"
                    placeholder="PR opcional"
                    value={analysisPr[run.runId] ?? ''}
                    onChange={(event) =>
                      setAnalysisPr((prev) => ({ ...prev, [run.runId]: event.target.value }))
                    }
                    className="w-28 rounded border border-slate-300 bg-white px-2 py-1 dark:bg-slate-900 dark:border-slate-700"
                  />
                  <ConfirmButton
                    onConfirm={() => analyzeRun(run.runId)}
                    label="Preparar análise"
                    confirmLabel="Confirmar download e envio"
                  />
                </div>
              </li>
            ))}
            {runs.length === 0 && <li className="text-slate-500">Nenhum run registrado ainda.</li>}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-lg font-semibold">Comentário em PR</h3>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-medium">Número do PR</label>
              <input
                value={commentPr}
                onChange={(event) => setCommentPr(event.target.value)}
                className="mt-1 w-32 rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Comentário (Markdown)</label>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={4}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
              />
            </div>
            <ConfirmButton
              onConfirm={sendComment}
              label="Preparar comentário"
              confirmLabel="Confirmar envio"
              disabled={!comment.trim()}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5 space-y-4">
        <h3 className="text-lg font-semibold">Última análise CiFix</h3>
        {latestResponse ? (
          <div className="space-y-3 text-sm">
            <p>
              <span className="font-medium">Run:</span> {latestResponse.runId} ·{' '}
              <span className="font-medium">Confiança:</span>{' '}
              {(latestResponse.confidence ?? 0).toFixed(2)}
            </p>
            <div>
              <h4 className="font-semibold">Causa raiz</h4>
              <p className="text-slate-600 dark:text-slate-300">{latestResponse.rootCause}</p>
            </div>
            <div>
              <h4 className="font-semibold">Plano de correção</h4>
              <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                {latestResponse.fixPlan}
              </p>
            </div>
            {latestResponse.unifiedDiff && (
              <div>
                <h4 className="font-semibold">Diff sugerido</h4>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900/90 p-4 text-xs text-emerald-100">
                  {latestResponse.unifiedDiff}
                </pre>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium">Branch base</label>
                    <input
                      value={fixBase}
                      onChange={(event) => setFixBase(event.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs font-medium">Título do PR</label>
                    <input
                      value={fixTitle}
                      onChange={(event) => setFixTitle(event.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <ConfirmButton
                    onConfirm={createFixPr}
                    label="Preparar PR de correção"
                    confirmLabel="Confirmar abertura do PR"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Nenhuma análise realizada ainda.</p>
        )}
      </div>
    </section>
  );
}
