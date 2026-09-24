import { FormEvent, useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import ConfirmButton from '../components/ConfirmButton';

interface ProductRecord {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const sortProducts = (items: ProductRecord[]) =>
  [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    client
      .get<ProductRecord[]>('/products')
      .then((response) => setProducts(sortProducts(response.data)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetForm = () => {
    setFormName('');
    setEditingProduct(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const name = formName.trim();
    if (!name) {
      setFormError('Informe o nome do produto.');
      return;
    }

    setSaving(true);
    setFormError(null);
    setFormSuccess(null);

    const payload = { name };

    try {
      if (editingProduct) {
        const response = await client.put<ProductRecord>(`/products/${editingProduct.id}`, payload);
        setProducts((prev) =>
          sortProducts(prev.map((product) => (product.id === response.data.id ? response.data : product)))
        );
        setFormSuccess('Produto atualizado com sucesso.');
      } else {
        const response = await client.post<ProductRecord>('/products', payload);
        setProducts((prev) => sortProducts([...prev, response.data]));
        setFormSuccess('Produto cadastrado com sucesso.');
      }
      resetForm();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (product: ProductRecord) => {
    setEditingProduct(product);
    setFormName(product.name);
    setFormError(null);
    setFormSuccess(null);
  };

  const handleDelete = async (productId: number) => {
    setError(null);
    try {
      await client.delete(`/products/${productId}`);
      setProducts((prev) => prev.filter((product) => product.id !== productId));
      if (editingProduct?.id === productId) {
        resetForm();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const totalProducts = useMemo(() => products.length, [products]);

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Cadastro de Produtos</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Gerencie os nomes de produtos disponíveis como informação nas solicitações.
          </p>
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          <p>Produtos: {totalProducts}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="product-name" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Nome
              </label>
              <input
                id="product-name"
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                placeholder="Ex.: Produto principal"
              />
            </div>

          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {saving ? 'Salvando...' : editingProduct ? 'Atualizar produto' : 'Cadastrar produto'}
            </button>
            {editingProduct && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancelar edição
              </button>
            )}
            {formError && <span className="text-sm text-red-500">{formError}</span>}
            {formSuccess && <span className="text-sm text-emerald-600">{formSuccess}</span>}
          </div>
        </form>
      </div>

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Produtos cadastrados</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/60">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Nome</th>
                <th className="px-4 py-3 text-left font-semibold">Atualizado em</th>
                <th className="px-4 py-3 text-left font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-center text-slate-500">
                    Carregando produtos cadastrados...
                  </td>
                </tr>
              )}
              {error && !loading && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-center text-red-500">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && products.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-center text-slate-500">
                    Nenhum produto cadastrado até o momento.
                  </td>
                </tr>
              )}
              {!loading && !error && products.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{product.name}</td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                    {new Date(product.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(product)}
                        className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        Editar
                      </button>
                      <ConfirmButton
                        onConfirm={() => handleDelete(product.id)}
                        label="Excluir"
                        confirmLabel="Confirmar exclusão"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
