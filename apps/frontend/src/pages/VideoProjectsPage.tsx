import { FormEvent, useState } from 'react';
import client from '../api/client';
import { useFetch } from '../hooks/useFetch';
import ConfirmButton from '../components/ConfirmButton';
import { useToasts } from '../components/ToastContext';

const ownerHeaders = { 'X-Role': 'owner', 'X-User': 'ui-owner' } as const;

interface VideoProjectView {
  id: number;
  code: string;
  title: string;
  description?: string | null;
  productName?: string | null;
  status: string;
  language: string;
  tone?: string | null;
  targetAudience?: string | null;
  primaryGoal?: string | null;
  callToActionUrl?: string | null;
  avatarStyle?: string | null;
  heroImageUrl?: string | null;
  ownerEmail?: string | null;
  lastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  scenes: VideoSceneView[];
  assets: VideoAssetView[];
  lastRender?: VideoRenderView | null;
}

interface VideoSceneView {
  id: number;
  sequenceIndex: number;
  title?: string | null;
  script: string;
  visualStyle?: string | null;
  voiceoverUrl?: string | null;
  durationSeconds?: number | null;
  callToActionLabel?: string | null;
  primaryAssetUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VideoAssetView {
  id: number;
  type: string;
  label: string;
  source: string;
  description?: string | null;
  createdAt: string;
}

interface VideoRenderView {
  id: number;
  provider: string;
  providerJobId?: string | null;
  status: string;
  renderProfile?: string | null;
  requestedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  outputUrl?: string | null;
  failureReason?: string | null;
}

interface FormState {
  code: string;
  title: string;
  productName: string;
  status: string;
  language: string;
  tone: string;
  targetAudience: string;
  primaryGoal: string;
  callToActionUrl: string;
  avatarStyle: string;
  heroImageUrl: string;
  description: string;
  scenes: string;
  assets: string;
}

const initialForm: FormState = {
  code: '',
  title: '',
  productName: '',
  status: 'draft',
  language: 'pt-BR',
  tone: '',
  targetAudience: '',
  primaryGoal: '',
  callToActionUrl: '',
  avatarStyle: '',
  heroImageUrl: '',
  description: '',
  scenes: '[\n  {\n    "sequenceIndex": 1,\n    "title": "Abertura",\n    "script": "Bem-vindo ao nosso produto"\n  }\n]',
  assets: '[\n  {\n    "type": "image",\n    "label": "Hero",\n    "source": "https://exemplo.com/hero.png"\n  }\n]'
};

export default function VideoProjectsPage() {
  const { pushToast } = useToasts();
  const { data, setData, loading, error } = useFetch<VideoProjectView[]>(
    () => client.get('/video/projects').then((res) => res.data),
    []
  );

  const [form, setForm] = useState<FormState>(initialForm);

  const handleSubmit = async () => {
    let scenesPayload: unknown = [];
    let assetsPayload: unknown = [];

    try {
      scenesPayload = form.scenes.trim() ? JSON.parse(form.scenes) : [];
      if (!Array.isArray(scenesPayload)) {
        throw new Error('A lista de cenas precisa ser um array');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Erro ao interpretar cenas', 'error');
      return;
    }

    try {
      assetsPayload = form.assets.trim() ? JSON.parse(form.assets) : [];
      if (!Array.isArray(assetsPayload)) {
        throw new Error('A lista de assets precisa ser um array');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Erro ao interpretar assets', 'error');
      return;
    }

    const normalize = (value: string) => {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const payload = {
      code: form.code.trim(),
      title: form.title.trim(),
      description: normalize(form.description),
      productName: normalize(form.productName),
      status: normalize(form.status),
      language: normalize(form.language),
      tone: normalize(form.tone),
      targetAudience: normalize(form.targetAudience),
      primaryGoal: normalize(form.primaryGoal),
      callToActionUrl: normalize(form.callToActionUrl),
      avatarStyle: normalize(form.avatarStyle),
      heroImageUrl: normalize(form.heroImageUrl),
      scenes: scenesPayload,
      assets: assetsPayload
    };

    const response = await client.post('/video/projects', payload, { headers: ownerHeaders });
    const project: VideoProjectView = response.data;
    setData((prev) => {
      const list = prev ?? [];
      return [project, ...list.filter((item) => item.id !== project.id)];
    });
    pushToast('Projeto de vídeo criado com sucesso');
    setForm({ ...initialForm, code: '', title: '' });
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Projetos de Vídeo</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Estruture roteiros, assets e histórico de renderização para os vídeos de vendas com avatar.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5">
          <h3 className="text-lg font-semibold mb-4">Cadastrar projeto</h3>
          <form
            className="space-y-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Código *</label>
                <input
                  value={form.code}
                  onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="vid-landing-01"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Idioma</label>
                <input
                  value={form.language}
                  onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="pt-BR"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Título *</label>
                <input
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="Vídeo de lançamento do Produto X"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Status</label>
                <input
                  value={form.status}
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="draft"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Produto</label>
                <input
                  value={form.productName}
                  onChange={(event) => setForm((prev) => ({ ...prev, productName: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="Produto XPTO"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Público-alvo</label>
                <input
                  value={form.targetAudience}
                  onChange={(event) => setForm((prev) => ({ ...prev, targetAudience: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="Empreendedores digitais"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Objetivo primário</label>
                <input
                  value={form.primaryGoal}
                  onChange={(event) => setForm((prev) => ({ ...prev, primaryGoal: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="Gerar leads qualificados"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">CTA URL</label>
                <input
                  value={form.callToActionUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, callToActionUrl: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="https://dominio.com/cta"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Tom/Tonalidade</label>
                <input
                  value={form.tone}
                  onChange={(event) => setForm((prev) => ({ ...prev, tone: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="Amigável, consultivo..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Estilo do avatar</label>
                <input
                  value={form.avatarStyle}
                  onChange={(event) => setForm((prev) => ({ ...prev, avatarStyle: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="Realista, cartoon, humano..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Miniatura/Hero</label>
                <input
                  value={form.heroImageUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, heroImageUrl: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                  placeholder="https://dominio.com/thumb.jpg"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium">Briefing / Descrição</label>
              <textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:bg-slate-900 dark:border-slate-700"
                rows={3}
                placeholder="Contexto geral, produto, diferenciais..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Cenas (JSON)</label>
              <textarea
                value={form.scenes}
                onChange={(event) => setForm((prev) => ({ ...prev, scenes: event.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:bg-slate-900 dark:border-slate-700"
                rows={8}
              />
              <p className="mt-1 text-xs text-slate-500">
                Liste objetos com <code>sequenceIndex</code>, <code>title</code> e <code>script</code>. Campos adicionais são opcionais.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium">Assets (JSON)</label>
              <textarea
                value={form.assets}
                onChange={(event) => setForm((prev) => ({ ...prev, assets: event.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono dark:bg-slate-900 dark:border-slate-700"
                rows={6}
              />
              <p className="mt-1 text-xs text-slate-500">
                Utilize os campos <code>type</code>, <code>label</code>, <code>source</code> e opcionalmente <code>description</code>.
              </p>
            </div>
            <ConfirmButton onConfirm={handleSubmit} label="Criar projeto" confirmLabel="Confirmar criação" />
          </form>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-5">
          <h3 className="text-lg font-semibold mb-4">Projetos cadastrados</h3>
          {loading && <p className="text-sm text-slate-500">Carregando...</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="space-y-4">
            {(data ?? []).map((project) => (
              <article key={project.id} className="rounded border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div>
                    <h4 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                      {project.title}{' '}
                      <span className="text-sm font-normal text-slate-500">({project.code})</span>
                    </h4>
                    <p className="text-xs text-slate-500">
                      Criado em {new Date(project.createdAt).toLocaleString()} • Última atualização{' '}
                      {new Date(project.updatedAt || project.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                    {project.status.toUpperCase()} • {project.language}
                  </span>
                </header>
                {project.description && <p className="text-sm text-slate-600 dark:text-slate-300">{project.description}</p>}
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {project.productName && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">Produto</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{project.productName}</dd>
                    </div>
                  )}
                  {project.targetAudience && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">Público-alvo</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{project.targetAudience}</dd>
                    </div>
                  )}
                  {project.primaryGoal && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">Objetivo</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{project.primaryGoal}</dd>
                    </div>
                  )}
                  {project.tone && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">Tom</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{project.tone}</dd>
                    </div>
                  )}
                  {project.callToActionUrl && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">CTA</dt>
                      <dd>
                        <a
                          href={project.callToActionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 hover:underline"
                        >
                          {project.callToActionUrl}
                        </a>
                      </dd>
                    </div>
                  )}
                  {project.avatarStyle && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">Estilo do avatar</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{project.avatarStyle}</dd>
                    </div>
                  )}
                  {project.ownerEmail && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">Responsável</dt>
                      <dd className="text-slate-600 dark:text-slate-300">{project.ownerEmail}</dd>
                    </div>
                  )}
                  {project.heroImageUrl && (
                    <div>
                      <dt className="font-semibold text-slate-700 dark:text-slate-200">Miniatura</dt>
                      <dd>
                        <a
                          href={project.heroImageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-600 hover:underline"
                        >
                          {project.heroImageUrl}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
                <section>
                  <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Cenas</h5>
                  {project.scenes.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhuma cena cadastrada.</p>
                  ) : (
                    <ol className="mt-2 space-y-2">
                      {project.scenes.map((scene) => (
                        <li key={scene.id} className="rounded border border-slate-200 dark:border-slate-800 p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <strong>#{scene.sequenceIndex}</strong>
                            {scene.visualStyle && <span className="text-slate-500">{scene.visualStyle}</span>}
                          </div>
                          <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">{scene.title}</p>
                          <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{scene.script}</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                            {scene.voiceoverUrl && (
                              <a href={scene.voiceoverUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">
                                Voiceover
                              </a>
                            )}
                            {scene.primaryAssetUrl && (
                              <a href={scene.primaryAssetUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">
                                Asset principal
                              </a>
                            )}
                            {scene.callToActionLabel && <span>CTA: {scene.callToActionLabel}</span>}
                            {typeof scene.durationSeconds === 'number' && <span>Duração: {scene.durationSeconds}s</span>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
                <section>
                  <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Assets</h5>
                  {project.assets.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhum asset vinculado.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-xs">
                      {project.assets.map((asset) => (
                        <li key={asset.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-700 dark:text-slate-200">[{asset.type}]</span>
                          <span>{asset.label}</span>
                          <a href={asset.source} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">
                            Abrir
                          </a>
                          {asset.description && <span className="text-slate-500">— {asset.description}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h5 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Última renderização</h5>
                  {project.lastRender ? (
                    <div className="mt-2 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                      <p>
                        <strong>Provedor:</strong> {project.lastRender.provider}{' '}
                        {project.lastRender.renderProfile && (
                          <span className="text-slate-500">({project.lastRender.renderProfile})</span>
                        )}
                      </p>
                      <p>
                        <strong>Status:</strong> {project.lastRender.status.toUpperCase()}
                      </p>
                      <p>
                        <strong>Solicitado em:</strong> {new Date(project.lastRender.requestedAt).toLocaleString()}
                      </p>
                      {project.lastRender.finishedAt && (
                        <p>
                          <strong>Finalizado em:</strong> {new Date(project.lastRender.finishedAt).toLocaleString()}
                        </p>
                      )}
                      {project.lastRender.outputUrl && (
                        <p>
                          <a
                            href={project.lastRender.outputUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-600 hover:underline"
                          >
                            Ver vídeo renderizado
                          </a>
                        </p>
                      )}
                      {project.lastRender.failureReason && (
                        <p className="text-red-500">{project.lastRender.failureReason}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Nenhum job de renderização registrado.</p>
                  )}
                </section>
              </article>
            ))}
            {(data ?? []).length === 0 && !loading && !error && (
              <p className="text-sm text-slate-500">Nenhum projeto cadastrado até o momento.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
