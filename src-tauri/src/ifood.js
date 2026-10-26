// Runs inside the iFood store page the app opens to import a menu (see ifood.rs). It reads the
// store's menu from the site's own API, as the page itself does: the catalog, then the details of
// the items that have complements. Human-verification pages are only reported; the person solves
// them in this window and the script starts again on the reloaded page.
(() => {
  if (window.__wamcpImport || window.top !== window) return;
  window.__wamcpImport = true;
  if (!['www.ifood.com.br', 'ifood.com.br'].includes(location.hostname)) return;
  const report = (kind, payload = null) =>
    window.__TAURI_INTERNALS__?.invoke('ifood_report', { kind, payload }).catch(() => {});
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const challenge = () =>
    /um momento|just a moment|executando verifica|verificando|attention required|access denied|confirme que|are you a human/i.test(
      document.title,
    ) || !!document.querySelector('iframe[src*="challenges.cloudflare.com"], #px-captcha, #challenge-form');
  const read = async (path) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(path, {
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        if (response.ok) return await response.json();
      } catch {
        // network hiccup: tried again below
      }
      await sleep(1500 * attempt);
    }
    return null;
  };
  const run = async () => {
    let waiting = false;
    while (document.readyState === 'loading' || challenge()) {
      if (challenge() && !waiting) report('challenge');
      waiting = waiting || challenge();
      await sleep(1000);
    }
    report('loading');
    const store = location.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (!store) return report('failed', 'no_store');
    const base = `/site-api/v1/merchants/restaurant/${store[0]}`;
    const catalog = await read(`${base}/catalog`);
    const menu = catalog?.data?.menu;
    if (!Array.isArray(menu)) return report('failed', 'no_menu');
    report('payload', catalog);
    const items = menu.flatMap((category) => category.itens ?? []).filter((item) => item.needChoices);
    for (const id of new Set(items.map((item) => item.id))) {
      const detail = await read(`${base}/items/${encodeURIComponent(id)}`);
      if (detail) report('payload', detail);
      await sleep(300);
    }
    report('done');
  };
  run();
})();
