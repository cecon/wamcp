# WAMCP num servidor Linux: o mesmo backend do app de desktop, sem a janela, a bandeja e o túnel.
# docker compose up -d   (veja "Servidor Linux e Docker" no README)

FROM node:24-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

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
