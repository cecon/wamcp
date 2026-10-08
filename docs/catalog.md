# Catálogo de produtos

Cardápio no formato do mercado de food (modelo do iFood Catalog API v2): categorias, itens, complementos com
mínimo/máximo, código de integração (PDV), disponibilidade por dia/horário, pizza meio a meio e combos. Importação
por um _crawler_ que abre a página da loja no iFood num navegador real, e ferramentas para a IA consultar o cardápio
e calcular pedidos.

## Modelo

Valores em **centavos** (`*_cents`, inteiros). Ids próprios (inteiros) e, quando importado, o id do iFood em
`ifood_id` (texto). `external_code` é o código PDV/integração (texto livre até 60, único por tipo quando
preenchido). `status`: `available` | `unavailable` (pausado/esgotado). `position`: ordem (0, 1, 2…).

### Categoria (`/catalog/categories`)

| Campo           | Tipo                            | Notas                                    |
| --------------- | ------------------------------- | ---------------------------------------- |
| `id`            | int                             |                                          |
| `name`          | texto 1–80                      | único (sem diferenciar maiúsculas)       |
| `description`   | texto ≤ 500 \| null             |                                          |
| `template`      | `default` \| `pizza` \| `combo` | no máximo uma categoria `pizza`          |
| `external_code` | texto ≤ 60 \| null              |                                          |
| `status`        | `available` \| `unavailable`    | categoria pausada esconde todos os itens |
| `position`      | int                             |                                          |
| `ifood_id`      | texto \| null                   | somente leitura                          |
| `items_count`   | int                             | somente leitura                          |

### Produto

O que se vende ou se escolhe: nome, foto e dados. Um item e cada opção apontam para um produto (o mesmo produto pode
ser opção em vários grupos, como no iFood).

| Campo           | Tipo                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`            | int                                                                                                                            |
| `name`          | texto 1–120                                                                                                                    |
| `description`   | texto ≤ 1000 \| null                                                                                                           |
| `external_code` | texto ≤ 60 \| null                                                                                                             |
| `ean`           | texto ≤ 14 (só dígitos) \| null                                                                                                |
| `serving`       | `not_applicable` \| `serves_1` … `serves_4`                                                                                    |
| `dietary`       | lista de `vegetarian`, `vegan`, `organic`, `gluten_free`, `sugar_free`, `lactose_free`, `alcoholic`, `natural`, `zero`, `diet` |
| `image_url`     | texto \| null (`/api/v1/catalog/images/{file}` ou null)                                                                        |
| `slices`        | int \| null (pizza: fatias do tamanho)                                                                                         |
| `ifood_id`      | texto \| null                                                                                                                  |

### Item (`/catalog/items`)

A oferta dentro de uma categoria: produto + preço + disponibilidade + complementos.

| Campo                  | Tipo                                                                                  | Notas                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `id`                   | int                                                                                   |                                                               |
| `category_id`          | int                                                                                   |                                                               |
| `type`                 | `default` \| `pizza` \| `combo`                                                       | igual ao `template` da categoria                              |
| `product`              | Produto                                                                               | criado/atualizado junto com o item                            |
| `price_cents`          | int ≥ 0                                                                               | preço “por”; em pizza é 0 (o preço vem do tamanho)            |
| `original_price_cents` | int \| null                                                                           | preço “de” (promoção) — deve ser maior que `price_cents`      |
| `status`               | `available` \| `unavailable`                                                          |                                                               |
| `external_code`        | texto ≤ 60 \| null                                                                    |                                                               |
| `shifts`               | lista de `{ days: [0..6] (0 = domingo), start: "HH:MM", end: "HH:MM" }`               | vazio = sempre disponível; `end` < `start` cruza a meia-noite |
| `position`             | int                                                                                   |                                                               |
| `groups`               | lista de vínculos `{ group_id, min, max, position }` com o grupo expandido em `group` | mín ≥ 1 = obrigatório; 0 = opcional; `max` ≥ `min`, ≥ 1       |
| `available_now`        | bool                                                                                  | somente leitura: status, categoria e horário agora            |
| `ifood_id`             | texto \| null                                                                         |                                                               |

### Grupo de complementos (`/catalog/groups`)

Biblioteca reutilizável: o mesmo grupo (ex.: “Escolha a bebida”) pode estar em vários itens; mínimo/máximo ficam no
vínculo com o item.

| Campo           | Tipo                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`            | int                                                                                                                       |
| `name`          | texto 1–80                                                                                                                |
| `type`          | `ingredients` \| `specification` \| `offer_unit` \| `cutlery` \| `size` \| `crust` \| `edge` \| `topping` \| `combo_main` |
| `external_code` | texto ≤ 60 \| null                                                                                                        |
| `status`        | `available` \| `unavailable`                                                                                              |
| `options`       | lista de Opção                                                                                                            |
| `used_by`       | int (quantos itens usam)                                                                                                  |
| `ifood_id`      | texto \| null                                                                                                             |

