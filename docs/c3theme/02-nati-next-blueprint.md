# 02 — Blueprint real: como o nati-next adotou o C3Theme (referência para o WhatsAppMcp)

**Status:** extração de um caso concluído (nati-next, 26–30/10/2026). **Não é plano do WhatsAppMcp** — é o
"como foi feito, com o que doeu", para o plano de adoção sair daqui.
**Fontes lidas:** ADR 0018, `specs/066-retaguarda-c3theme/` (`spec.md`, `conversao.md`, `inventario.md`,
`entregas-c3theme.md`, `progresso.md`, `lote3/README.md`), `entregas/plano-c3/` (`PLANO-CONVERSAO.md`,
`PEDIDOS-C3THEME.md`), scripts de fiscalização, e o código de integração em `web/src` e
`backend/crates/{c3,server}`. Os pinos do C3Theme citados foram verificados no `web/package.json`/`Cargo.toml` e nos
pacotes instalados em `web/node_modules/@c3theme/`.
**Documentos irmãos:** `01-c3theme-inventario.md` (o que o pacote entrega hoje) e
`03-whatsappmcp-ui-inventario.md` (o que a UI do WhatsAppMcp precisa). Este documento é a ponte entre os dois.

---

## 0. Resumo para decisão (o que importa de verdade)

1. **O padrão que funcionou foi "shell do C3Theme + motor só nos CRUDs".** O nati manteve o próprio menu,
   breadcrumb e rotas, usou `AppLayout`/`AuthLayout` do pacote e montou `EntityList`/`EntityForm` do
   `@c3theme/engine` dentro desse shell. Não adotou o `C3Shell` do motor (que tomaria rotas e menu).
2. **A fundação custa mais do que as telas.** Em 26/10 saíram decisão, crate `nati-c3`, `/api/v1/c3`,
   adaptador de banco, sessão, permissões, `C3Cadastro` e o piloto Unidades; a conversão em massa (195/342 →
   338/338) aconteceu em **~24 h**, depois de os lotes e as ferramentas estarem prontos.
3. **O JSON da spec v0 é o ativo reutilizável.** Um cadastro novo virou "um JSON + um escritor sobre o serviço
   que já existe"; lista, filtros, presets, exportação e breadcrumb vieram de graça. O custo real foi o escritor
   (domínio, transação, auditoria, permissões) e os testes — não a tela.
4. **O C3Theme entregou muito além do que o nati usou.** `access`/`rowAccess`, campos públicos
   (`MoneyField`…), `PeriodFilter`/impressão, `id`/`dirty` de seção custom e `DataTable` servidor foram
   entregues nos PRs #37–#47, mas o nati só adotou `loadEntities`, os hooks (`permitted`, `lookup`,
   `run_list_action`) e os `lookups`/ações de lista. **Entrega ≠ adoção** — o rodapé do `CLAUDE.md` do nati
   registra explicitamente os itens "entregues e ainda a adotar".
5. **A régua (`scripts/c3-progresso.mjs`) é o mecanismo gerencial que fez a conversão fechar.** Ela conta
   arquivo por arquivo a presença de classe Bootstrap, gera `progresso.md` e `pnpm check` recusa o arquivo
   desatualizado. Funcionou; mas **não conta Font Awesome nem dependências** — por isso o nati terminou
   "100% convertido" ainda com `@fortawesome`/`simple-line-icons` no `nati.scss` e deps no `package.json`.
6. **Convivência custou hacks localizados, não arquitetura.** `themeOverrides` para anular o reboot do
   Bootstrap, um wrapper `.conteudo-angle` para a fonte/densidade antigas, `z-index` do SweetAlert,
   `@media print`, e um patch de `window.scrollTo`. No fim, o CSS legado foi isolado num bundle só do PDV
   (`nati-pdv.scss`) — o mesmo recurso que o WhatsAppMcp pode usar para qualquer tela que fique fora do tema.
7. **A dependência é por SHA, não por tag.** O ADR fala em tag, mas a implementação fixa commit:
   `github:cecon/C3Theme#<sha>&path:packages/ui` no `package.json` e `rev = "<sha>"` no `Cargo.toml`.
   São **dois refs no front, dois revs no Cargo e os dois lockfiles** por bump.
8. **O risco de Rust é concreto para o WhatsAppMcp:** o `c3-engine-rusqlite` do pino usa
   **rusqlite 0.40 / libsqlite3-sys 0.38**; o `wamcp-server` está em **rusqlite 0.39 / libsqlite3-sys 0.37**.
   Cargo não aceita dois `links = "sqlite3"`. Ou sobe o rusqlite do WhatsAppMcp para 0.40, ou implementa o
   trait `Store` do motor sobre a conexão existente (o trait é pequeno: `conn`/`begin` + `Conn::query/execute`).
9. **No front, adotar o shell do C3Theme força `react-router`.** `AppLayout`, `Breadcrumbs`, `AuthLayout` e o
   engine usam `react-router` 8; o WhatsAppMcp hoje tem um roteador de estado próprio (`src/agent/route.ts`).
   O engine também tem peer deps `swr` e `react-intl`. Isso é uma decisão de arquitetura antes de qualquer tela.
10. **Convivência Tailwind 4 × MUI/Emotion é o spike mais importante do WhatsAppMcp.** Hoje o app tem
    `agent.css` com tokens Chatwoot + preflight do Tailwind e um `theme.ts` que troca `html[data-theme]`. O
    C3Theme traz `CssBaseline` e um segundo modo claro/escuro (MUI `colorSchemes`). É preciso **um dono do
    reset e um dono do dark mode** antes de migrar telas — senão vira o problema do nati ao contrário.

---

## 1. Linha do tempo e fases

### 1.1 Quadro das fases (com evidência)

