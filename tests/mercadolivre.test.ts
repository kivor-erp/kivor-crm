import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { criarAjudante } from '../ajudante-ml/servidor.mjs';
import { corpoDaAlteracao, mensagemDeErro, normalizarAnuncio, normalizarPedido, resumirPedidos } from '../src/lib/ml/mercadolivre';

describe('normalização dos dados do Mercado Livre', () => {
  it('pedido: comprador, itens, tarifa por quantidade e cancelamento', () => {
    const p = normalizarPedido({
      id: 2000001, date_created: '2026-11-20T10:00:00.000-03:00', status: 'paid', total_amount: 250, paid_amount: 250,
      buyer: { nickname: 'COMPRADOR1', first_name: 'Ana', last_name: 'Souza' },
      order_items: [{ item: { id: 'MLB1', title: 'Disjuntor 20A', seller_sku: 'DJ20' }, quantity: 2, unit_price: 125, sale_fee: 15 }],
      shipping: { id: 99 },
    });
    expect(p).toMatchObject({ id: '2000001', comprador: 'Ana Souza', total: 250, envioId: '99', cancelado: false });
    expect(p.itens[0]).toEqual({ itemId: 'MLB1', titulo: 'Disjuntor 20A', sku: 'DJ20', quantidade: 2, precoUnit: 125, tarifa: 30 });
  });

  it('resumo ignora pedidos cancelados', () => {
    const base = { id: '1', data: '', pago: 0, comprador: '', envioId: null, itens: [{ itemId: 'a', titulo: '', sku: '', quantidade: 2, precoUnit: 50, tarifa: 10 }] };
    const r = resumirPedidos([
      { ...base, status: 'paid', total: 100, cancelado: false },
      { ...base, id: '2', status: 'cancelled', total: 999, cancelado: true },
    ]);
    expect(r).toEqual({ pedidos: 1, unidades: 2, bruto: 100, tarifas: 10, liquido: 90 });
  });

  it('anúncio: SKU do atributo, foto em https e variações', () => {
    const a = normalizarAnuncio({
      id: 'MLB1', title: 'X', price: 10.5, available_quantity: 3, sold_quantity: 7, status: 'active', permalink: 'https://x',
      thumbnail: 'http://img/a.jpg', attributes: [{ id: 'SELLER_SKU', value_name: 'ABC' }], variations: [{ id: 1 }],
    });
    expect(a).toMatchObject({ sku: 'ABC', foto: 'https://img/a.jpg', comVariacoes: true, preco: 10.5, estoque: 3 });
  });

  it('alteração: só os campos que mudaram e valida valores', () => {
    expect(corpoDaAlteracao({ preco: 19.999, estoque: 0 })).toEqual({ price: 20, available_quantity: 0 });
    expect(corpoDaAlteracao({ status: 'paused' })).toEqual({ status: 'paused' });
    expect(() => corpoDaAlteracao({ preco: 0 })).toThrow(/preço/);
    expect(() => corpoDaAlteracao({ estoque: 1.5 })).toThrow(/inteiro/);
    expect(() => corpoDaAlteracao({})).toThrow(/Nada/);
  });

  it('mensagem de erro junta as causas', () => {
    expect(mensagemDeErro({ message: 'Erro', cause: [{ message: 'preço inválido' }] })).toBe('Erro · preço inválido');
  });
});