Tipos: `ingredients` (com/sem ingrediente, adicionais), `specification` (ponto da carne, preparo), `offer_unit`
(escolher entre produtos, ex.: bebida), `cutlery` (talheres), `size`/`crust`/`edge`/`topping` (pizza),
`combo_main` (o grupo principal de um combo).

### Opção

| Campo                  | Tipo                                       | Notas                                                              |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `id`                   | int                                        |                                                                    |
| `product`              | Produto                                    | nome/foto/código da opção                                          |
| `price_cents`          | int ≥ 0                                    | acréscimo; em `size` é o preço base da pizza naquele tamanho       |
| `original_price_cents` | int \| null                                |                                                                    |
| `status`               | `available` \| `unavailable`               |                                                                    |
| `external_code`        | texto ≤ 60 \| null                         |                                                                    |
| `max_quantity`         | int ≥ 1                                    | quantas vezes a mesma opção pode ser escolhida (padrão 1)          |
| `fractions`            | lista de int \| null                       | só em `size`: quantos sabores o tamanho aceita, ex. `[1, 2]`       |
| `size_prices`          | lista de `{ size_option_id, price_cents }` | só em `topping`: preço do sabor por tamanho                        |
| `item_id`              | int \| null                                | só em combo: a opção é um item do cardápio (com seus complementos) |
| `position`             | int                                        |                                                                    |
| `ifood_id`             | texto \| null                              |                                                                    |

### Pizza

Categoria `pizza` e itens `pizza`. Cada pizza tem quatro grupos: `size` (mín 1, máx 1), `crust` (1..1), `edge`
(0..1) e `topping` (mín 1, máx = maior número de `fractions` dos tamanhos). O preço base vem da opção de tamanho; massa
e borda somam seus acréscimos; sabores cobram conforme a regra da loja (`settings.pizza_pricing`):

- `greater` (padrão do mercado): cobra o sabor mais caro no tamanho escolhido.
- `average`: média dos preços dos sabores escolhidos no tamanho (arredonda para cima, ao centavo).

Escolher N sabores exige que o tamanho tenha N em `fractions`.

### Combo

Categoria `combo` e itens `combo`. O grupo `combo_main` lista itens do cardápio (opções com `item_id`); cada item
escolhido traz seus próprios complementos (até 3 níveis, como no iFood). Preço = preço do combo + acréscimos.

## Regras de cálculo e validação (`POST /catalog/quote`)

Entrada:

```json
{
  "item_id": 10,
  "quantity": 2,
  "notes": "sem cebola",
  "choices": [{ "option_id": 5, "quantity": 1, "choices": [] }]
}
```

`choices` são as opções escolhidas (em combo, `choices` aninhadas são os complementos do item escolhido). A resposta
traz `{ unit_price_cents, total_price_cents, lines: [{ name, external_code, quantity, unit_price_cents }], errors: [] }`
e valida:

- item disponível agora (status, categoria, horário);
- cada grupo do item: soma das quantidades escolhidas entre `min` e `max`; opção pertence ao grupo, está disponível
  e respeita `max_quantity`;
- pizza: um tamanho; quantidade de sabores aceita pelo tamanho; preço pela regra `greater`/`average`;
- `notes` até 140 caracteres.

Erros em português, por exemplo “Escolha 1 opção em ‘Escolha a bebida’”, “Máximo de 3 em ‘Adicionais’”.

## API (`/api/v1`, cookie + CSRF como o resto; leitura para todos os agentes, escrita para administradores)

| Método           | Rota                            | Descrição                                                                                                            |
| ---------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET              | `/catalog`                      | Cardápio completo: `{ settings, categories: [Categoria + items: [Item]] }` (`?available=true` só o disponível agora) |
| GET/PATCH        | `/catalog/settings`             | `{ pizza_pricing: greater\|average, notes_max_length }`                                                              |
| GET/POST         | `/catalog/categories`           |                                                                                                                      |
| PATCH/DELETE     | `/catalog/categories/{id}`      | apagar exige categoria vazia (409)                                                                                   |
| POST             | `/catalog/categories/reorder`   | `{ ids: [...] }`                                                                                                     |
| GET/POST         | `/catalog/items`                | `?category_id=&q=&status=`; POST cria item + produto + vínculos                                                      |
| GET/PATCH/DELETE | `/catalog/items/{id}`           | PATCH aceita campos parciais (incl. `product`, `groups`)                                                             |
| POST             | `/catalog/items/{id}/duplicate` |                                                                                                                      |
| POST             | `/catalog/items/reorder`        | `{ category_id, ids: [...] }`                                                                                        |
| POST             | `/catalog/items/status`         | `{ ids, status }` pausar/ativar em massa                                                                             |
| GET/POST         | `/catalog/groups`               | grupos com opções                                                                                                    |
| GET/PATCH/DELETE | `/catalog/groups/{id}`          | PATCH substitui `options` quando enviado; apagar grupo em uso: 409                                                   |
| POST             | `/catalog/products/{id}/image`  | multipart `image` (png/jpg/webp ≤ 5 MB)                                                                              |
| DELETE           | `/catalog/products/{id}/image`  |                                                                                                                      |
| GET              | `/catalog/images/{file}`        | imagem (autenticado)                                                                                                 |
| POST             | `/catalog/quote`                | cálculo/validação (acima)                                                                                            |
| GET              | `/catalog/search?q=`            | busca itens por nome/descrição/código (até 20)                                                                       |
| POST             | `/catalog/imports`              | `{ url }` inicia importação do iFood (admin)                                                                         |
| GET              | `/catalog/imports/{id}`         | andamento e prévia                                                                                                   |
| POST             | `/catalog/imports/{id}/apply`   | `{ mode: merge\|replace }` grava no cardápio                                                                         |
| DELETE           | `/catalog/imports/{id}`         | cancela (fecha o navegador)                                                                                          |