| Fase                                          | Quando   | Commits (nati-next)                                                     | O que entrou                                                                                                                                                                                                                                                                                                                           | Evidência                                                                          |
| --------------------------------------------- | -------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **0. Decisão e escopo**                       | 26/10    | `36b29801`                                                              | ADR 0018 + spec 066; layout = `AppLayout`; CRUD = entidade do motor; escrita delegada; breadcrumb padrão; **PDV/estações fora** (tema LoopCheck).                                                                                                                                                                                      | `docs/adr/0018-retaguarda-c3theme.md:19-33`                                        |
| **1. Fundação backend**                       | 26/10    | `9052ad8f`, `679f13fe`, `3318c10a`                                      | crate `backend/crates/c3`; `c3-engine` em `/api/v1/c3`; o núcleo do motor ganhou `trait Store` e o adaptador `c3-engine-rusqlite`; piloto **Unidades**; rotas no OpenAPI.                                                                                                                                                              | `specs/066.../spec.md:15-21`; `backend/crates/server/src/lib.rs:269-286`           |
| **2. Fundação front**                         | 26/10    | `1ca55d2e`, `844f6d60`                                                  | `TemaNati`/`C3ThemeProvider`; `AppLayout`; `menu-c3.tsx`; `Caminho`; `<C3Cadastro>`; remoção de `MenuLateral`/`BuscaMenu`/`SubmenuLateral`; e2e por ARIA.                                                                                                                                                                              | `git show --stat 1ca55d2e` (31 arquivos)                                           |
| **3. Lotes 1 e 2 (cadastros simples/médios)** | 26–27/10 | `fa27c970`, `26f8a553`, `b64cd612`, `1b522814`, `86aeba1c`              | 21+ entidades JSON + escritores; lote 1 (unidades, notificações, entregadores, almoxarifados, grupos de clientes, pista), lote 2 (delivery, Payio, microterminais, operadores, contas, estrutura, centros de custo, FCP, impressoras, tipos de operação).                                                                              | `specs/066.../inventario.md:5-21`; `backend/crates/c3/entidades/README.md:36+`     |
| **4. Lote 3 (mestre-detalhe)**                | 27–28/10 | `faa2d270`, `0b588df8`, `4e0dcf83`, `d7df7b12`, `c8752c0d`, `9bccc47f`  | decisão filho = entidade v0 com `reference` para o pai + seção `related` com `save: "with_parent"` + abas por `tab`; 54 JSON; pins `f82f1c2`/`4a76137`; escritores gravando pai+filhos na mesma transação; front de pessoas/perfis; view `0083` para o caixa da Máquina.                                                               | `specs/066.../lote3/README.md:8-55`                                                |
| **5. Pin novo + ferramenta de progresso**     | 29/10    | `ed5db04d`, `3d6e526e`, `cfd977e7`                                      | C3Theme `fd40f3a` (PRs #35–#47): hooks `permitted`/`user_value`/`lookup`/`run_list_action`, `loadEntities`; pin `a709e8b` (lookup CEP em filha `with_parent`); login no `AuthLayout`; `scripts/c3-progresso.mjs` com `--check`; primeiro placar 50/302.                                                                                | `specs/066.../entregas-c3theme.md:146-163`                                         |
| **6. Conversão em massa**                     | 29–30/10 | ~100 commits `c3: …` em `web/src/{features,app}` (de ~234 no intervalo) | 195/342 (29/10 20h) → **338/338** (30/10); 60 lotes planejados, 4–6 sessões paralelas; frentes Estoque, Financeiro, Tesouraria, Fiscal, Produtos, Reforma, Serviços, Pista.                                                                                                                                                            | `entregas/plano-c3/PLANO-CONVERSAO.md:3-16,241-260`; `specs/066.../progresso.md:7` |
| **7. Fecho**                                  | 30/10    | `17c851b3`, `696ba136`, `5ec8c067`, `76756063`, `b65e21b0`              | Bootstrap/Angle fora do `nati.scss` (foi para `nati-pdv.scss`, só PDV); `layout-c3.scss` sem variáveis do Angle e sem `.conteudo-angle`; front no C3Theme `2d62f45` (corrige `SelectField` numérico); SweetAlert acima de Drawer/Dialog; `unique` avisado antes de salvar; `help`→`hint`; "voltar para a lista" e breadcrumb clicável. | `specs/066.../entregas-c3theme.md:165-176`; `web/src/styles/nati.scss:1-28`        |

### 1.2 Números do caso

| Métrica                                         |                                                          Valor | Onde                                            |
| ----------------------------------------------- | -------------------------------------------------------------: | ----------------------------------------------- |
| Telas/arquivos na régua final                   |                                           **338 / 338 (100%)** | `specs/066.../progresso.md:7`                   |
| Telas no placar ao começar a conversão em massa |                                                195 / 342 (57%) | `PLANO-CONVERSAO.md:3`                          |
| Lotes planejados                                |                                                            ~60 | `PLANO-CONVERSAO.md:14,259`                     |
| Commits no intervalo 26–30/10                   |                   ~234 (≈100 tocando `web/src/features`/`app`) | `git log --since=2026-10-26 --until=2026-10-31` |
| Cobertura no PR de adoção do pin                |                       backend 94,9% · front 94,3% · diff 90,7% | `entregas-c3theme.md:158-159`                   |
| Entidades JSON no `app.json`                    |                                                       77 nomes | `backend/crates/c3/app.json:4-82`               |
| Bundle medido no build local                    | chunk do motor **4,52 MB**; shell **2,34 MB**; PDV **0,55 MB** | `web/dist/assets` (build de 30/10)              |
| Tempo de calendário                             |                                26/10 (decisão) → 30/10 (fecho) | commits                                         |

### 1.3 O que a linha do tempo ensina

- **Decisão e escopo primeiro, com uma exceção nomeada.** O ADR já dizia "PDV e apps das estações ficam fora,
  tema LoopCheck" (`ADR 0018:5`). Isso evitou discussão de paridade visual em 1/4 do produto.
- **Fundação em dois PRs separados:** backend (motor + banco + sessão) e front (shell + breadcrumb + piloto).
  O piloto Unidades é uma tela real, não uma demo — ele exercita `/api/v1/c3`, token, permissão e escrita.
- **Ferramental antes da escala.** `c3-progresso.mjs` nasceu em 29/10, com a conversão em 50/302; sem ele, 60
  lotes em paralelo não teriam como provar o que faltava.
- **Bump de dependência é PR próprio.** O pin `fd40f3a` entrou com hooks, `loadEntities` e JSONs de lookup;
  as telas vieram depois. Isso deu um "estado verde" para os lotes paralelos.
- **Fecho é uma fase separada.** Tirar Bootstrap, separar o CSS do PDV, trocar `help`→`hint`, corrigir
  z-index/SweetAlert e ajustar asserções de teste levou o dia 30 inteiro, mesmo com a régua quase zerada.

---

## 2. Arquitetura de integração (front + backend)

### 2.1 Desenho do que foi montado

```
React (Tauri ou navegador)
  TemaNati (C3ThemeProvider: tema, marca, pt-BR, claro/escuro)
    └─ AppLayout (menu, header, rodapé)
         └─ Caminho (Breadcrumbs do pacote + data/loja/ações da tela)
              └─ Outlet → tela
                   ├─ CRUD puro: <C3Cadastro entity="…"> → EngineProvider + EntityList/EntityForm
                   └─ tela MUI feita à mão: kit local shared/ui (Card, Tabela, Campos, Abas…)

HTTP  /api/v1/c3
  axum (nati-c3) ── middleware de sessão (Bearer JWT)
    └─ c3-engine (doc `a709e8b`, sem feature sqlx)
         ├─ leitura/validação: trait Store → BancoC3 → c3-engine-rusqlite → rusqlite 0.40 → loja.db
         └─ escrita: Hooks::write → Escritor da entidade → serviço da área (domínio, transação, auditoria)
```

### 2.2 Front — shell, menu e breadcrumb

**Provider único para o app logado e para o login.** O `TemaNati` é o mesmo nos dois lados (evita dois temas e
dois `localStorage`):

```tsx
// web/src/app/layout/TemaNati.tsx:21-26
export function TemaNati({ children }: { children: ReactNode }) {
  return (
    <C3ThemeProvider
      branding={MARCA}
      defaultConfig={PREFERENCIAS}
      storageKey={CHAVE}
      themeOverrides={AJUSTES_TEMA}
    >
      {children}
    </C3ThemeProvider>
  );
}
```

- `MARCA` = nome "NATI", `homePath: '/dashboard'` e logo (`TemaNati.tsx:6-10`).
- `PREFERENCIAS` = `{ brand: 'cyan', locale: 'pt-BR' }` — o ciano do C3Theme foi escolhido por ser o azul da
  marca NATI (`TemaNati.tsx:11-13`).
- `storageKey: 'nati-ui'`; o app **forçou `light`** no primeiro acesso enquanto havia telas Bootstrap
  (`TemaNati.tsx:14-18`). O C3Theme tem claro/escuro; o nati simplesmente não expôs o botão no header.

**Layout = `AppLayout` do pacote + partes do NATI.** O `breadcrumbs` nativo do `AppLayout` fica desligado para
usar o `Caminho` custom, que acrescenta loja/data e um slot para os botões da tela:

```tsx
// web/src/app/layout/Layout.tsx:58-72
<TemaNati>
  <AppLayout menu={menu} header={<Cabecalho />} breadcrumbs={false} footer={<Rodape />}>
    <Box className="cabecalho-pagina">
      <Caminho registro={registro} onSlot={setSlot} />
    </Box>
    <SlotCabecalho.Provider value={slot}>
      <SubmenuDaPagina.Provider value={setSubmenu}>
        <TituloRegistro.Provider value={setRegistro}>
          <Outlet />
        </TituloRegistro.Provider>
      </SubmenuDaPagina.Provider>
    </SlotCabecalho.Provider>
  </AppLayout>
  <Notifier />
</TemaNati>
```

**Menu:** o NATI não reescreveu a navegação. `menu-c3.tsx` converte a `navegacao.ts` existente em
`NavGroup[]` do pacote:

- área com submenu vira `NavItem` com `children`; com mais de um `grupo` (Produtos | Cadastros), o grupo vira
  nível (`menu-c3.tsx:29-45`);
- o menu filtra por `ocultas`/`submenu`/módulo dedicado como o menu antigo (`menu-c3.tsx:66-89`);
- **dívida assumida:** os ícones do menu continuam Font Awesome, embrulhados num componente de ícone
  (`iconeFa`, `menu-c3.tsx:13-23`). O pacote aceita `icon` como componente, então isso funciona — e é a razão
  de o `@fortawesome` não ter saído.

**Breadcrumb:** o menu é a fonte da verdade. `trilhaDaRota` usa `activeTrail(menu, pathname, search)` e, para
telas fora do menu, cai na área mais específica (`menu-c3.tsx:112-128`); `caminhoDoMenu` monta
`Início › módulo › grupo › tela` e acrescenta `› Novo` ou o título do registro (`menu-c3.tsx:95-106`). O
`Caminho` renderiza com `<Breadcrumbs links={…} heading={!registro} action={…} />`
(`Caminho.tsx:37-52`). O `heading={!registro}` evita duplicar o nome do registro (já apareceria no caminho).

**Rotas:** cada entidade ganhou `/{entidade}/*` (`rotas-c3.tsx:13`), e os endereços antigos redirecionam para
o nome novo (`leva('/notificacoes', '/notificacao_contatos')`, `rotas-c3.tsx:16-51`). Telas que ainda estavam
em transição mantiveram `RegistroAntigo` para `/edit/:id` (`rotas-c3.tsx:53-97`). Foi por isso que o e2e
conseguiu mudar de layout com URLs estáveis.

### 2.3 Front — o wrapper `<C3Cadastro>` (o ponto central)

O motor não é usado como shell: o nati monta o **estado do engine** à mão e renderiza só lista/formulário.

```tsx
// web/src/shared/cadastro/C3Cadastro.tsx:5-18 — o motor entra em chunk separado
const Motor = lazy(() => import('./C3CadastroMotor').then((m) => ({ default: m.C3CadastroMotor })));
export function C3Cadastro({ entity, componentes }: { entity: string; componentes?: C3Components }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Motor entity={entity} componentes={componentes} />
    </Suspense>
  );
}
```

```tsx
// web/src/shared/cadastro/C3CadastroMotor.tsx:52-85 — resumo
const cliente = useMemo(() => informado ?? clienteC3(), [informado]);
const meta = useSWR(['c3-meta', entity], () => loadEntities(cliente, [entity]));
const unicos = useMemo(() => (meta.data ? instrumentarUnicos(meta.data) : undefined), [meta.data]);
const motor = useMemo<EngineState | undefined>(
  () =>
    unicos && {
      client: cliente,
      app: { name: 'NATI', entities: Object.keys(unicos.entidades), layout: { menu: [] } },
      entities: unicos.entidades,
      components: { ...COMPONENTES, ...unicos.componentes, ...componentes },
    },
  [unicos, cliente, componentes],
);
// ...
return (
  <EngineProvider value={motor}>
    {/* botão "Voltar para a lista" */}
    {resto === '' ? (
      <EntityList key={entity} entity={entity} />
    ) : resto === 'new' ? (
      <Novo def={def} />
    ) : (
      <Registro def={def} id={resto} cliente={cliente} />
    )}
  </EngineProvider>
);
```

Detalhes que importam:

- **`app.layout.menu` é vazio de propósito** (`C3CadastroMotor.tsx:64`): o menu é o do NATI; o `app.json` do
  backend tem um menu só para o contrato (`backend/crates/c3/app.json:83-208`).
- **`loadEntities`** é o substituto do antigo `metas.ts`: carrega a entidade + filhas + alvos de `reference`
  transitivamente já com `applyAccess` (`entregas-c3theme.md:72-74`). O `C3CadastroMotor` ficou menor.
- **Título no breadcrumb** sai de um contexto próprio (`TituloRegistro.Provider` / `useTituloRegistro`): a
  lista não tem título; no `new` é "Novo"; no registro é o `titleField` lido por SWR (o mesmo cache do
  `EntityForm`, `C3CadastroMotor.tsx:24-43`).
- **Widgets custom** entram por nome no JSON (`component: "nati/..."`) e são resolvidos no registry
  `COMPONENTES` (`shared/cadastro/componentes/index.ts`) + `componentesProduto`
  (`features/produtos/c3/componentes.ts`). Isso permitiu manter abas específicas (ANP, fiscal, margem,
  aparelho da máquina) sem tocar no pacote.
- **Um passo além do pacote:** `campo-unico.tsx` instrumenta os campos `unique` do `/_meta` para avisar antes
  de salvar (o pacote não fazia isso). Custou um componente local, não um pedido novo.

### 2.4 Front — cliente HTTP e sessão

```ts
// web/src/infra/c3.ts:12-28
export function clienteC3(): C3Client {
  const base = createClient('/api/v1/c3', (): HeadersInit => {
    const token = tokenStore.ler();
    return token
      ? { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      : { Accept: 'application/json' };
  });
  // envolve todo método para 401 com token → encerra a sessão, como o `requisitar` faz com `nao_autenticado`
  return Object.fromEntries(
    Object.entries(base).map(([nome, f]) => [nome, vigiar(f)]),
  ) as unknown as C3Client;
}
```

O contrato do `C3Client` inclui `app`, `context`, `entity`, `list`, `get`, `create`, `update`, `remove`,
`action`, `bulkAction`, `listAction`, `lookup` (`@c3theme/engine/dist/api.d.ts`). No WhatsAppMcp a autenticação
é **cookie HttpOnly + `X-CSRF-Token`** (`src/agent/api.ts:18-52`), não Bearer: o wrapper do cliente terá de
injetar o CSRF nas mutações (e o servidor, devolver 401 no formato C3). É um adapter de ~30 linhas, mas não é
"de graça".

### 2.5 Backend — como o motor foi montado

**Crates e pin:**

```toml
# Cargo.toml:79-82
c3-engine = { git = "https://github.com/cecon/C3Theme", rev = "a709e8ba5554616003a98eec9094e3daa3a7fc8a" }
c3-engine-rusqlite = { git = "https://github.com/cecon/C3Theme", rev = "a709e8ba5554616003a98eec9094e3daa3a7fc8a" }
```

O `c3-engine` **não puxa sqlx por padrão**: a feature `sqlx` é opcional
(`crates/c3-engine/Cargo.toml`, no repo do C3Theme). O adaptador rusqlite é um crate separado justamente
porque o Cargo não aceita dois `links = "sqlite3"` no mesmo lock.

**Serviços, motor e rotas (`backend/crates/c3/src/lib.rs`):**

- `ServicosC3` agrega os serviços de aplicação que os escritores usam (`lib.rs:42-120`) — o motor não fala com
  infra.
- `motor()` monta `Engine::builder(BancoC3::new(banco)).app(APP).entity(json)… .hooks(HooksNati).build()`
  (`lib.rs:122-130`). O `build` valida cada JSON contra o banco **no boot** — JSON que não bate com a tabela
  derruba o servidor em vez de quebrar a tela.
- `rotas()` põe o middleware de sessão na frente (`lib.rs:132-136`).
- O servidor monta em `/api/v1/c3`:
  `nati_c3::ServicosC3::do_estado(...).com_contabil(...)` → `nati_c3::rotas(...)` →
  `.nest("/c3", c3)` (`backend/crates/server/src/lib.rs:271-286`).

**Banco (`infra/banco.rs`):**

```rust
// backend/crates/c3/src/infra/banco.rs:40-66 — conexões preparadas para o motor
impl Connections for ConexoesNati {
  type Conn = Conexao;
  fn get(&self) -> Result<Conexao, BoxError> { Ok(Conexao(abrir(&self.0)?)) }
}
pub fn abrir(caminho: &Path) -> rusqlite::Result<rusqlite::Connection> {
  let c = rusqlite::Connection::open(caminho)?;
  c.busy_timeout(ESPERA)?;
  c3_engine_rusqlite::prepare(&c)?;          // foreign_keys + REGEXP que o motor exige
  c.create_scalar_function("sem_acento", 1, flags, …)?; // busca sem acento do NATI
  c.create_collation(NUMERICA, comparar_numeros)?;
  for v in visoes::TODAS { c.execute_batch(v)?; }       // views TEMP (1:1 achatado, colunas calculadas)
  Ok(c)
}
```

O `Store` é implementado sobre `RusqliteStore<ConexoesNati>` (`banco.rs:88-97`); uma conexão por requisição
(abrir SQLite local é barato). **Esse é o ponto de maior atrito para outro app**: o adaptador é acoplado à
versão do rusqlite.

**Hooks (`backend/crates/c3/src/hooks.rs`):** o mapa completo do que o motor chama:

| Hook                                | Linha              | O que o NATI faz                                                                     |
| ----------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `capabilities(entity, branch, req)` | `hooks.rs:45-51`   | Lê a sessão; `ver`/`alterar` da entidade viram `list/read` e `create/update/delete`. |
| `delegates_writes`                  | `hooks.rs:53-55`   | `true` para toda entidade registrada: quem grava é o NATI.                           |
| `write(WriteCall)`                  | `hooks.rs:57-69`   | Monta `Gravacao` (op, id, antes, valores, banco, filhos) e chama `Escritor::gravar`. |
| `action_allowed`                    | `hooks.rs:72-75`   | Ação de registro exige a permissão de alterar.                                       |
| `run_action`                        | `hooks.rs:77-83`   | Reativação/desativação vão ao escritor (`acao`).                                     |
| `permitted(code, branch, req)`      | `hooks.rs:86-88`   | Código numérico ou chave do catálogo → `Permissoes.codigos()` da sessão.             |
| `user_value(key, req)`              | `hooks.rs:91-96`   | `$user` de `rowAccess`: id do operador logado.                                       |
| `run_list_action`                   | `hooks.rs:99-114`  | `grupos_contabeis.aplicar_modelo` chama o caso de uso do contábil.                   |
| `lookup`                            | `hooks.rs:118-151` | CNPJ (Receita) em `pessoas`; CEP em `pessoa_enderecos` (reusa `CepService`).         |

**Escritor e gravação (`registro.rs`):** o contrato é mínimo (`criar`/`alterar`/`excluir`, com `acao`
opcional) e o `gravar` roteia por `WriteOp` (`registro.rs:12-59`). O `Gravacao` carrega os filhos do
`with_parent` já validados (`registro.rs:62-75`) e oferece `filhos_de`/`lista_de` para o escritor regravar a
lista (`registro.rs:77-92`). Cada entidade tem um módulo em `backend/crates/c3/src/entidades/*.rs` que
implementa `Escritor` sobre o serviço existente.

**Sessão e erro:** o middleware valida o Bearer JWT pelo `AuthService::sessao` e põe a `Sessao` nas extensões
(`sessao.rs:31-41`); sem token, 401 no formato C3 (`sessao.rs:16-23`). O erro de domínio vira erro do contrato:
validação → 422 com `fields`, conflito → 409, sem permissão → 403, não encontrado → 404, indisponível → 503,
infra → 500 (`erro.rs:13-33`). O `campo_do_contrato` converte camelCase do domínio para `snake_case`
(`erro.rs:59-71`).

### 2.6 Contrato na prática: JSON da spec v0 e convenções de banco

Exemplo mínimo (`backend/crates/c3/entidades/unidades.json`): `specVersion`, `name` (= tabela), `label`,
`icon` (nome do iconsax), `titleField`, `fields` (tipo, `required`, `unique`, `maxLength`, `hint`),
`views.list` (colunas, busca, filtros, presets "Ativas"/"Inativas", `defaultSort`) e `views.form.sections`
(rows em grade). O motor monta lista e formulário a partir disso.

O lote 3 mostra os recursos mais caros:

```json
// grupos_contabeis.json:63-73 — filhos gravados junto com o pai
{
  "title": "Contas por papel",
  "related": {
    "entity": "grupo_contabil_contas",
    "field": "grupo_contabil_id",
    "save": "with_parent",
    "columns": ["papel", "conta_id"],
    "sort": "papel"
  }
}
```

```json
// grupos_contabeis.json:86-111 — ação de lista (sem registro) com input próprio
{ "name": "aplicar_modelo", "label": "Aplicar modelo", "target": "list",
  "input": { "fields": [{ "name": "segmento", "type": "enum", "required": true,
    "options": [{"value":"POSTO","label":"Posto"}, …] }], "rows": [["segmento"]] } }
```

Convenções de banco que o motor exige (ADR 0018:40-41; `entidades/README.md:15-34`):

- **nome da entidade = nome da tabela**; `id INTEGER PRIMARY KEY`;
- dinheiro em inteiro escalado (centavos), quantidade em milésimos, percentual em centésimos;
- `reference` = chave estrangeira no formato `{ id, title }`;
- exclusão lógica é `ativo = 0` + ação `reativar`; `ativo` fica `readOnly` no JSON;
- enum com o valor **como o banco grava** (`PISTA`, `SEM BALANCA`, `2`), sem tradução no adapter
  (`README.md:21-24`);
- coluna calculada/1:1 achatado → **view** com o nome da entidade (o motor lê pelo nome), como a view `0083`
  do caixa da Máquina;
- JSON aninhado, netos e arquivo persistido como campo ficam fora do v0 (contornos em `lote3/README.md:80-86`).

### 2.7 Mapa de arquivos (onde mexer em cada assunto)

| Assunto                       | Arquivo(s) no nati-next                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Provider/tema/marca           | `web/src/app/layout/TemaNati.tsx`, `tema-c3.ts`                                                             |
| Layout, rodapé, scroll patch  | `web/src/app/layout/Layout.tsx`                                                                             |
| Header (busca, módulos, sair) | `web/src/app/layout/Cabecalho.tsx`                                                                          |
| Menu (navegação → NavGroup)   | `web/src/app/layout/menu-c3.tsx`, `navegacao.ts`                                                            |
| Breadcrumb                    | `web/src/app/layout/Caminho.tsx`, `menu-c3.tsx`                                                             |
| Rotas de cadastro/redirect    | `web/src/app/rotas-c3.tsx`, `web/src/app/App.tsx`                                                           |
| Wrapper do motor              | `web/src/shared/cadastro/{C3Cadastro,C3CadastroMotor}.tsx`, `titulo-registro.ts`, `campo-unico.tsx`         |
| Componentes custom do motor   | `web/src/shared/cadastro/componentes/`, `features/produtos/c3/componentes.ts`                               |
| Cliente HTTP C3               | `web/src/infra/c3.ts`                                                                                       |
| CSS global e convivência      | `web/src/styles/{nati,layout-c3,nati-pdv,responsivo}.scss`, `web/src/main.tsx`                              |
| Testes do front               | `web/src/test/{setup.ts,render.tsx}`, `web/vitest.config.ts`                                                |
| Crate do motor                | `backend/crates/c3/{lib,registro,hooks,erro,sessao}.rs`, `infra/{banco,visoes}.rs`                          |
| Escritores                    | `backend/crates/c3/src/entidades/*.rs`                                                                      |
| JSON das entidades            | `backend/crates/c3/entidades/*.json`, `app.json`, `referencias/`                                            |
| Montagem no servidor          | `backend/crates/server/src/lib.rs:269-286`                                                                  |
| Régua e gates                 | `scripts/c3-progresso.mjs`, `scripts/check-linhas.mjs`, `package.json:10-12`, `scripts/ci-local.mjs:143`    |
| e2e por ARIA                  | `e2e/testes/apoio.ts`, `docs/e2e.md:35-41`                                                                  |
| Pin/release                   | `web/package.json:16-17`, `Cargo.toml:79-82`, `.github/workflows/{ci,release}.yml`, `docs/release.md:91-93` |

---

## 3. Pronto no pacote × construído no app × pedido ao C3Theme

### 3.1 O que existe no pacote no pino (verificado em `web/node_modules/@c3theme/*/dist`)

**`@c3theme/ui` (raiz):**

| Grupo                            | Exports relevantes                                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tema/preferências/i18n           | `C3ThemeProvider`, `createC3Theme`, `BRAND_COLORS`, `DEFAULT_FONT`, `FONT_OPTIONS`, `softColors`, `toneMain`, `useUiConfig`, `useBranding`, `useUiText`, `ANGLE` (`look: 'angle'`)                                                                                                               |
| Layout                           | `AppLayout` (+`DRAWER_WIDTH`, `HEADER_HEIGHT`), `AppFooter`, `AuthLayout`, `Breadcrumbs`, `CommandSearch`, `HeaderButtons` (`FullscreenButton`, `ColorModeButton`), `SettingsButton`, `SettingsDrawer`, `UserMenu`, `NotificationsButton`, `useNav`, `flattenNav`, `activeItemId`, `activeTrail` |
| Componentes                      | `Panel`, `PageLoader`, `notify`/`Notifier`, `ActionDialog`, `StatusChip`, `Logo`, `Dot`, `SoftAvatar`, `SoftIconButton`, `Progress`, `OtpInput`, `PasswordStrength`, `Loadable`, `ScrollX`, `MessagePage`                                                                                        |
| Campos públicos (pedido #37/#40) | `DecimalField`, `MoneyField`, `DateField`, `SelectField`, `RadioField`, `FlagsField`, `FileField`, `SearchSelectField`, `HintButton`/`withHint`, `parseDecimal`, `formatDecimal`, `currencySymbol`, `allFlags`, `decodedSize`, `formatKb`                                                        |
| Período/impressão (#41)          | `PeriodFilter`, `shortcutPeriod`, `activeShortcut`, `periodProblem`, `isoDate`, `PERIOD_SHORTCUTS`, `printHidden`, `printOnly`                                                                                                                                                                   |
| Skeletons (#44)                  | `AppSkeleton`, `PanelSkeleton`, `FormSkeleton`, `TableSkeletonRows`, `SkeletonFrame`                                                                                                                                                                                                             |

> **Atenção:** `PageHeader` aparece no README novo do C3Theme, mas **não existe no pino do nati**. O nati usa
> `Breadcrumbs` com `heading`/`action`. Não planeje com `PageHeader` sem conferir o pino.

**`@c3theme/ui/table` (subpath, pedido #47):** `DataTable`, `TableView`, `TablePagination`, `TableEmpty`,
`SortHeader`, `ColumnFilter`, `DebouncedField`, `RowCheckbox`/`selectColumn`, `ExpandButton`/`expandColumn`,
`colMeta`/`colLabel`/`textFilter`/`equalsFilter`/`normalizeText`, `dataTableOptions`/`applyUpdater`.
Peer **opcional** `@tanstack/react-table` (não instalado no nati → subpath não foi usado).

**`@c3theme/engine`:** `C3Shell`, `createClient`, `ApiError`, `EngineProvider`/`useEngine`/`useEntity`/
`useText`, `loadEntities`/`referencedEntities`/`applyAccess`, `EntityList`, `EntityForm`, `FieldInput`,
`RecordActions`, `useAction`, tipos (`C3Client`, `EngineState`, `C3Components`, `EntityDef`, `CustomSectionProps`).
Peer deps: `@c3theme/ui`, `@mui/material`, `react`, `react-dom`, `react-intl`, `react-router`, **`swr`**.

**Crates:** `c3-engine` (Axum 0.8 + contrato + CRUD genérico; `Store`/`Conn`/`Tx`; `Hooks` com
`org_access`, `capabilities`, `validate`, `delegates_writes`, `write`, `action_allowed`, `permitted`,
`user_value`, `run_action`, `run_list_action`, `lookup`) e `c3-engine-rusqlite` (adaptador, rusqlite 0.40).
`WriteCall` traz `company`, `branch`, `children` (`ChildWrite`/`ChildRow` com `op`, `id`, `index`, `before`,
`values`).

### 3.2 Quadro pedido → entrega → uso real no nati

| Pedido ao C3Theme                    | Entrega (PR/pino)                                                                                                                                         | O que o nati **usou de fato**                                                                                                                        | Veredito                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Campos de formulário públicos        | #37/#40 (`fd40f3a`): `MoneyField`, `DecimalField`, `DateField`, `SelectField`, `RadioField`, `FlagsField`, `FileField`, `SearchSelectField`, `HintButton` | **não importou nenhum** (`grep` em `web/src` = 0) — as telas MUI usam o kit local `shared/ui/Campos` (`InputMoeda`, `Marcador`, `Grupo`, `Selecao`…) | entregue, **não adotado**                 |
| `DataTable` com modo servidor        | #47, subpath `@c3theme/ui/table` + peer opcional `@tanstack/react-table`                                                                                  | **não instalou** `@tanstack/react-table`; listas usam `shared/ui/Tabela`/`Paginacao`/`useOrdenacao`                                                  | entregue, **não adotado**                 |
| Período + impressão                  | #41 (`PeriodFilter`, `printHidden`, `printOnly`)                                                                                                          | usa `shared/ui/imprimir.ts` (`naoImprime`, `imprimir`) e `sx @media print`                                                                           | entregue, **não adotado**                 |
| Permissão por seção/campo            | #38 (`access`, `rowAccess`, `$user`, `capabilities.fields`, hooks `permitted`/`user_value`)                                                               | implementou os hooks (`hooks.rs:86-96`), mas **nenhum JSON tem `access`/`rowAccess`**                                                                | mecanismo pronto, **dados não aplicados** |
| Seção custom com `id`/`dirty`        | #42 (`CustomSectionProps.id`/`dirty`)                                                                                                                     | widgets usam o contrato antigo (`record`, `onChange`, `editing`, `PropsSecao`)                                                                       | entregue, **não adotado**                 |
| `loadEntities` transitivo            | #43                                                                                                                                                       | **adotado** — substituiu `metas.ts` (`C3CadastroMotor.tsx:56`), `metas.test.ts` apagado                                                              | ✅                                        |
| Lookups (CEP/CNPJ)                   | #36/#39 + #50 (lookup em filha checa o pai)                                                                                                               | **adotado** — `pessoas.lookups` (CNPJ), `pessoa_enderecos.lookups` (CEP); `nati/cep` removido; hooks em `hooks.rs:118-151`                           | ✅                                        |
| Ação de lista                        | #35 (`target: "list"`, `Hooks::run_list_action`)                                                                                                          | **adotado** — `grupos_contabeis.aplicar_modelo`; `licenca_chaves.importar` ficou pendente                                                            | parcial                                   |
| Filtro de `reference`                | #32 (`FieldDef.filter`, `{"$field": …}`)                                                                                                                  | **não usado** — busca `"filter"` nos JSONs = 0; rotas `opcoes/*` antigas convivem                                                                    | entregue, **não adotado**                 |
| `SelectField` numérico               | #54 (`2d62f45`, só front)                                                                                                                                 | pin do front subiu; Cargo ficou em `a709e8b` porque os crates não mudaram                                                                            | ✅ (bump)                                 |
| Shell/layout/breadcrumb              | `AppLayout`, `AuthLayout`, `Breadcrumbs`, `CommandSearch`, `activeTrail`                                                                                  | **adotado** — `TemaNati`, `Layout`, `Caminho`, `menu-c3`                                                                                             | ✅ (o maior ganho)                        |
| Skeletons                            | #44                                                                                                                                                       | não usados diretamente no app (as telas usam `PageLoader`/`Apoio.Carregando`; o engine decide o que renderizar internamente)                         | entregue, não adotado no app              |
| CI recusa arquivo > 300 linhas       | #45 (no C3Theme)                                                                                                                                          | o nati já tinha `check-linhas.mjs`; a regra é do repo dele                                                                                           | irrelevante                               |
| Arquivo como campo de entidade       | ❌ fora do v0                                                                                                                                             | só `type: file` em ação; upload persistido não existe (certificado A1 segue widget)                                                                  | aberto                                    |
| Condição da filha sobre campo do pai | ❌ contorno                                                                                                                                               | abas condicionais resolvidas no widget (`visibleWhen`, etc.)                                                                                         | aberto                                    |
| Checklist com opção repetida         | ❌ não veio                                                                                                                                               | administradora × forma segue uma bandeira por forma                                                                                                  | aberto                                    |
| JSON aninhado como campo             | ❌ fora do v0                                                                                                                                             | `microterminais.prevenda` fica fora do motor (`rotas-c3.tsx:35-36`)                                                                                  | aberto                                    |
| Netos (`with_parent` de filha)       | ❌ fora do v0                                                                                                                                             | não usado                                                                                                                                            | aberto                                    |
| Campos calculados no schema          | ❌ fora do v0                                                                                                                                             | widgets custom (`nati/margem-do-produto`, `nati/custo-da-ficha`)                                                                                     | aberto                                    |

#### 3.2.1 Detalhe do que o time do C3Theme entregou (PR a PR)

| PR do C3Theme                  | O que foi criado/alterado no pacote                                                                                                                                                                                                                                                                                       | Consequência para quem adota                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **#35** ação da lista          | `ActionDef.target: "list"`; botão ao lado do "Adicionar"; `POST /{entity}/_actions/{name}` com `{input}`; hook `run_list_action`                                                                                                                                                                                          | importar `.nati`, "aplicar modelo"; sem registro                                         |
| **#36** lookups                | `lookups` na entidade: `field` → consulta no backend → preenche `fills`; hook `lookup`; `POST /{entity}/_lookups/{name}`; 404/503/422 tipados                                                                                                                                                                             | CEP/CNPJ deixam de ser widget e viram JSON + hook                                        |
| **#37** campos públicos        | `DecimalField`, `MoneyField`, `DateField`, `SelectField`, `RadioField`, `FlagsField`, `FileField`, `SearchSelectField`, `HintButton`/`withHint`, `parseDecimal`/`formatDecimal`/`currencySymbol`/`allFlags`/`decodedSize`/`formatKb`                                                                                      | mesma implementação usada pelo motor, disponível para tela à mão                         |
| **#38** permissão fina         | `access: {view, edit}` em campo/seção; `rowAccess: [{permission, where}]`; `$user` nas condições; `capabilities.fields` (`hidden`/`readOnly`); hooks `permitted` e `user_value`                                                                                                                                           | esconder/travar campo por código do catálogo; **sem implementar o hook, nada restringe** |
| **#39** lookups na shell       | CEP dispara sozinho (`trigger: "change"`), CNPJ por botão, "Desfazer" restaura o digitado                                                                                                                                                                                                                                 | UX de consulta pronta                                                                    |
| **#40** hint e busca           | ajuda atrás de `?` (`hint` no campo) e `SearchSelectField` com busca nas opções                                                                                                                                                                                                                                           | substitui `FormHelperText` fixo e select com busca local                                 |
| **#41** período/impressão      | `PeriodFilter` (De/Até/Filtrar/Imprimir/atalhos, filtros extras na mesma linha) e `printHidden`/`printOnly`                                                                                                                                                                                                               | equivalentes a `d-print-none`/`d-print-block`                                            |
| **#42** seção custom           | `CustomSectionProps` ganhou `id?` e `dirty`                                                                                                                                                                                                                                                                               | widget lê o registro gravado e sabe se há alteração pendente                             |
| **#43** `loadEntities`         | público e transitivo (entidade + filhas + alvos de `reference`), já com `applyAccess`                                                                                                                                                                                                                                     | substitui `carregarMetas`/`metas.ts`                                                     |
| **#44** skeletons              | `AppSkeleton`, `PanelSkeleton`, `FormSkeleton`, `TableSkeletonRows`, `SkeletonFrame`                                                                                                                                                                                                                                      | estados de carregamento com formato do conteúdo                                          |
| **#45/#46** interno            | CI recusa arquivo > 300 linhas; HTTP em adaptador próprio; `crud.rs`/`condition.rs` divididos                                                                                                                                                                                                                             | melhora manutenção, não muda o contrato                                                  |
| **#47** `DataTable` servidor   | subpath `@c3theme/ui/table`: `DataTable` (`server`, `total`, `sorting`, `pagination`, `rowSelection`, `stickyHeader`, filtros por coluna, vazio/carregando) + `TableView`, `TablePagination`, `TableEmpty`, `SortHeader`, `ColumnFilter`, `RowCheckbox`/`selectColumn`, `colMeta`…; peer opcional `@tanstack/react-table` | listas longas/ordenadas no backend                                                       |
| **#32** filtro de `reference`  | `FieldDef.filter?: Condition` (condição sobre a entidade apontada, `{"$field": …}`)                                                                                                                                                                                                                                       | substitui rotas `opcoes/*`                                                               |
| **#33** presets                | chips dos presets em linha própria (não caem ao lado dos selects)                                                                                                                                                                                                                                                         | visual                                                                                   |
| **#50** lookup em filha        | em filha `with_parent`, a consulta confere criar/alterar **no pai**                                                                                                                                                                                                                                                       | CEP do endereço da pessoa com a permissão da pessoa                                      |
| **#54** `SelectField` numérico | seleção de opção numérica deixava `null` (Select do MUI devolve número; a comparação era com texto)                                                                                                                                                                                                                       | travava Grupo/Subgrupo/microterminal no e2e                                              |
| **#29** preset na rota         | `?preset=` abre o "Novo" já com o preset do filtro                                                                                                                                                                                                                                                                        | e2e `novoC3` tolera `?preset=`                                                           |
| Já no pino antes de #35        | `enum` com valor do banco (#16), `save: with_parent` (#17), `tab` (#18), `maxItems: 1` como campos, `display: checklist`, `visibleWhen` de seção, `createOnly`, `readOnlyWhen`, `defaults`, `type: flags`, `format: cpf/cnpj`, `writeOnly`, `type: file` na ação, ações em lote                                           | base do lote 3                                                                           |

### 3.3 O que foi construído no app (não veio do C3Theme)

| Capacidade                                            | Onde                                                                                                                                                | Por que ficou no app                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tema/marca NATI                                       | `TemaNati.tsx`                                                                                                                                      | branding e preferências são do produto                                                                                                            |
| Overrides p/ convivência com Bootstrap                | `tema-c3.ts`                                                                                                                                        | específico do legado (links/labels/reset)                                                                                                         |
| Menu da navegação → `NavGroup`                        | `menu-c3.tsx` + `navegacao.ts`                                                                                                                      | o C3Theme não conhece as 4 seções, módulos e submenus do NATI                                                                                     |
| Breadcrumb com loja/data/slot de ações                | `Caminho.tsx` + `menu-c3.tsx`                                                                                                                       | regra do ADR 0018: caminho do menu + registro + ações da tela                                                                                     |
| Rotas `/{entity}/*` + redirects dos endereços antigos | `rotas-c3.tsx`                                                                                                                                      | migração sem quebrar URL/e2e                                                                                                                      |
| Wrapper `<C3Cadastro>` (lazy, client, meta, título)   | `shared/cadastro/C3Cadastro{,Motor}.tsx`                                                                                                            | usar o motor **sem** o `C3Shell`                                                                                                                  |
| Registry de widgets custom                            | `shared/cadastro/componentes/`, `features/produtos/c3/`                                                                                             | abas/seções que o v0 não modela                                                                                                                   |
| Aviso antecipado de `unique`                          | `shared/cadastro/campo-unico.tsx`                                                                                                                   | UX que o pacote não tinha                                                                                                                         |
| Kit MUI das telas convertidas                         | `shared/ui/*` (`Card`, `Tabela`, `Campos`, `Abas`, `Modal`, `BarraLateral`, `Paginacao`, `Autocompletar`, `Selo`, `Apoio`, `ordenacao`, `imprimir`) | nenhuma das 147 telas manuais adotou os campos públicos                                                                                           |
| Crate `nati-c3` inteiro                               | `backend/crates/c3`                                                                                                                                 | adaptador de banco, sessão, permissões, 77 entidades no `app.json`, 47 arquivos em `src/entidades` (46 módulos de escritor/referência + `mod.rs`) |
| Régua e gates                                         | `scripts/c3-progresso.mjs`, `ci-local`                                                                                                              | gestão da conversão em 60 lotes                                                                                                                   |
| CSS de convivência + split do PDV                     | `styles/layout-c3.scss`, `nati-pdv.scss`, `pdv/main.tsx`                                                                                            | dois temas no mesmo binário                                                                                                                       |

### 3.4 O que o nati **não** adotou (e a lição para o WhatsAppMcp)

1. **Campos públicos do `@c3theme/ui`:** o kit local (`shared/ui/Campos`) já cobria o que as telas manuais
   precisavam e foi mais rápido converter com ele. **Lição:** se o WhatsAppMcp for converter telas manuais,
   decidir de antemão: "kit local sobre MUI" ou "campos do pacote". Misturar sem regra gera dois padrões.
2. **`DataTable` servidor:** as listas do nati paginam/ordenam no cliente (ou com `useOrdenacao` local); o
   `DataTable` exigiria `@tanstack/react-table` e reescrever as listas. **Lição:** o ganho do `DataTable` só
   aparece em listas longas com servidor; para 20–100 linhas, o kit local basta.
3. **`PeriodFilter`/`print`:** as telas já tinham `FiltroConsulta`/`Imprimir` e `naoImprime`; trocar por
   `PeriodFilter` era risco de contrato de teste. **Lição:** impressão é área de contrato invisível
   (`#painel-impressao`, `window.print()`); só migre com e2e/visual.
4. **`access`/`rowAccess`:** o campo `permitted` foi implementado, mas os JSONs nunca receberam `access` — a
   permissão por campo continua no serviço/tela. **Lição:** mecanismo entregue sem dados aplicados não protege
   nada; trate "aplicar `access` nos JSONs" como tarefa separada com teste.
5. **`id`/`dirty` de seção custom:** os widgets antigos continuam com `record`/`onChange`/`editing`.
   **Lição:** migrar widgets custom é trabalho de tela, não de pacote.

### 3.5 O que segue em aberto no C3Theme (pedir de novo, se o WhatsAppMcp precisar)

- **Arquivo como campo de entidade** (persistido, com download): hoje `type: file` só existe no input de ação.
  O WhatsAppMcp tem anexos/áudio/imagem — isso é requisito real, não cosmético.
- **Condição da filha sobre campo do pai** (ex.: dado que só aparece conforme o tipo do pai).
- **Checklist com a mesma opção repetida** (duas bandeiras para a mesma opção).
- **JSON aninhado como campo** (o `configuracao` da Máquina virou widget; mensagem/contato do WhatsApp é
  aninhado por natureza).
- **Netos** (`with_parent` de filha) e **campos calculados no schema** (fora do v0).

---

## 4. Convivência de estilos e armadilhas

### 4.1 Dois regimes de CSS no mesmo bundle (o período 26–30/10)

Durante a conversão, o app rodou com **Bootstrap/Angle global + MUI global**. A ordem em `main.tsx` era:
`nati.scss` (Bootstrap/Angle) → `app-vue.scss` → `componentes.scss` → `layout-c3.scss` → `status.scss` →
`primeira-configuracao.scss` → `responsivo.scss` (`web/src/main.tsx:6-12`); o CSS do C3Theme entra por
Emotion/CssBaseline em runtime, **depois** do CSS estático.

A solução foi **conter o legado numa classe** e anular o reboot do Bootstrap nos componentes MUI:

```ts
// web/src/app/layout/tema-c3.ts:1-15
const semLink = { textDecoration: 'none' };
export const AJUSTES_TEMA = {
  components: {
    MuiListItemButton: {
      styleOverrides: { root: { color: 'inherit', '&:hover, &:focus': { ...semLink, color: 'inherit' } } },
    },
    MuiButtonBase: { styleOverrides: { root: { '&:hover, &:focus': semLink } } },
    MuiFormLabel: { styleOverrides: { root: { marginBottom: 0 } } },
    MuiInputLabel: { styleOverrides: { root: { marginBottom: 0 } } },
    MuiFormControlLabel: { styleOverrides: { root: { marginBottom: 0 } } },
    MuiOutlinedInput: {
      styleOverrides: { notchedOutline: { '& legend': { marginBottom: 0, lineHeight: 'inherit' } } },
    },
  },
};
```

O CSS antigo de convivência (antes do fecho) mostrava o resto:

```scss
// web/src/styles/layout-c3.scss (versão 17c851b3^)
// CssBaseline troca a fonte do <body>; as telas antigas mantêm a do Angle
.conteudo-angle {
  font-family: 'Source Sans Pro', sans-serif;
  font-size: 0.875rem;
  line-height: $line-height-base;
  color: $body-color;
}
.indicador-topo .dropdown-menu {
  z-index: 1300;
} // dropdown do Angle dentro do header MUI
@media print {
  .cabecalho-pagina,
  .MuiAppBar-root,
  aside:has(> .MuiDrawer-root) {
    display: none !important;
  }
}
```

E o wrapper no layout:

```tsx
// web/src/app/layout/Layout.tsx (versão 17c851b3^) — removido no fecho
<div className="conteudo-angle">
  <Outlet />
</div>
```

### 4.2 Fonte, reset e densidade

- O `CssBaseline` do MUI troca a fonte do `<body>`. O nati voltou à `Source Sans Pro` **só dentro de**
  `.conteudo-angle`, sem tocar no tema. No fecho, o wrapper saiu e a fonte do C3Theme passou a valer em tudo.
- O reboot do Bootstrap dá margem a `label`/`legend`, sublinha `a:hover` e pinta link; o tema MUI perdia a
  especificidade. Os overrides acima neutralizam exatamente esses pontos.
- **Lição para o WhatsAppMcp:** o Tailwind 4 tem preflight próprio e o C3Theme tem `CssBaseline`. Rodar os
  dois resets globais é o mesmo problema multiplicado. Escolha **um** dono do reset; se mantiver Tailwind,
  importe só `theme`/`utilities` (sem preflight) ou neutralize o baseline nos elementos compartilhados.

### 4.3 z-index e overlays

- O **SweetAlert2** ficava atrás do `Drawer` (1200) e do `Dialog` (1300) do MUI: alerta aberto de dentro deles
  não recebia clique. Correção no CSS global, com classe repetida para vencer o CSS injetado em runtime:

```scss
// web/src/styles/nati.scss:23-27
.swal2-container.swal2-container {
  z-index: 2000;
}
```

- O dropdown do Angle no header MUI precisou de `z-index: 1300` (acima do conteúdo). O layout do C3Theme tem
  `Drawer`/`AppBar`; qualquer popover legado precisa ser conferido contra esses números.
- O `AppLayout` faz `window.scrollTo(0,0)` a cada rota; no Chromium novo `scrollTo` devolve `Promise` e o React
  quebra ("destroy is not a function"). Workaround no app:

```ts
// web/src/app/layout/Layout.tsx:21-24
const rolar = window.scrollTo.bind(window) as (...a: unknown[]) => unknown;
window.scrollTo = (...a: unknown[]) => void rolar(...a);
```

### 4.4 Impressão

`@media print` esconde header, AppBar e Drawer; o nati manteve `window.print()`, `#painel-impressao` e
`body.imprimindo-painel`. O `Tabela` do kit local tem `naoImprime`; o `DataTable` do pacote não tem versão
impressa. Impressão não tem teste automatizado no nati — é validação manual.

### 4.5 O fecho: Bootstrap fora do global, CSS legado só no PDV

O PDV e as telas das estações (KDS, Pré-venda, Balcão, Concentrador) **não** entraram no C3Theme; continuam no
tema LoopCheck. Em vez de manter o CSS legado global, ele foi isolado:

```scss
// web/src/styles/nati.scss:1-12 (final)
@import '@fortawesome/fontawesome-free/css/brands.css'; // ... etc
@import 'simple-line-icons/css/simple-line-icons.css';
#app {
  height: 100%;
}
kbd {
  /* Bootstrap estilizava <kbd>; o tema não */
}
```

```scss
// web/src/styles/nati-pdv.scss:1-28 — carregado só por src/pdv/main.tsx
@import '@fontsource/source-sans-pro/300.css';
@import '@fortawesome/fontawesome-free/css/fontawesome.css';
@import 'bootstrap-vue/dist/bootstrap-vue.css';
@import './legado/styles/bootstrap';
@import './legado/styles/app';
@import './legado/form-wizard';
@import './legado/custom';
@import './legado/regras-app';
```

```tsx
// web/src/pdv/main.tsx:5-8
import '../styles/nati-pdv.scss';
import '../styles/app-vue.scss';
import '../styles/componentes.scss';
import '../styles/responsivo.scss';
```

O build do PDV é um entry separado (`web/vite.pdv.config.ts`) e um gate garante que ele não embuta telas da
Retaguarda (`scripts/check-dist-pdv.mjs:13-27`). **Esse é o padrão reutilizável**: tela fora do tema =
entry/CSS próprio, não exceção espalhada no global.

> **O que ficou pendente no nati:** `bootstrap`, `bootstrap-vue`, `@fortawesome/fontawesome-free`,
> `simple-line-icons` e `@fontsource/source-sans-pro` continuam no `web/package.json:24-25,30-31,41` e no
> `nati.scss` (FA/simple-line). A régua não conta `fas fa-*` nem dependência; o `Cabecalho.tsx:56-59` ainda usa
> `fas fa-power-off`. **Para o WhatsAppMcp, inclua um gate de ícones/deps no fecho**, senão o "100%" é só de
> classe Bootstrap.

### 4.6 Testes: jsdom, Emotion, iconsax e módulos ESM do pacote

Os problemas reais e as correções:

| Sintoma                                                        | Causa                                                                                                                    | Correção no nati                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Failed to resolve import`/módulo sem extensão ao rodar Vitest | o `dist` do C3Theme é saída de `tsc` para bundler (imports sem extensão); o Node puro não resolve                        | `server.deps.inline: [/@c3theme\//]` no `vitest.config.ts:16-17`                                     |
| Testes de tela estouram 5 s com a suíte inteira em cobertura   | jsdom + ~100 arquivos em paralelo                                                                                        | `testTimeout: 20_000` (`vitest.config.ts:12-13`); `asyncUtilTimeout: 5_000` (`src/test/setup.ts:13`) |
| `window.scrollTo is not a function`                            | jsdom não implementa; `AppLayout` chama                                                                                  | stub em `src/test/setup.ts:18-19`                                                                    |
| `scrollIntoView is not a function`                             | jsdom não implementa; abas chamam                                                                                        | stub em `src/test/setup.ts:15-16`                                                                    |
| Teste do cadastro demora a primeira renderização               | `C3Cadastro` é `lazy`; o import sob cobertura estoura o tempo                                                            | `beforeAll(() => import('./C3CadastroMotor'), 60_000)` (`C3Cadastro.test.tsx:85-88`)                 |
| Ícones do menu                                                 | Font Awesome embrulhado em componente (`iconeFa`)                                                                        | funciona no pacote porque `icon` é componente; nenhum mock de iconsax necessário                     |
| Emotion                                                        | o **provider do pacote** já cria `CacheProvider` LTR/RTL (`createCache` com `stylis`), então o app não configura Emotion | nenhum setup extra; só as deps `@emotion/*` no `web/package.json:18-20`                              |

O padrão de teste que o nati adotou depois da conversão:

- **Vitest/RTL por papel ARIA e texto**, não por classe. Ex.: breadcrumb é `getByRole('navigation', { name: 'Caminho' })`
  (`C3Cadastro.test.tsx:83`), aviso é `getByRole('alert')` (e2e `apoio.ts:46-49`), campo inválido é
  `aria-invalid`.
- **`select` nativo** (`TextField select` com `slotProps.select.native`) onde o teste lê `<option>` — o
  `Select` do MUI não expõe `<option>` do jeito que o teste antigo esperava (`conversao.md:18-20`).
- **Contratos invisíveis ao typecheck** precisam ser preservados: `id`s (`#lf-*`, `#bx-*`, `#cn-*`…), rótulos
  com/sem dois-pontos, `aria-label`s, `data-testid`s, chaves de `localStorage` (`PLANO-CONVERSAO.md:62-69`).
- **e2e do C3 é por papel/texto**, com helpers `menuLateral`, `caminho`, `novoC3`, `salvarC3`,
  `escolherReferencia`, `linhaC3`, `esperarAviso` (`e2e/testes/apoio.ts`; `docs/e2e.md:35-41`).

### 4.7 Build, bundle e carregamento

- **MUI/Emotion entram no bundle da Retaguarda.** O nati aceitou; `chunkSizeWarningLimit: 1500` no
  `vite.config.ts:13`.
- **O motor é carregado sob demanda.** `C3Cadastro` é `lazy` (`C3Cadastro.tsx:5-7`) porque o `@c3theme/engine`
  puxa o **catálogo inteiro do iconsax** (ícone pelo nome na spec). Resultado medido: chunk do motor 4,52 MB,
  shell 2,34 MB, PDV 0,55 MB. Em Tauri o custo é memória/startup, não download.
- **Build do C3Theme:** os pacotes são instalados por git e têm `prepare: pnpm run build`; o pnpm precisa
  autorizar o build dos dois (`package.json:23-30` → `pnpm.onlyBuiltDependencies: ["@c3theme/engine",
"@c3theme/ui"]`). Sem isso, `dist` não existe.
- **PDV separado:** dois builds (`vite build` + `vite build -c vite.pdv.config.ts`,
  `web/package.json:8`) — o CSS legado não vaza para a Retaguarda e vice-versa; `check-dist-pdv.mjs` fiscaliza.

### 4.8 SSR não se aplica

O nati é Tauri + SPA servida pelo Axum; não há SSR. Portanto não houve extração de Emotion para SSR, nem
`useServerInsertedHTML`, nem streaming. O WhatsAppMcp também é SPA (Tauri + serve em `/app`), então o mesmo
vale — mas o CSS do C3Theme é injetado pelo `CacheProvider` do provider, o que é compatível com SPA.

### 4.9 Lista de armadilhas (para revisar antes de cada lote)

1. **Dois resets globais** (Bootstrap/Tailwind preflight × CssBaseline) — escolher um dono.
2. **Dois dark modes** (`html[data-theme]` × MUI `colorSchemes`) — escolher um dono e sincronizar.
3. **z-index de overlay legado** abaixo de Drawer/Dialog do MUI (SweetAlert 1060 × 1200/1300).
4. **`window.scrollTo`/`scrollIntoView` no jsdom** e o bug de Promise do `AppLayout` no Chromium novo.
5. **Módulos ESM sem extensão** do pacote: Vitest precisa `server.deps.inline`.
6. **`select` do MUI** não substitui `<option>` nativo onde o teste/e2e lê opção.
7. **Régua ≠ pronto**: classe Bootstrap ≠ único legado; `fas fa-*`, CSS importado, dependências e
   `localStorage`/ids/aria não entram na conta.
8. **Arquivo ≤ 300 linhas** (`check-linhas.mjs:6`): MUI é mais verboso; dividir na mesma pasta em vez de
   afrouxar o gate.
9. **Lazy + cobertura**: testes que importam por demanda precisam de `beforeAll(import(...), tempoMaior)`.
10. **Comentários envelhecem:** `tema-c3.ts` e `TemaNati.tsx` ainda falam de "conviver com Bootstrap" depois de
    o Bootstrap sair; `C3CadastroMotor.tsx:16` aponta para `backend/crates/http/c3`, caminho que não existe
    (hoje é `backend/crates/c3/entidades`). Não copie comentário como contrato.
11. **Patch local de pacote terceiro:** o workaround de `scrollTo` fica no app e precisa ser removido quando o
    pacote corrigir; registre em dívida técnica.
12. **e2e antigo quebra em seletores de classe**: o nati precisou atualizar 13 seletores em 7 specs
    (`.alert-danger` → `role="alert"`, `.badge` → `[data-cor]`, `.h3` → texto) (`PLANO-CONVERSAO.md:272-278`).

---

## 5. Estratégia de versionamento e release (dependência privada)

### 5.1 SHA, não tag (na prática)

O ADR fala "pacotes por git com tag" (`ADR 0018:32-33`), mas a implementação usa **commit imutável**:

```json
// web/package.json:16-17
"@c3theme/engine": "github:cecon/C3Theme#2d62f45457dd227bc7d9d3b9740c4f77e783ec8b&path:packages/engine",
"@c3theme/ui":     "github:cecon/C3Theme#2d62f45457dd227bc7d9d3b9740c4f77e783ec8b&path:packages/ui"
```

```toml
# Cargo.toml:81-82
c3-engine = { git = "https://github.com/cecon/C3Theme", rev = "a709e8ba5554616003a98eec9094e3daa3a7fc8a" }
c3-engine-rusqlite = { git = "https://github.com/cecon/C3Theme", rev = "a709e8ba5554616003a98eec9094e3daa3a7fc8a" }
```

Vantagens: reprodutível, sem tag móvel, bump é um PR. Custo: SHA não é legível; PR precisa dizer o que entrou.

### 5.2 O que muda num bump

1. `Cargo.toml` (raiz): **2 revs** (`c3-engine` e `c3-engine-rusqlite` juntos — o comentário do arquivo avisa
   "Mudar o rev = trocar os dois juntos", `Cargo.toml:79-80`).
2. `web/package.json`: **2 refs** (`@c3theme/ui`, `@c3theme/engine`).
3. `Cargo.lock` e `pnpm-lock.yaml`.
4. `cargo update -p c3-engine -p c3-engine-rusqlite` e `pnpm install`; compilar.
5. **Front e backend podem divergir**: no nati, o front foi para `2d62f45` (correção do `SelectField`) e o
   Cargo ficou em `a709e8b` porque entre os dois commits os crates não mudaram
   (`entregas-c3theme.md:161-163`). Registre no PR **qual é o pino de cada lado**.
6. `@c3theme/ui/table` exige `@tanstack/react-table` no app (peer opcional). O nati não usou o subpath, por isso
   não instalou.

### 5.3 Token de leitura e impacto no release

O repositório é privado; o build não compila sem leitura:

- segredo **`C3THEME_TOKEN`**, fine-grained, só `cecon/C3Theme`, permissão **Contents: Read**
  (`docs/release.md:91-93`);
- no CI/release, configurar o git para usar o token:
  `git config --global url."https://x-access-token:${C3THEME_TOKEN}@github.com/cecon/C3Theme".insteadOf "https://github.com/cecon/C3Theme"`
  (`.github/workflows/ci.yml:33`, `.github/workflows/release.yml:89-98`);
- **Cargo via CLI do git**: `CARGO_NET_GIT_FETCH_WITH_CLI: 'true'` no release para o Cargo herdar a credencial
  (`release.yml:76-77`);
- sem o token, o release para no `pnpm install` (ou no fetch do Cargo). **Isso é um bloqueio de release, não de
  dev** — a máquina de cada dev também precisa de credencial no git.
- licença proprietária (`UNLICENSED`): não é dependência pública; não há like de npm registry.

### 5.4 Rust: o par de crates e o SQLite

- O `c3-engine` é **sem driver no núcleo** (trait `Store`); a feature `sqlx` é opcional
  (`crates/c3-engine/Cargo.toml` no C3Theme). O nati não habilita sqlx: `cargo tree` não tem sqlx.
- O `c3-engine-rusqlite` é **workspace próprio** e fixa `rusqlite = "0.40"` (libsqlite3-sys 0.38) porque o
  NATI usa 0.40. Mudar a versão do sistema = mudar o adaptador; a doc do crate diz isso explicitamente.
- O motor exige, na conexão: `PRAGMA foreign_keys`, `REGEXP` (sintaxe do crate `regex`), dialeto SQLite,
  `INTEGER`/`TEXT` (REAL é entregue como texto, BLOB é erro) — `crates/c3-engine/src/store.rs` do pin.
- **No WhatsAppMcp:** `wamcp-server` tem `rusqlite = "0.39"` / `libsqlite3-sys 0.37`. O `c3-engine-rusqlite`
  do pin não compila junto. Duas saídas:
  1. **Subir o rusqlite do WhatsAppMcp para 0.40** e usar o adaptador (menos código; testar as ~chamadas
     existentes e conferir que só existe um `libsqlite3-sys` no lock);
  2. **Implementar `c3_engine::Store` sobre a conexão/pool existente** (o trait tem 2 métodos; `Conn` tem
     `query`/`execute`; ~100 linhas + `prepare` de PRAGMAs/REGEXP). Evita o bump e permite injetar
     escopo de conta por conexão, se necessário.
- **Questão de multi-tenant:** o motor só entende escopo de empresa/filial (`organization`), não `account_id`
  arbitrário. No WhatsAppMcp, quase toda tabela tem `account_id`; para entidades CRUD será preciso
  `rowAccess`/views por conta ou manter essas telas fora do motor. O nati não usou `access`/`rowAccess` —
  então **não há receita pronta** para isso neste caso.

### 5.5 OpenAPI e contrato

O `c3-engine` é um roteador de fora do workspace; o nati o adiciona à lista de `scripts/openapi-externos.mjs`
e mantém os textos do contrato em `openapi.base.json` (tag "Cadastros (motor C3)"), roda `pnpm openapi` e o
`--check` no `pnpm check`; `server/tests/openapi_paridade.rs` chama cada rota (ADR 0007, `CLAUDE.md:118-124`).
No WhatsAppMcp, o OpenAPI/paridade pode não existir hoje; se for adotado o motor, inclua o gate equivalente ou
aceite o contrato do C3 como fonte externa.

### 5.6 Procedimento de bump (copiar como checklist de PR)

- [ ] C3Theme: identificar o commit (PR mergeado) e o que mudou (crates? pacotes? ambos?).
- [ ] `Cargo.toml`: trocar os 2 revs juntos; `cargo update -p c3-engine -p c3-engine-rusqlite`; compilar;
      `cargo tree` sem sqlx e com **um** `libsqlite3-sys`.
- [ ] `web/package.json`: trocar os 2 refs; decidir se o subpath `@c3theme/ui/table` entra (aí
      `@tanstack/react-table`).
- [ ] `pnpm install` (lock) e CI local.
- [ ] Implementar hooks novos que o pin adicionar (o nati fez `permitted`, `lookup`, `run_list_action`).
- [ ] Atualizar OpenAPI/contrato, se as rotas mudaram.
- [ ] Testes do motor no crate (`backend/crates/c3/tests/*`) e um teste de tela que use o comportamento novo.
- [ ] PR diz: pino do front, pino do Cargo (podem diferir), o que foi adotado e o que ficou para depois.

---

## 6. Escopo: o que ficou fora do C3Theme e o análogo no WhatsAppMcp

### 6.1 No nati

Ficaram fora, por decisão escrita (ADR 0018:5; `progresso.md:4-5`; `c3-progresso.mjs:65-66`):

- **PDV, KDS, Pré-venda, Balcão, Concentrador** — tema **LoopCheck**, próprio; não entram na régua
  (`FORA = ['features/pdv','features/kds','features/prevenda','features/balcao','features/concentrador','pdv','test']`).
  O PDV tem CSS e build separados (`nati-pdv.scss`, `vite.pdv.config.ts`, `check-dist-pdv.mjs`).
- **6 CRUDs genéricos** que continuaram MUI, mas fora do motor: `/shifts` (lista JSON), `/integracoes-delivery`
  (JSON existe, falta escritor), `/desenfile` (token cifrado), `/microterminais-prevenda` (JSON aninhado),
  `/chaves` (licença/importação), `/delivery/aplicativos` (painel/teste de credencial) —
  `PLANO-CONVERSAO.md:328-333`.
- **Telas de registro único/operação** e widgets que o v0 não modela: `nati/cep` saiu (virou lookup), mas
  `nati/aparelho-da-maquina`, `nati/certificado-a1`, `nati/permissoes-do-perfil`, `nati/anp-do-combustivel` etc.
  continuam (componentes custom do JSON).

**Por quê:** tema próprio da estação (identidade e densidade de toque), JSON/aninhado fora do v0, e custo de
reescrever um CRUD genérico que já estava em MUI sem ganho de contrato.

### 6.2 Análogo para o WhatsAppMcp (proposta de corte)

| Superfície                                                                                                                    | Entra no C3Theme?                    | Por quê / como                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell (sidebar, header, busca, notificações, perfil)                                                                          | **Sim, primeiro**                    | `AppLayout`/`AuthLayout` são o maior ganho e o menor risco; mas exige router/`react-router`                                                                  |
| Login/MFA                                                                                                                     | **Sim**                              | `AuthLayout`; MFA/otp tem `OtpInput` no pacote                                                                                                               |
| Configurações administrativas (contas, agentes, times, inboxes, labels, atributos, macros, SLA, automações, webhooks, papéis) | **Sim, por último ou em paralelo**   | CRUDs simples/tabulares são o "lote 1" natural do motor; precisam de JSON/writer e escopo por conta                                                          |
| Contatos / book / notas / importação                                                                                          | **Sim**                              | CRUD com tabela; anexos e merge são ações de lista/registro                                                                                                  |
| Conversas/chat (lista + thread + composer + anexos + áudio + emoji + menções + recibos)                                       | **Provavelmente não** (ou só chrome) | densidade, virtualização, formatação WhatsApp, upload/áudio; o motor não modela mensagem/thread; o C3Theme não tem componente de chat no pacote (ver doc 01) |
| Relatórios com gráficos                                                                                                       | **Depende**                          | se já são telas próprias, MUI é ok; não force motor                                                                                                          |
| Tela de agente/chat interno de IA                                                                                             | **Depende**                          | é chat; mesmo raciocínio                                                                                                                                     |
| Telas de conexão WhatsApp/QR/status em tempo real                                                                             | **Não** (no primeiro momento)        | estado efêmero/streaming; fora do padrão CRUD                                                                                                                |
| Menu/products/custom roles etc.                                                                                               | **Sim, se CRUD**                     | mesma regra: JSON + writer                                                                                                                                   |

**Critério:** entra no motor quem é **CRUD puro de uma tabela** com `id INTEGER PRIMARY KEY`; fica fora quem é
operação/streaming/chat/JSON aninhado. Quem é "tela MUI escrita à mão" pode entrar no shell mesmo sem motor.

---

## 7. Checklist reaproveitável para o WhatsAppMcp

> Ordem recomendada: **decisões (0) → spike de convivência (1) → shell (2) → motor (3) → telas em lotes (4) →
> fecho/gates (5) → release (6)**. Não comece por telas.

### Fase 0 — Decisões e escopo (1–2 dias, sem código de tela)

- [ ] **ADR** com: layout = `AppLayout`, CRUD = motor quando couber, escrita delegada, breadcrumb padrão,
      **o que fica fora** (chat/streaming/QR, e por quê).
- [ ] **Dono do reset**: Tailwind preflight ou `CssBaseline`? Se Tailwind, importar `tailwindcss/theme` +
      `utilities` sem preflight, ou aceitar os dois e listar os overrides.
- [ ] **Dono do dark mode**: `html[data-theme]` (Chatwoot) ou MUI `colorSchemes`? Sincronizar em um adapter
      (`useColorScheme` → `dataset.theme`) e **não** expor dois botões.
- [ ] **Router**: adotar `react-router` 8 (deep links `/app/...`) ou manter o roteador de estado e **não**
      adotar `AppLayout`/`Breadcrumbs`/engine (o pacote exige router). Decidir antes do shell.
- [ ] **Escopo por conta:** entidades com `account_id` entram no motor com `rowAccess`/views por conta ou ficam
      fora? O motor só tem `organization` (empresa/filial), não multi-tenant genérico.
- [ ] **Kit**: telas manuais usam campos do `@c3theme/ui` ou um kit local sobre MUI? Escolher **um**.

### Fase 1 — Spike de convivência (1–2 dias, descartável)

- [ ] Branch com `@c3theme/ui` + MUI/emotion instalados e **uma** tela C3 (`AppLayout` + `Panel` + um
      `Button`) montada ao lado do Tailwind atual.
- [ ] Medir: preflight × CssBaseline (margens, headings, botões, `box-sizing`, `img`), fonte (Inter already
      importada × `DEFAULT_FONT` Inter), dark mode (dois toggles), z-index (modais/overlays atuais × Drawer),
      `@source`/Tailwind scan do C3 (classes do pacote não são Tailwind — isolar escopo).
- [ ] Medir bundle: chunk do C3 (MUI + emotion + iconsax + engine) e impacto no start do Tauri.
- [ ] **Saída:** um relatório de 1 página com os conflitos e a decisão (um reset, um dark, escopo CSS).

### Fase 2 — Fundação front (2–4 dias)

- [ ] `C3ThemeProvider` (`TemaNati` equivalente) com marca/logo, `brand` que combine com o WhatsApp
      (há `green`, `teal`, `cyan`), `locale: 'pt-BR'`, `storageKey` próprio, `themeOverrides` só se
      necessário.
- [ ] Dark mode sincronizado com `src/agent/theme/theme.ts` (ou substituir o mecanismo).
- [ ] Shell: `AppLayout` com menu vindo de `route.ts`/permissões (hoje `Workspace.tsx:31-39`); itens com
      `children` para Settings; ícones: usar `lucide-react` como componente no `NavItem.icon` (não precisa
      adotar iconsax nas telas).
- [ ] Header: busca (`CommandSearch`) ou busca própria; notificações (`NotificationsButton`); menu do usuário;
      botão de sair.
- [ ] `AuthLayout` no login/MFA, mantendo a lógica de CSRF/refresh e os textos atuais.
- [ ] Breadcrumb: decidir se o caminho vem do menu (padrão do pacote) ou de um `Caminho` próprio; **nenhuma
      tela monta caminho próprio** (regra do nati).
- [ ] Rotas: `/{entity}/*` para cadastros; manter URLs antigas com redirect (o app é servido em `/app/`, então
      cuidado com `base: './'` no Vite e fallback do servidor).

### Fase 3 — Fundação do motor (3–5 dias, se for usar CRUDs)

- [ ] Decidir a convivência de `rusqlite` (ver §5.4) e provar com um `cargo tree` sem dois SQLites.
- [ ] Criar crate `wamcp-c3`: `Servicos`, `motor()`, `rotas()`, `Store`/adaptador, middleware de sessão
      (cookie + CSRF; 401 no formato C3), `Hooks` mínimos (`capabilities`, `delegates_writes`, `write`,
      `permitted` se houver `access`).
- [ ] Uma `Escritor` por entidade, chamando o caso de uso existente (não a infra); erro de domínio mapeado
      para 422/409/403/404/503 (`erro.rs` do nati é um bom molde).
- [ ] Piloto: **uma** entidade simples (ex.: times, labels, inboxes ou macros) com JSON, writer, teste de
      `/_meta`, lista e CRUD.
- [ ] Gate de boot: JSON que não bate com o banco derruba o serviço no start (não quebra em produção).
- [ ] Views `TEMP`/`CREATE VIEW` para colunas calculadas e 1:1 achatado; `id INTEGER PRIMARY KEY` nas tabelas
      que entrarem; JSON aninhado fica fora.

### Fase 4 — Telas em lotes (o grosso do trabalho)

- [ ] **Script de régua** próprio: varre `src/agent/**/*.tsx`, conta classes utilitárias/legado, grava
      `docs/c3theme/progresso.md`; `check` no `npm run check` recusa arquivo desatualizado; testes do script
      (o do nati está em `scripts/c3-progresso.test.mjs:21-62`).
- [ ] **Métrica extra além da régua:** `grep` de `lucide` (ícone legado), de imports de CSS legado e de deps
      removíveis. A régua do nati não contou `fas` e por isso FA ficou.
- [ ] Lotes por pasta, um PR/branch por lote, escopo de escrita fechado; regra "não mexe em `ui/`/`styles/`".
- [ ] Contratos invisíveis: ids, `aria-label`, textos, `data-testid`, chaves de `localStorage`, `<option>` em
      `select` nativo. Atualizar asserções no mesmo commit (classe → ARIA/texto).
- [ ] Arquivo ≤ 300 linhas (ou o limite do repo); dividir na pasta.
- [ ] Comportamento/textos/permissões iguais; sem regra de negócio nova.
- [ ] e2e por papel/texto; evitar seletores de classe.

### Fase 5 — Fecho e gates (só quando a régua zerar)

- [ ] Remover o legado dos estilos globais; se houver app/tela fora do tema (chat? PDV?), separar **CSS e
      entry próprios** (molde `nati-pdv.scss` + `vite.pdv.config.ts` + `check-dist-pdv.mjs`).
- [ ] Remover dependências e ícones não usados **com gate** (FA no nati ficou; não repita).
- [ ] Build de todos os entries + verificação de que o entry "fora do tema" não embute telas do tema.
- [ ] Bundle: chunks e lazy para o motor (`@c3theme/engine` importa o catálogo iconsax inteiro).
- [ ] Rodar `check` completo; e2e; varredura de console/404.

### Fase 6 — Versionamento e release

- [ ] Pins por SHA nos dois lados; 2 refs no `package.json`, 2 revs no `Cargo.toml` (se usar Rust), locks.
- [ ] Token de leitura do C3Theme no CI/release (e na máquina de dev); `CARGO_NET_GIT_FETCH_WITH_CLI` se
      Cargo for usado.
- [ ] PR de bump separado do PR de tela; registrar pino de front e de Cargo (podem diferir).
- [ ] Procedimento de bump (§5.6) no CONTRIBUTING/release do WhatsAppMcp.

---

## 8. Erros do nati que o WhatsAppMcp não precisa repetir

1. **Deixar o Font Awesome "para depois".** A régua fechou em 338/338 e o `nati.scss` ainda importa FA; o
   `Cabecalho.tsx` ainda usa `fas fa-power-off`; as deps continuam no `package.json`. Se a régua não conta
   ícone, crie um gate separado.
2. **Não aplicar `access`/`filter` nos JSONs** depois de implementar os hooks. O mecanismo existe e não protege
   campo nenhum. Se o WhatsAppMcp precisa de permissão por campo, trate como entrega com teste.
3. **Comentário velho como documentação.** `tema-c3.ts` fala de "conviver com Bootstrap" e o layout ainda tem
   overrides que só faziam sentido antes do fecho; `C3CadastroMotor.tsx:16` cita um caminho inexistente.
4. **Deixar a dependência de Rust acoplada sem plano.** O adaptador `c3-engine-rusqlite` fixa rusqlite 0.40;
   qualquer app em 0.39 (WhatsAppMcp) precisa decidir antes: bump ou `Store` próprio.
5. **Conferir só o `typecheck`.** Os contratos de teste/e2e (`#id`, `aria-label`, dois-pontos, `data-testid`)
   não aparecem no typecheck; o plano do nati lista isso como risco 1 (`PLANO-CONVERSAO.md:345-348`).
6. **Achar que "tela convertida" = "tela testada".** A conversão muda DOM/classe; asserções antigas passam a
   testar nada se não forem reescritas para ARIA/texto.
7. **Ignorar o custo de dois resets/dark modes.** O nati contornou forçando `light` e neutralizando o Bootstrap;
   no WhatsAppMcp já existe `data-theme`, então o contorno tem de ser desenhado, não improvisado.

---

## 9. Índice de referências (para reabrir o caso)

| Tema                       | Caminho                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| Decisão e consequências    | `D:\projetos\nati-next\docs\adr\0018-retaguarda-c3theme.md`                   |
| Spec e critérios de aceite | `D:\projetos\nati-next\specs\066-retaguarda-c3theme\spec.md`                  |
| Guia de conversão de tela  | `D:\projetos\nati-next\specs\066-retaguarda-c3theme\conversao.md`             |
| Inventário de cadastros    | `D:\projetos\nati-next\specs\066-retaguarda-c3theme\inventario.md`            |
| Pedido → entrega → impacto | `D:\projetos\nati-next\specs\066-retaguarda-c3theme\entregas-c3theme.md`      |
| Placar por pasta           | `D:\projetos\nati-next\specs\066-retaguarda-c3theme\progresso.md`             |
| Lote 3 (mestre-detalhe)    | `D:\projetos\nati-next\specs\066-retaguarda-c3theme\lote3\README.md`          |
| Plano de 60 lotes / riscos | `D:\projetos\nati-next\entregas\plano-c3\PLANO-CONVERSAO.md`                  |
| Status dos pedidos         | `D:\projetos\nati-next\entregas\plano-c3\PEDIDOS-C3THEME.md`                  |
| Régua + testes da régua    | `D:\projetos\nati-next\scripts\c3-progresso.mjs`, `c3-progresso.test.mjs`     |
| Gate de linhas             | `D:\projetos\nati-next\scripts\check-linhas.mjs`                              |
| Gate de API única          | `D:\projetos\nati-next\scripts\check-inventario-api.mjs`                      |
| Gate do build do PDV       | `D:\projetos\nati-next\scripts\check-dist-pdv.mjs`                            |
| CI local                   | `D:\projetos\nati-next\scripts\ci-local.mjs`                                  |
| Pin front                  | `D:\projetos\nati-next\web\package.json`                                      |
| Pin Rust                   | `D:\projetos\nati-next\Cargo.toml`                                            |
| Release/token              | `D:\projetos\nati-next\docs\release.md`, `.github/workflows/{ci,release}.yml` |
| Código do motor            | `D:\projetos\nati-next\backend\crates\c3\src\*.rs`                            |
| JSON das entidades         | `D:\projetos\nati-next\backend\crates\c3\entidades\*.json`                    |
| e2e C3                     | `D:\projetos\nati-next\e2e\testes\apoio.ts`, `docs\e2e.md`                    |
| Pacote instalado no pino   | `D:\projetos\nati-next\web\node_modules\@c3theme\{ui,engine}\dist\*.d.ts`     |
| Spec v0                    | `D:\projetos\C3Theme\spec\v0\{entity,app}.schema.json`, `openapi.yaml`        |

### Lacunas desta extração (o que não achei ou não deu para provar)

- O ADR fala em **tag**; o checkout local do C3Theme **não tem tags** (`git tag` vazio) e a implementação usa SHA.
  Trate "tag" como intenção, não como fato (e confira o remoto antes de prometer tag no plano do WhatsAppMcp).
- Não há registro de tempo de build/CI por etapa; os números de bundle são de um build local de 30/10.
- O `entregas-c3theme.md` cita "337/337" e o `progresso.md` gerado diz "338/338" — a diferença é a contagem de
  arquivos `.tsx` vs. telas (o gerador mudou). Para efeito de gate, vale o arquivo gerado.
- `PageHeader` e `@c3theme/ui/table` no README atual do C3Theme não batem 1:1 com o pino do nati; conferir
  sempre o `dist/index.d.ts` **instalado**, não o README.
