# WAMCP num servidor Linux: o mesmo backend do app de desktop, sem a janela, a bandeja e o túnel.
# docker compose up -d   (veja "Servidor Linux e Docker" no README)

FROM node:24-bookworm-slim AS web
# O tema (C3Theme) vem de um repositório privado: passe um token com leitura dele como segredo,
# `docker compose build` com C3THEME_TOKEN no ambiente (o token não fica na imagem).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=secret,id=c3theme_token,required=true \
    token="$(cat /run/secrets/c3theme_token)" \
 && git config --global url."https://x-access-token:${token}@github.com/".insteadOf "https://github.com/" \
 && git config --global --add url."https://x-access-token:${token}@github.com/".insteadOf "ssh://git@github.com/" \
 && sha=$(node -p "require('./package.json').dependencies['@c3theme/ui'].split('#')[1].split('&')[0]") \
 && git clone --quiet https://github.com/cecon/C3Theme.git /c3theme && git -C /c3theme checkout --quiet "$sha" \
 && (cd /c3theme && pnpm install --frozen-lockfile && pnpm --filter @c3theme/ui --filter @c3theme/chat build) \
 && pnpm install --frozen-lockfile --ignore-scripts \
 && for pkg in ui chat; do rm -rf "node_modules/@c3theme/$pkg/dist"; cp -R "/c3theme/packages/$pkg/dist" "node_modules/@c3theme/$pkg/dist"; done \
 && rm -rf /c3theme && rm -f /root/.gitconfig
COPY . .
RUN pnpm run build

FROM rust:1-bookworm AS server
WORKDIR /src
COPY src-tauri ./src-tauri
RUN cargo build --manifest-path src-tauri/Cargo.toml -p wamcp-server --release --locked \
 && cp src-tauri/target/release/wamcp-server /usr/local/bin/wamcp-server

FROM node:24-bookworm-slim
# Os runtimes dos agentes de IA rodam como processos neste contêiner. Escolha quais instalar
# (vazio: nenhum) e entre na conta de cada um com `docker compose exec wamcp <cli>`.
ARG AGENT_CLIS="@anthropic-ai/claude-code opencode-ai"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && if [ -n "$AGENT_CLIS" ]; then npm install -g --no-audit --no-fund $AGENT_CLIS; fi
COPY --from=server /usr/local/bin/wamcp-server /usr/local/bin/wamcp-server
COPY --from=web /src/dist /opt/wamcp/web
ENV WAMCP_DATA_DIR=/data \
    WAMCP_WEB_DIR=/opt/wamcp/web \
    WAMCP_PORT=17382 \
    HOME=/data/home
VOLUME /data
EXPOSE 17382
CMD ["wamcp-server"]
