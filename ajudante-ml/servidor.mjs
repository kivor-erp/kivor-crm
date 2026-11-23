// Ajudante local do KIVOR para o Mercado Livre.
//
// Por quê: o Mercado Livre exige o client_secret na troca do código por token, e o refresh token é de uso
// único (a cada renovação vem um novo). Um app só de navegador não guarda isso com segurança. Este
// programa roda no SEU computador (127.0.0.1), guarda as credenciais num arquivo fora do repositório
// e repassa as chamadas do KIVOR para api.mercadolibre.com já com o token certo.
//
// Sem dependências: só o Node (18 ou mais novo). Inicie com `iniciar-ajudante-ml.cmd`.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const PORTA_PADRAO = 5198;
const AUTH_BR = 'https://auth.mercadolivre.com.br/authorization';
const API = 'https://api.mercadolibre.com';
/** Só estes recursos podem ser chamados pelo KIVOR (o ajudante não é um proxy aberto). */
const PREFIXOS = ['users/', 'items', 'orders/', 'shipments/', 'questions/', 'answers', 'messages/', 'pictures/', 'sites/', 'categories/', 'currencies/'];
const MARGEM_MS = 5 * 60_000; // renova o token 5 min antes de vencer

const b64url = (b) => Buffer.from(b).toString('base64url');

export function arquivoPadrao() {
  return join(process.env.KIVOR_ML_ARQUIVO || join(homedir(), '.kivor', 'ml.json'));
}

/**
 * @param {{ arquivo?: string, api?: string, auth?: string, relogio?: () => number }} [opcoes]
 * `api` e `auth` só mudam nos testes.
 */