Eventos: `catalog.updated` (qualquer alteração) e `catalog.import.updated` (andamento).

## Importação do iFood (crawler)

1. O administrador cola o link da loja (`https://www.ifood.com.br/delivery/<cidade>/<loja>/<merchantId>`) em
   **Catálogo → Importar do iFood**.
2. O servidor abre o **Microsoft Edge ou Google Chrome instalado**, visível, com um perfil próprio em
   `<pasta de dados>/browser` (a verificação do iFood fica lembrada nas próximas vezes), e navega até a loja.
3. Se o iFood pedir “Confirme que é humano”, o andamento fica `waiting_human` e a tela pede para a pessoa clicar na
   janela do navegador. O sistema **não** resolve a verificação sozinho.
4. O crawler acompanha as respostas de rede da página (DevTools Protocol) e guarda as que trazem o cardápio
   (`/catalog`, `/menu`, `site-api`), rola a página para carregar tudo e também lê os dados embutidos na página
   (`__NEXT_DATA__`). Limite de 5 minutos.
5. O conteúdo é convertido para o modelo acima (categorias, itens, preços de/por, códigos, complementos com mín/máx,
   pizzas com tamanhos/massas/bordas/sabores e preços por tamanho, combos, fotos) e mostrado como **prévia**.
6. Ao aplicar: `merge` atualiza o que já veio do iFood (pelo `ifood_id`, depois `external_code`) e cria o resto;
   `replace` substitui todo o cardápio. Fotos são baixadas para a pasta de dados (`catalog/`).

Estados: `starting` → `opening` → `waiting_human` → `loading` → `ready` (prévia) → `applied`, ou `failed`
(com mensagem) / `cancelled`. A prévia traz contagens (`categories`, `items`, `groups`, `options`, `images`) e a
árvore convertida.

Formatos aceitos pelo conversor (cada um com teste):

- **Consumidor/legado**: `{ data: { menu: [ { code, name, itens: [ { id, code, description, details, logoUrl,
unitPrice, unitMinPrice, unitOriginalPrice?, choices: [ { code, name, min, max, garnishItens: [ { id, code,
description, unitPrice, logoUrl? } ] } ] } ] } ] } }`.
- **Catalog v2** (API do parceiro): `[ { id, name, externalCode, template, items: [ … ] } ]` com
  `products/optionGroups/options` cruzados por id (formato do `GET …/categories?includeItems=true`).

## IA (MCP do atendimento)

Ferramentas para o assistente da caixa de entrada:

- `catalog_search { query }` — itens disponíveis agora com preço, código e se têm complementos obrigatórios.
- `catalog_item { item_id }` — item com grupos (mín/máx, opções e preços); pizza com tamanhos/sabores.
- `catalog_quote { item_id, quantity, choices, notes }` — mesmo cálculo de `POST /catalog/quote`.
- `catalog_send_item { conversation_id, item_id }` — envia foto + descrição + preço do item na conversa.

As respostas em português trazem preços formatados (`R$ 29,90`) e códigos PDV.

## Formatos de resposta

- Listas devolvem arrays; criação devolve 201 com o objeto; erros seguem `{ "error": "mensagem" }` (400 dados
  inválidos, 403 sem permissão, 404, 409 conflito, 422 regra de negócio).
- `GET /catalog/items/{id}` e o item dentro de `GET /catalog` têm o mesmo formato (com `product`, `groups[].group`
  e as opções completas).
- Importação:

```json
{
  "id": "7f3c…",
  "url": "https://www.ifood.com.br/delivery/…",
  "status": "ready",
  "message": null,
  "started_at": 1800000000,
  "counts": { "categories": 8, "items": 64, "groups": 21, "options": 140, "images": 58 },
  "preview": {
    "pizza_pricing": "greater",
    "categories": [
      {
        "name": "Pizzas",
        "template": "pizza",
        "items": [
          {
            "name": "Calabresa",
            "price_cents": 0,
            "external_code": "PZ01",
            "groups": [
              {
                "name": "Tamanho",
                "type": "size",
                "min": 1,
                "max": 1,
                "options": [{ "name": "Grande", "price_cents": 5990 }]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

`message` traz o motivo em português quando `failed` ou a instrução quando `waiting_human` (“Confirme no navegador
que você é humano”).
