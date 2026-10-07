# API de atendimento — recursos de paridade com o Chatwoot

Base: `/api/v1` (cookie de sessão + `x-csrf-token` em métodos que alteram, ou `api_access_token`).
Eventos em tempo real chegam por SSE em `GET /api/v1/events` (`event: <nome>`, `data: {"data": …, "performer": …}`).

## Mensagens

Cada mensagem traz `attachments` (lista) e `content_attributes`:

| Campo | Significado |
|---|---|
| `attachments[]` | `{id, message_id, file_type: image\|audio\|video\|file\|sticker, mime_type, file_name, file_size, duration, voice, downloaded, data_url}` — `data_url` (`/api/v1/attachments/{id}`) serve o arquivo com a sessão do agente |
| `content_attributes.in_reply_to` | id da mensagem respondida (citação); `in_reply_to_external_id` é o id no WhatsApp |
| `content_attributes.reactions[]` | `{emoji, sender_type: contact\|user, sender_id, sender_name}` — uma por remetente |
| `content_attributes.deleted` | `true` quando apagada (o `content` vira `null`) |
| `content_attributes.edited` | `true` quando editada pelo contato (`previous_content` guarda o texto anterior) |
| `content_attributes.external_error` | motivo da falha quando `status = failed` |

### Enviar

`POST /conversations/{display_id}/messages`

- JSON: `{content, private?, in_reply_to?}`
- `multipart/form-data`: campos `content`, `private`, `in_reply_to`, `voice` (`true` para nota de voz) e um ou mais arquivos em `attachments[]`. O WhatsApp leva um arquivo por mensagem: a legenda e a citação vão no primeiro.
- Limites do WhatsApp: imagem 16 MiB, áudio/vídeo 64 MiB, documento 100 MiB, figurinha 1 MiB.
- Os arquivos ficam na pasta de dados do app em `media/<sessão>/<AAAA>/<MM>/<id>.<ext>`. Mídias recebidas são baixadas em segundo plano assim que chegam.

### Ações

| Rota | Corpo | Efeito |
|---|---|---|
| `POST /conversations/{id}/messages/{message_id}/reactions` | `{emoji}` (vazio remove) | Reage (também no celular do contato) |
| `DELETE /conversations/{id}/messages/{message_id}` | — | Apaga mensagem enviada pela equipe (para todos no WhatsApp) ou nota privada |
| `POST /conversations/{id}/messages/{message_id}/retry` | — | Reenvia mensagem com falha (mesmo id do WhatsApp) |
| `POST /conversations/{id}/toggle_typing_status` | `{typing_status: on\|off\|recording, is_private?}` | Mostra "digitando…"/"gravando áudio…" ao contato (exceto em nota privada) e aos outros agentes |
| `POST /conversations/{id}/update_last_seen` | — | Marca como vista e envia confirmação de leitura (tique azul) das mensagens novas |
| `GET /attachments/{attachment_id}` | — | Arquivo (baixa do WhatsApp na hora se ainda não estiver no disco) |

### Eventos novos

- `conversation.typing_on` / `conversation.typing_off`: `{id, display_id, inbox_id, recording, is_private, user: {type: contact\|user, id, name}}` (também como webhooks `conversation_typing_on/off`).
- `message.updated` agora também cobre reações, citações recebidas, mensagens apagadas e editadas.
