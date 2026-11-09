# Plugins e a Loja

Cada pasta aqui é um plugin: o `plugin.json` (skills, ferramentas, credenciais e rotinas) e um servidor de referência sem dependências que guarda os dados num arquivo JSON. `lib/servidor.mjs` é a base comum desses servidores.

| Plugin     | Modelo de agente      | Porta |
| ---------- | --------------------- | ----- |
| `contador` | Contador              | 8790  |
| `delivery` | Atendente de delivery | 8791  |
| `suporte`  | Suporte técnico       | 8792  |

## A loja (`catalog.json`)

A tela **Loja** lê um `catalog.json` de um endereço. Não há servidor central: por padrão é o arquivo desta pasta na branch `main` do repositório, e cada empresa pode apontar para outro em **Loja → Endereço da loja** (HTTPS, ou HTTP só no próprio computador). Os endereços dentro do catálogo podem ser relativos ao endereço do próprio catálogo, então uma cópia desta pasta publicada em qualquer lugar já funciona.

O catálogo tem duas listas:

- `plugins` (aba **Habilidades**): `id`, `name`, `description`, `category`, `icon`, `version` e `url` do `plugin.json`, mais `docs` opcional (a página com "Como ligar"). A `version` precisa ser a do manifesto: é ela que faz a loja mostrar **Atualizar** sem baixar cada manifesto.
- `agents` (aba **Agentes**): um modelo de agente. Além dos campos do cartão, traz `plugin` (o `id` de uma habilidade do catálogo), `agent_name`, `instructions`, `goals`, `role` (padrão `operator`), `runtime` (padrão `opencode`, o único que usa ferramentas de plugin hoje), `model` opcional, `tools` (`{ "tool": "contador.prazos", "effect": "allow" | "approval" }`) e `schedules` (nomes das rotinas do plugin).

Instalar um modelo faz, nesta ordem: instala ou atualiza o plugin pelo endereço, grava as credenciais preenchidas, cria o agente de IA com as instruções e os objetivos, dá a ele as skills do plugin, liga a uma caixa (se escolhida), libera as ferramentas no motor e cria as rotinas em **Agendamentos**. O que não deu para fazer (motor desligado, credencial em branco) volta como pendência na tela, sem desfazer o resto.

Ícones conhecidos: `calculator`, `bike`, `life-buoy`, `briefcase`, `calendar`, `code`, `education`, `health`, `home`, `marketing`, `legal`, `shop`, `clinic`, `truck`, `food`. Outro nome mostra uma peça de quebra-cabeça.

Os servidores de referência não sobem sozinhos: depois de instalar, rode o `server.mjs` do plugin com o token (veja o README de cada um) ou troque-o pela API do sistema que a empresa já usa.
