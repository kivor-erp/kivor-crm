// Service worker: deixa o app abrir sem internet. Só arquivos do app (HTML/JS/CSS/ícones);
// os dados ficam no IndexedDB e no OneDrive, nunca aqui. Chamadas ao Graph/login não passam por cache.
const VERSAO = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `kivor-crm-${VERSAO}`;

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const lista = ['./', './manifest.webmanifest', './icone.svg', './icone-192.png', './icone-512.png'];
    try {
      // todos os arquivos do build, inclusive os carregados sob demanda (importação/exportação)
      const m = await (await fetch('./asset-manifest.json', { cache: 'no-store' })).json();
      for (const e of Object.values(m)) lista.push(`./${e.file}`, ...(e.css || []).map((f) => `./${f}`));
    } catch { /* em dev não existe */ }
    await c.addAll([...new Set(lista)]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // página: tenta a rede (versão nova), cai no cache se estiver offline
    ev.respondWith(fetch(req).then((r) => {
      if (r.ok) caches.open(CACHE).then((c) => c.put('./', r.clone()));
      return r;
    }).catch(() => caches.match('./')));
    return;
  }
  // arquivos com hash no nome: cache primeiro
  ev.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
    return r;
  })));
});
