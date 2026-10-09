import { useState } from 'react';
import { CircleCheck, Download } from 'lucide-react';
import type { Realtime } from '../../api';
import { Button } from '../../ui/Button';
import { SettingsHeader, SettingsPage } from '../../ui/Settings';
import { useAction } from '../../settings/useAction';
import { catalogApi } from '../catalogApi';
import { ApplyControls } from './ApplyControls';
import { ImportSteps } from './ImportSteps';
import { ImportCounts, PreviewTree } from './PreviewTree';
import { RUNNING, useImportJob } from './useImportJob';

const IFOOD = /^https:\/\/www\.ifood\.com\.br\/\S+$/;

interface Props {
  realtime?: Realtime;
  onOpenMenu: () => void;
  /** Polling interval of the import status (tests shorten it). */
  pollMs?: number;
}

/** Catálogo → Importar do iFood: link, live crawler progress, preview and merge/replace. */
export function ImportPage({ realtime, onOpenMenu, pollMs }: Props) {
  const { job, setJob } = useImportJob(realtime, pollMs);
  const [url, setUrl] = useState(''),
    [invalid, setInvalid] = useState('');
  const { error, busy, run } = useAction();
  const running = Boolean(job && RUNNING.includes(job.status));
  const start = () => {
    const link = url.trim();
    if (!IFOOD.test(link)) {
      setInvalid('Cole o link da loja no formato https://www.ifood.com.br/delivery/cidade/loja/…');
      return;
    }
    setInvalid('');
    void run(async () => setJob(await catalogApi.startImport(link)));
  };
  const cancel = () =>
    void run(async () => {
      await catalogApi.cancelImport(job!.id);
      setJob({ ...job!, status: 'cancelled' });
    });
  const cancelButton = (
    <Button color="slate" variant="faded" label="Cancelar importação" disabled={busy} onClick={cancel} />
  );

  return (
    <SettingsPage>
      <SettingsHeader
        title="Importar do iFood"
        description="Abrimos a página da sua loja no iFood em um navegador do computador do WA MCP, lemos o cardápio completo (categorias, itens, preços, complementos, pizzas e fotos) e mostramos uma prévia antes de gravar."
      />
      {(error || invalid) && (
        <p role="alert" className="text-sm text-n-ruby-11">
          {invalid || error}
        </p>
      )}
      {!job && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <label className="block min-w-72 flex-1">
            <span className="field-label">Link da loja no iFood</span>
            <input
              className="field"
              value={url}
              placeholder="https://www.ifood.com.br/delivery/sao-paulo-sp/minha-loja/…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <Button type="submit" icon={Download} label="Importar" disabled={busy} />
        </form>
      )}
      {job && running && (
        <section aria-label="Importação em andamento" className="flex flex-col gap-4">
          <ImportSteps job={job} />
          {cancelButton}
        </section>
      )}
      {job?.status === 'ready' && (
        <section aria-label="Prévia da importação" className="flex flex-col gap-4">
          <ImportSteps job={job} />
          <ImportCounts counts={job.counts} />
          {job.preview && <PreviewTree preview={job.preview} />}
          <ApplyControls
            busy={busy}
            onApply={(mode) => void run(async () => setJob(await catalogApi.applyImport(job.id, mode)))}
          />
          {cancelButton}
        </section>
      )}
      {job?.status === 'applied' && (
        <section aria-label="Importação concluída" className="flex flex-col gap-4">
          <p role="status" className="flex items-center gap-2 text-base font-medium text-n-teal-11">
            <CircleCheck size={20} /> Cardápio importado com sucesso.
          </p>
          <ImportCounts counts={job.counts} />
          <div className="flex gap-2">
            <Button label="Abrir cardápio" onClick={onOpenMenu} />
            <Button color="slate" variant="faded" label="Nova importação" onClick={() => setJob(null)} />
          </div>
        </section>
      )}
      {(job?.status === 'failed' || job?.status === 'cancelled') && (
        <section aria-label="Importação interrompida" className="flex flex-col gap-3">
          <p role="alert" className="rounded-xl bg-n-ruby-2 p-4 text-sm text-n-ruby-11">
            {job.status === 'failed'
              ? job.message || 'Não foi possível importar o cardápio.'
              : 'Importação cancelada. O navegador foi fechado.'}
          </p>
          <Button
            label={job.status === 'failed' ? 'Tentar novamente' : 'Nova importação'}
            className="self-start"
            onClick={() => {
              setUrl(job.url);
              setJob(null);
            }}
          />
        </section>
      )}
    </SettingsPage>
  );
}