export function criarAjudante(opcoes = {}) {
  const arquivo = opcoes.arquivo ?? arquivoPadrao();
  const api = opcoes.api ?? API;
  const urlAuth = opcoes.auth ?? AUTH_BR;
  const agora = opcoes.relogio ?? Date.now;

  /** @type {{ appId?: string, secret?: string, redirectUri?: string, pkce?: boolean, origens?: string[], tokens?: any }} */
  let cfg = {};
  let carregado = false;
  const pendentes = new Map(); // state -> { verifier, criado }
  let renovando = null; // evita duas renovações ao mesmo tempo (o refresh token só vale uma vez)

  async function carregar() {
    if (carregado) return;
    try { cfg = JSON.parse(await readFile(arquivo, 'utf8')); } catch { cfg = {}; }
    carregado = true;
  }
  async function gravar() {
    await mkdir(dirname(arquivo), { recursive: true });
    const tmp = `${arquivo}.tmp`;
    await writeFile(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    await rename(tmp, arquivo); // nunca deixa o arquivo pela metade: perder o refresh token obriga a autorizar de novo
  }
  const redirectUri = (porta) => cfg.redirectUri || `http://localhost:${porta}/ml/retorno`;

  async function pedirToken(corpo) {
    const r = await fetch(`${api}/oauth/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(corpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error_description || j.message || j.error || `HTTP ${r.status}`), { codigo: j.error, status: r.status });
    return j;
  }
  function guardarTokens(j) {
    cfg.tokens = {
      access: j.access_token, refresh: j.refresh_token, userId: j.user_id,
      expiraEm: agora() + (j.expires_in ?? 21600) * 1000,
    };
  }

  async function tokenValido(forcar = false) {
    await carregar();
    const t = cfg.tokens;
    if (!t) throw Object.assign(new Error('Mercado Livre não conectado.'), { status: 401, codigo: 'nao_conectado' });
    if (!forcar && t.expiraEm - agora() > MARGEM_MS) return t.access;
    renovando ??= (async () => {
      try {
        const j = await pedirToken({ grant_type: 'refresh_token', client_id: cfg.appId, client_secret: cfg.secret, refresh_token: t.refresh });
        guardarTokens(j);
        await gravar();
      } finally { renovando = null; }
    })();
    await renovando;
    return cfg.tokens.access;
  }

  function permitido(origem, req) {
    if (!origem) return false;
    try {
      const h = new URL(origem).hostname;
      if (h === 'localhost' || h === '127.0.0.1') return true;
    } catch { return false; }
    return (cfg.origens ?? []).includes(origem);
  }

  function responder(res, status, corpo, cab = {}) {
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    res.writeHead(status, { 'content-type': typeof corpo === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', ...cab });
    res.end(texto);
  }
  const html = (t) => `<!doctype html><meta charset="utf-8"><title>KIVOR · Mercado Livre</title><body style="font:16px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">${t}</body>`;

  async function lerBytes(req, limite = 1_000_000) {
    const partes = [];
    let tam = 0;
    for await (const p of req) { tam += p.length; if (tam > limite) throw new Error('corpo grande demais'); partes.push(p); }
    return Buffer.concat(partes);
  }
  const ler = async (req) => (await lerBytes(req)).toString('utf8');

  async function tratar(req, res, porta) {
    await carregar();
    const url = new URL(req.url, `http://localhost:${porta}`);
    const origem = req.headers.origin;
    const cors = permitido(origem, req)
      ? { 'access-control-allow-origin': origem, 'access-control-allow-headers': 'content-type, x-kivor', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-private-network': 'true', vary: 'origin' }
      : {};
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

    // A volta do Mercado Livre vem do navegador, sem origem nem cabeçalho do KIVOR.
    if (url.pathname === '/ml/retorno') {
      const state = url.searchParams.get('state') ?? '';
      const code = url.searchParams.get('code');
      const p = pendentes.get(state);
      pendentes.delete(state);
      if (!code || !p || agora() - p.criado > 15 * 60_000) {
        return responder(res, 400, html('<h2>Não foi possível conectar</h2><p>O retorno do Mercado Livre não bate com um pedido feito pelo KIVOR (ou demorou mais de 15 minutos). Volte ao KIVOR e clique em Conectar de novo.</p>'));
      }
      try {
        const corpo = { grant_type: 'authorization_code', client_id: cfg.appId, client_secret: cfg.secret, code, redirect_uri: redirectUri(porta) };
        if (p.verifier) corpo.code_verifier = p.verifier;
        guardarTokens(await pedirToken(corpo));
        await gravar();
        return responder(res, 200, html('<h2>✅ Mercado Livre conectado</h2><p>Pode fechar esta aba e voltar ao KIVOR.</p>'));
      } catch (e) {
        return responder(res, 502, html(`<h2>O Mercado Livre recusou a conexão</h2><p>${String(e.message).replace(/</g, '&lt;')}</p><p>Confira o ID, a chave secreta e o endereço de retorno do app. A conta que autoriza precisa ser a principal (administradora), não um colaborador.</p>`));
      }
    }

    // Tudo o mais só aceita chamadas do KIVOR: origem permitida + cabeçalho próprio (que força a checagem prévia do navegador).
    if (!cors['access-control-allow-origin'] || req.headers['x-kivor'] !== '1') {
      return responder(res, 403, { erro: 'origem_nao_permitida' });
    }
    const json = (s, c) => responder(res, s, c, cors);

    if (url.pathname === '/status') {
      const t = cfg.tokens;
      return json(200, {
        configurado: !!(cfg.appId && cfg.secret), conectado: !!t, userId: t?.userId ?? null,
        redirectUri: redirectUri(porta), pkce: !!cfg.pkce,
      });
    }
    if (url.pathname === '/config' && req.method === 'POST') {
      const c = JSON.parse((await ler(req)) || '{}');
      if (c.appId !== undefined) cfg.appId = String(c.appId).trim();
      if (c.secret) cfg.secret = String(c.secret).trim(); // vazio = mantém a chave que já está salva
      if (c.pkce !== undefined) cfg.pkce = !!c.pkce;
      if (c.redirectUri !== undefined) cfg.redirectUri = String(c.redirectUri).trim() || undefined;
      if (Array.isArray(c.origens)) cfg.origens = c.origens.map(String);
      await gravar();
      return json(200, { ok: true });
    }
    if (url.pathname === '/auth/url') {
      if (!cfg.appId || !cfg.secret) return json(400, { erro: 'sem_config', mensagem: 'Informe o ID e a chave secreta do app primeiro.' });
      const state = b64url(randomBytes(18));
      const verifier = cfg.pkce ? b64url(randomBytes(40)) : null;
      pendentes.set(state, { verifier, criado: agora() });
      const q = new URLSearchParams({ response_type: 'code', client_id: cfg.appId, redirect_uri: redirectUri(porta), state });
      if (verifier) { q.set('code_challenge', b64url(createHash('sha256').update(verifier).digest())); q.set('code_challenge_method', 'S256'); }
      return json(200, { url: `${urlAuth}?${q}` });
    }
    if (url.pathname === '/desconectar' && req.method === 'POST') {
      delete cfg.tokens;
      await gravar();
      return json(200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      const caminho = url.pathname.slice(5);
      if (!PREFIXOS.some((p) => caminho.startsWith(p)) || caminho.includes('..')) return json(403, { erro: 'recurso_nao_permitido' });
      // Envio de foto: o corpo é binário (multipart) e segue igual, com o content-type original (inclui o boundary).
      const upload = caminho.startsWith('pictures/');
      const corpo = req.method === 'GET' || req.method === 'DELETE' ? undefined : await lerBytes(req, upload ? 12_000_000 : 1_000_000);
      const tipoCorpo = upload ? req.headers['content-type'] : 'application/json';
      const chamar = async (tk) => fetch(`${api}/${caminho}${url.search}`, {
        method: req.method,
        headers: { authorization: `Bearer ${tk}`, accept: 'application/json', ...(corpo?.length && tipoCorpo ? { 'content-type': tipoCorpo } : {}) },
        body: corpo?.length ? corpo : undefined,
      });
      try {
        let r = await chamar(await tokenValido());
        if (r.status === 401) r = await chamar(await tokenValido(true)); // token invalidado antes do prazo: renova uma vez
        const texto = await r.text();
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json', ...cors });
        return res.end(texto);
      } catch (e) {
        if (e.codigo === 'nao_conectado') return json(401, { erro: 'nao_conectado', mensagem: e.message });
        if (e.codigo === 'invalid_grant') { delete cfg.tokens; await gravar(); return json(401, { erro: 'nao_conectado', mensagem: 'A autorização expirou ou foi revogada. Conecte de novo.' }); }
        return json(502, { erro: 'falha_ml', mensagem: String(e.message) });
      }
    }
    return json(404, { erro: 'nao_encontrado' });
  }

  const servidor = createServer((req, res) => {
    tratar(req, res, servidor.address()?.port ?? PORTA_PADRAO).catch((e) => {
      if (!res.headersSent) responder(res, 500, { erro: 'interno', mensagem: String(e.message) });
      else res.end();
    });
  });
  return {
    servidor,
    iniciar: (porta = PORTA_PADRAO) => new Promise((ok, falha) => {
      servidor.once('error', falha);
      servidor.listen(porta, '127.0.0.1', () => ok(servidor.address().port));
    }),
    parar: () => new Promise((ok) => servidor.close(() => ok())),
  };
}

// Executado direto (`node servidor.mjs`): sobe na porta padrão.
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const porta = Number(process.env.KIVOR_ML_PORTA) || PORTA_PADRAO;
  criarAjudante().iniciar(porta).then(
    (p) => console.log(`Ajudante do Mercado Livre ouvindo em http://localhost:${p}\nDeixe esta janela aberta enquanto usa o KIVOR. Credenciais em: ${arquivoPadrao()}`),
    (e) => { console.error(e.code === 'EADDRINUSE' ? `A porta ${porta} já está em uso (o ajudante talvez já esteja aberto).` : e); process.exit(1); },
  );
}
