'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { apiCreateCandidate } from '@/lib/api';

export default function NuevoCandidatoPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    cvUrl: '',
    notes: '',
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiCreateCandidate({
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        cvUrl: form.cvUrl || undefined,
        notes: form.notes || undefined,
      });
      router.push('/candidatos');
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <header className="mb-6">
        <Link href="/candidatos" className="text-sm text-slate-500 hover:text-slate-700">
          ← Volver
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Nuevo candidato</h1>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="card max-w-2xl space-y-4">
        <div>
          <label className="label">Nombre completo *</label>
          <input
            className="input"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">Email *</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Teléfono</label>
            <input
              className="input"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+54 11 ..."
            />
          </div>
          <div>
            <label className="label">URL del CV</label>
            <input
              className="input"
              type="url"
              value={form.cvUrl}
              onChange={(e) => setForm({ ...form, cvUrl: e.target.value })}
              placeholder="https://..."
            />
          </div>
        </div>
        <div>
          <label className="label">Notas internas</label>
          <textarea
            className="input"
            rows={4}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Guardando...' : 'Crear candidato'}
          </button>
          <Link href="/candidatos" className="btn-secondary">
            Cancelar
          </Link>
        </div>
      </form>
    </Layout>
  );
}
