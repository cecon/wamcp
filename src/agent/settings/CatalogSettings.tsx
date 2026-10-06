import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { http } from '../api';
import type { Canned } from '../types';
import type { SettingsProps } from './SettingsPage';
import { useAction } from './useAction';

export function LabelsSettings({ catalog, onChange }: SettingsProps) {
  const [form, setForm] = useState({ title: '', description: '', color: '#1f93ff' });
  const { error, busy, run } = useAction();
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Etiquetas</h2>
        <ul className="plain-list">
          {catalog.labels.map((l) => (
            <li key={l.id} className="row">
              <i className="swatch" style={{ background: l.color }} />
              <span>
                <strong>{l.title}</strong>
                {l.description && <small>{l.description}</small>}
              </span>
              <button
                className="icon-btn"
                aria-label={`Excluir ${l.title}`}
                onClick={() =>
                  void run(async () => {
                    if (!window.confirm(`Excluir a etiqueta ${l.title}?`)) return;
                    await http(`/labels/${l.id}`, 'DELETE');
                    await onChange();
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
        {catalog.labels.length === 0 && <p className="muted">Nenhuma etiqueta ainda.</p>}
      </section>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http('/labels', 'POST', { ...form, description: form.description || null });
            setForm({ title: '', description: '', color: form.color });
            await onChange();
          });
        }}
      >
        <h2>Nova etiqueta</h2>
        <label>
          Nome (vira minúsculas, sem espaços)
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={40}
            required
          />
        </label>
        <label>
          Descrição
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={200}
          />
        </label>
        <label>
          Cor
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          Criar etiqueta
        </button>
      </form>
    </div>
  );
}

export function CannedSettings() {
  const [items, setItems] = useState<Canned[]>([]),
    [form, setForm] = useState({ short_code: '', content: '' });
  const { error, busy, run } = useAction();
  const load = useCallback(() => http<Canned[]>('/canned_responses').then(setItems), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="settings-grid">
      <section className="panel">
        <h2>Respostas prontas</h2>
        <p className="muted">No compositor, digite “/” seguido do atalho.</p>
        <ul className="plain-list">
          {items.map((c) => (
            <li key={c.id} className="row">
              <span>
                <strong>/{c.short_code}</strong>
                <small>{c.content}</small>
              </span>
              <button
                className="icon-btn"
                aria-label={`Excluir /${c.short_code}`}
                onClick={() =>
                  void run(async () => {
                    await http(`/canned_responses/${c.id}`, 'DELETE');
                    await load();
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await http('/canned_responses', 'POST', form);
            setForm({ short_code: '', content: '' });
            await load();
          });
        }}
      >
        <h2>Nova resposta pronta</h2>
        <label>
          Atalho
          <input
            value={form.short_code}
            onChange={(e) => setForm({ ...form, short_code: e.target.value })}
            placeholder="saudacao"
            maxLength={40}
            required
          />
        </label>
        <label>
          Texto
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            rows={5}
            maxLength={4096}
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          Salvar
        </button>
      </form>
    </div>
  );
}
