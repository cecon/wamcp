// material-ui
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useState } from 'react';
import { http } from '../../api';
import { useFetch } from '../../useFetch';
import { useAction } from '../useAction';

interface AppStatus {
  app: { slug: string; owner: string | null; html_url: string; install_url: string } | null;
  repos: { inbox_id: number; repo: string }[];
}

/**
 * A identidade GitHub do agente (`name[bot]`): criada por um manifesto que o GitHub preenche e
 * instalada em repositórios; cada um vira um canal. Visível só para administradores.
 */
export function GithubAppPanel() {
  const status = useFetch<AppStatus>('/github_app');
  const [owner, setOwner] = useState(''),
    [next, setNext] = useState<string | null>(null);
  const { error, busy, run } = useAction();
  if (!status.data) return null;
  const { app, repos } = status.data;
  return (
    <Stack
      component="section"
      aria-label="GitHub App"
      spacing={1.5}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}
    >
      <Typography variant="h6" component="h2">
        GitHub App do agente
      </Typography>
      {app ? (
        <>
          <Typography variant="body2">
            O agente age no GitHub como <strong>@{app.slug}[bot]</strong>
            {app.owner && <> (de {app.owner})</>}. Cada repositório em que o App estiver instalado vira um
            canal, e os eventos chegam pelo webhook do App.
          </Typography>
          <Link href={app.install_url} target="_blank" rel="noreferrer" sx={{ alignSelf: 'flex-start' }}>
            Instalar ou escolher repositórios no GitHub
          </Link>
          {repos.length > 0 ? (
            <Typography variant="body2" color="text.secondary">
              Repositórios: {repos.map((r) => r.repo).join(', ')}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Ainda não instalado em nenhum repositório.
            </Typography>
          )}
          <Button
            color="error"
            disabled={busy}
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => {
              const ask = `Remover o App @${app.slug}[bot] do WAMCP? Os canais voltam ao token até você criar e instalar um App novo. Depois, apague o App também no GitHub.`;
              if (!window.confirm(ask)) return;
              void run(async () => {
                await http('/github_app', 'DELETE');
                setNext(null);
                status.reload();
              });
            }}
          >
            Remover GitHub App
          </Button>
          {error && (
            <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
              {error}
            </Typography>
          )}
        </>
      ) : (
        <>
          <Typography variant="body2">
            Dê ao agente uma identidade própria no GitHub, em vez do seu token pessoal: o GitHub abre com o
            App preenchido (permissões, eventos e webhook), você confirma e escolhe os repositórios.
          </Typography>
          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label="Organização (opcional; vazio cria na sua conta)"
              placeholder="ex.: minha-empresa"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              sx={{ width: '100%', maxWidth: 420 }}
            />
            {next ? (
              <Link href={next} target="_blank" rel="noreferrer">
                Abrir o GitHub para criar o App
              </Link>
            ) : (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const started = await http<{ url: string }>('/github_app', 'POST', {
                      owner: owner.trim() || null,
                    });
                    setNext(started.url);
                  })
                }
              >
                {busy ? 'Preparando…' : 'Criar GitHub App'}
              </Button>
            )}
            {error && (
              <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>
                {error}
              </Typography>
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}