describe('ajudante local (com um Mercado Livre falso)', () => {
  let falso: Server;
  let urlFalso = '';
  let contador = 0;
  const chamadas: { url: string; auth?: string; corpo: string; tipo?: string }[] = [];
  let agora = 1_000_000;
  let ajudante: ReturnType<typeof criarAjudante>;
  let base = '';
  let arquivo = '';
  const H = { origin: 'http://localhost:5173', 'x-kivor': '1' };

  beforeEach(async () => {
    contador = 0; chamadas.length = 0; agora = 1_000_000;
    falso = createServer(async (req, res) => {
      const partes: Buffer[] = [];
      for await (const p of req) partes.push(p as Buffer);
      const corpo = Buffer.concat(partes).toString();
      chamadas.push({ url: req.url!, auth: req.headers.authorization, corpo, tipo: req.headers['content-type'] });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/oauth/token') {
        const q = new URLSearchParams(corpo);
        if (q.get('grant_type') === 'refresh_token' && q.get('refresh_token') !== `RT${contador}`) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'usado' })); }
        contador++;
        return res.end(JSON.stringify({ access_token: `AT${contador}`, refresh_token: `RT${contador}`, expires_in: 21600, user_id: 555 }));
      }
      if (req.url!.startsWith('/users/me')) return res.end(JSON.stringify({ id: 555 }));
      res.end('{}');
    });
    await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
    urlFalso = `http://127.0.0.1:${(falso.address() as { port: number }).port}`;
    arquivo = join(await mkdtemp(join(tmpdir(), 'kivor-ml-')), 'ml.json');
    ajudante = criarAjudante({ arquivo, api: urlFalso, auth: `${urlFalso}/auth`, relogio: () => agora });
    base = `http://127.0.0.1:${await ajudante.iniciar(0)}`;
  });
  afterEach(async () => { await ajudante.parar(); await new Promise((ok) => falso.close(ok)); });

  const post = (p: string, corpo: unknown) => fetch(base + p, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  async function conectar() {
    await post('/config', { appId: '123', secret: 'segredo', pkce: true });
    const { url } = await (await fetch(base + '/auth/url', { headers: H })).json();
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('123');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    const r = await fetch(`${base}/ml/retorno?code=TG-1&state=${u.searchParams.get('state')}`);
    expect(r.status).toBe(200);
  }

  it('recusa quem não é o KIVOR', async () => {
    expect((await fetch(base + '/status')).status).toBe(403);
    expect((await fetch(base + '/status', { headers: { 'x-kivor': '1', origin: 'https://site-malicioso.com' } })).status).toBe(403);
    expect((await fetch(base + '/status', { headers: H })).status).toBe(200);
  });

  it('conecta, envia o verifier PKCE e guarda a chave fora das respostas', async () => {
    await conectar();
    const troca = new URLSearchParams(chamadas.find((c) => c.url === '/oauth/token')!.corpo);
    expect(troca.get('client_secret')).toBe('segredo');
    expect(troca.get('code_verifier')).toBeTruthy();
    const st = await (await fetch(base + '/status', { headers: H })).json();
    expect(st).toMatchObject({ configurado: true, conectado: true, userId: 555 });
    expect(JSON.stringify(st)).not.toContain('segredo');
  });

  it('rejeita retorno com state desconhecido', async () => {
    await post('/config', { appId: '123', secret: 's' });
    expect((await fetch(`${base}/ml/retorno?code=x&state=falso`)).status).toBe(400);
  });

  it('repassa a chamada com o Bearer e só para recursos permitidos', async () => {
    await conectar();
    const r = await fetch(base + '/api/users/me', { headers: H });
    expect(await r.json()).toEqual({ id: 555 });
    expect(chamadas.at(-1)!.auth).toBe('Bearer AT1');
    expect((await fetch(base + '/api/oauth/token', { headers: H })).status).toBe(403);
    expect((await fetch(base + '/api/users/../oauth/token', { headers: H })).status).toBe(403);
  });

  it('renova o token vencido e grava o novo refresh token', async () => {
    await conectar();
    agora += 6 * 3600_000;
    await fetch(base + '/api/users/me', { headers: H });
    expect(chamadas.at(-1)!.auth).toBe('Bearer AT2');
    const salvo = JSON.parse(await readFile(arquivo, 'utf8'));
    expect(salvo.tokens.refresh).toBe('RT2');
  });

  it('duas chamadas ao mesmo tempo com o token vencido renovam uma vez só', async () => {
    await conectar();
    agora += 6 * 3600_000;
    await Promise.all([fetch(base + '/api/users/me', { headers: H }), fetch(base + '/api/users/me', { headers: H }), fetch(base + '/api/users/me', { headers: H })]);
    expect(chamadas.filter((c) => c.url === '/oauth/token')).toHaveLength(2); // troca do código + 1 renovação
  });

  it('repassa o upload de foto (multipart) sem alterar o corpo nem o content-type', async () => {
    await conectar();
    const fd = new FormData();
    fd.append('file', new Blob(['PIXELS-FALSOS'], { type: 'image/jpeg' }), 'a.jpg');
    const r = await fetch(base + '/api/pictures/items/upload', { method: 'POST', headers: { 'x-kivor': '1', origin: 'http://localhost:5173' }, body: fd });
    expect(r.status).toBe(200);
    const c = chamadas.at(-1)!;
    expect(c.url).toBe('/pictures/items/upload');
    expect(c.auth).toBe('Bearer AT1');
    expect(c.tipo).toMatch(/^multipart\/form-data; boundary=/);
    expect(c.corpo).toContain('PIXELS-FALSOS');
  });

  it('sem conexão, responde 401 nao_conectado', async () => {
    const r = await fetch(base + '/api/users/me', { headers: H });
    expect(r.status).toBe(401);
    expect((await r.json()).erro).toBe('nao_conectado');
  });
});
