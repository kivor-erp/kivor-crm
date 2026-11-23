import { useEffect, useMemo, useState } from 'preact/hooks';
import { fmtDataHora } from '../lib/datas';
import { normalizar } from '../lib/texto';
import { Trafego } from './MlTrafego';
import {
  AjudanteOffline, NaoConectado, alterarAnuncio, buscarAnuncios, buscarPedidos, desconectar, nomeStatusAnuncio, nomeStatusPedido,
  resumirPedidos, salvarConfig, statusAjudante, urlDeConexao,
  type AnuncioMl, type PedidoMl, type StatusAjudante,
} from '../lib/ml/mercadolivre';

// Módulo Mercado Livre (ML01 Pedidos, ML02 Anúncios, ML03 Conexão). Usa só os estilos existentes.

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const tab = { width: '100%', overflowX: 'auto' } as const;

type Estado = { tipo: 'carregando' } | { tipo: 'offline' } | { tipo: 'ok'; st: StatusAjudante };

function useAjudante() {
  const [e, setE] = useState<Estado>({ tipo: 'carregando' });
  const recarregar = () => statusAjudante().then((st) => setE({ tipo: 'ok', st }), () => setE({ tipo: 'offline' }));
  useEffect(() => { void recarregar(); }, []);
  return [e, recarregar] as const;
}

export function TelaMl({ rota }: { rota: string }) {
  const [e, recarregar] = useAjudante();
  if (e.tipo === 'carregando') return <div class="cartao vazio">Procurando o ajudante do Mercado Livre…</div>;
  if (e.tipo === 'offline') return <Offline aoTentar={recarregar} />;
  if (rota === 'ml03' || !e.st.conectado) return <Conexao st={e.st} aoMudar={recarregar} />;
  if (rota === 'ml02') return <Anuncios userId={e.st.userId!} />;
  if (rota === 'ml04') return <Trafego userId={e.st.userId!} />;
  return <Pedidos userId={e.st.userId!} />;
}

function Offline({ aoTentar }: { aoTentar: () => Promise<void> | void }) {
  const [ligando, setLigando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  /** Pede ao Windows (atalho kivor-ml:, criado por instalar-ajudante-ml.cmd) para ligar o ajudante escondido e espera ele responder. */
  const ligar = async () => {
    setLigando(true); setFalhou(false);
    location.href = 'kivor-ml://iniciar';
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try { await statusAjudante(); await aoTentar(); return; } catch { /* ainda subindo */ }
    }
    setLigando(false); setFalhou(true);
  };

  return (
    <div class="cartao vazio">
      <p><b>O ajudante do Mercado Livre está desligado.</b></p>
      <p class="peq">Ele roda neste computador, em segundo plano, e guarda a chave do seu app com segurança.</p>
      <button class="primario" disabled={ligando} onClick={() => void ligar()}>{ligando ? 'Ligando…' : 'Ligar o ajudante'}</button>{' '}
      <button class="botao" disabled={ligando} onClick={() => void aoTentar()}>Tentar de novo</button>
      {falhou && (
        <p class="peq">
          Não ligou. Se é a primeira vez neste computador, dê dois cliques em <code>instalar-ajudante-ml.cmd</code> (pasta <code>ajudante-ml</code>) uma única vez.
          Depois disso o botão funciona e o ajudante também liga sozinho com o Windows. Se o navegador perguntar se pode abrir o atalho, aceite.
        </p>
      )}
    </div>
  );
}

function Erro({ e }: { e: unknown }) {
  if (e instanceof AjudanteOffline) return <div class="erro">{e.message}</div>;
  if (e instanceof NaoConectado) return <div class="erro">{e.message} <a href="#/ml03">Conectar</a></div>;
  return <div class="erro">{(e as Error).message}</div>;
}

// ---------- ML03 Conexão ----------

function Conexao({ st, aoMudar }: { st: StatusAjudante; aoMudar: () => void }) {
  const [appId, setAppId] = useState('');
  const [secret, setSecret] = useState('');
  const [pkce, setPkce] = useState(st.pkce);
  // O Mercado Livre exige HTTPS no endereço de retorno: usa a página estática ml-retorno.html do próprio KIVOR publicado.
  const sugerido = location.protocol === 'https:' ? new URL('./ml-retorno.html', location.href).href : '';
  const [retorno, setRetorno] = useState(st.redirectUri.startsWith('https:') ? st.redirectUri : sugerido);
  const [msg, setMsg] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);

  const rodar = async (f: () => Promise<void>) => {
    setOcupado(true); setMsg(null);
    try { await f(); } catch (e) { setMsg(e); } finally { setOcupado(false); }
  };
  const salvar = () => rodar(async () => {
    await salvarConfig({ appId: appId || undefined, secret: secret || undefined, pkce, redirectUri: retorno.trim() });
    setSecret('');
    await aoMudar();
  });
  const conectar = () => rodar(async () => { window.open(await urlDeConexao(), '_blank'); });

  return (
    <>
      <div class="cartao">
        <h3>Mercado Livre {st.conectado ? '· conectado' : '· não conectado'}</h3>
        {st.conectado
          ? <p>Conta do vendedor nº {st.userId}. <button class="botao" disabled={ocupado} onClick={() => rodar(async () => { await desconectar(); await aoMudar(); })}>Desconectar</button>
            {' '}<button class="botao" onClick={() => void aoMudar()}>Atualizar situação</button></p>
          : <p class="peq">Passo a passo na pasta <code>ajudante-ml</code> (arquivo LEIA-ME.md). Depois de salvar o ID e a chave, clique em Conectar e autorize na janela do Mercado Livre com a conta <b>principal</b> da loja.</p>}
      </div>
      <div class="cartao">
        <h3>App do Mercado Livre</h3>
        <div class="grade2">
          <label>ID do app (APP ID)<input value={appId} onInput={(e) => setAppId(e.currentTarget.value)} placeholder={st.configurado ? '(já salvo)' : ''} /></label>
          <label>Chave secreta (Secret Key)<input type="password" autocomplete="off" value={secret} onInput={(e) => setSecret(e.currentTarget.value)} placeholder={st.configurado ? '(já salva; deixe vazio para manter)' : ''} /></label>
        </div>
        <label class="peq" style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" style="width:auto" checked={pkce} onChange={(e) => setPkce(e.currentTarget.checked)} /> O app tem PKCE ativado no painel do Mercado Livre</label>
        <label>Endereço de retorno (HTTPS), igual ao cadastrado no app do Mercado Livre
          <input value={retorno} onInput={(e) => setRetorno(e.currentTarget.value)} placeholder="https://…/ml-retorno.html" />
        </label>
        <p class="peq">Abra o KIVOR publicado (https) para este campo vir preenchido. Esta página só repassa a autorização, no seu navegador, para o ajudante deste computador.</p>
        <p>
          <button class="botao" disabled={ocupado} onClick={() => void salvar()}>Salvar</button>{' '}
          {!st.conectado && <button class="primario" disabled={ocupado || !st.configurado} onClick={() => void conectar()}>Conectar ao Mercado Livre</button>}
        </p>
        {msg ? <Erro e={msg} /> : null}
      </div>
    </>
  );
}

// ---------- ML01 Pedidos ----------

function Pedidos({ userId }: { userId: number }) {
  const [lista, setLista] = useState<PedidoMl[] | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState('');

  const carregar = () => {
    setLista(null); setErro(null);
    buscarPedidos(userId).then(setLista, setErro);
  };
  useEffect(carregar, [userId]);

  const filtrada = useMemo(() => {
    const b = normalizar(busca);
    return (lista ?? []).filter((p) => (!status || p.status === status)
      && (!b || normalizar(`${p.id} ${p.comprador} ${p.itens.map((i) => `${i.titulo} ${i.sku}`).join(' ')}`).includes(b)));
  }, [lista, busca, status]);
  const r = resumirPedidos(filtrada);
  const statusPresentes = [...new Set((lista ?? []).map((p) => p.status))];

  return (
    <>
      <div class="cartao">
        <div class="grade2">
          <label>Buscar<input value={busca} onInput={(e) => setBusca(e.currentTarget.value)} placeholder="nº do pedido, comprador, produto, SKU" /></label>
          <label>Situação
            <select value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
              <option value="">Todas</option>
              {statusPresentes.map((s) => <option key={s} value={s}>{nomeStatusPedido(s)}</option>)}
            </select>
          </label>
        </div>
        <p class="peq">
          {r.pedidos} pedidos · {r.unidades} unidades · vendido {reais(r.bruto)} · tarifas do ML {reais(r.tarifas)} · sobra {reais(r.liquido)} (antes de frete e imposto; cancelados ficam de fora)
          {' '}<button class="botao" onClick={carregar}>Atualizar</button>
        </p>
      </div>
      {erro ? <Erro e={erro} /> : null}
      {!lista && !erro && <div class="cartao vazio">Buscando pedidos no Mercado Livre…</div>}
      {lista && !filtrada.length && <div class="cartao vazio">Nenhum pedido encontrado.</div>}
      {filtrada.length > 0 && (
        <div class="cartao" style={tab}>
          <table class="tabela">
            <thead><tr><th>Pedido</th><th>Data</th><th>Comprador</th><th>Itens</th><th>Total</th><th>Situação</th></tr></thead>
            <tbody>
              {filtrada.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.data ? fmtDataHora(p.data) : '—'}</td>
                  <td>{p.comprador}</td>
                  <td>{p.itens.map((i) => <div key={i.itemId + i.sku}>{i.quantidade}× {i.titulo}{i.sku ? ` (${i.sku})` : ''}</div>)}</td>
                  <td>{reais(p.total)}</td>
                  <td>{nomeStatusPedido(p.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- ML02 Anúncios ----------

function Anuncios({ userId }: { userId: number }) {
  const [lista, setLista] = useState<AnuncioMl[] | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [busca, setBusca] = useState('');
  const [aviso, setAviso] = useState('');
  const [rascunho, setRascunho] = useState<Record<string, { preco: string; estoque: string }>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = () => {
    setLista(null); setErro(null);
    buscarAnuncios(userId).then(setLista, setErro);
  };
  useEffect(carregar, [userId]);

  const filtrada = useMemo(() => {
    const b = normalizar(busca);
    return (lista ?? []).filter((a) => !b || normalizar(`${a.id} ${a.titulo} ${a.sku}`).includes(b));
  }, [lista, busca]);

  const aplicar = async (a: AnuncioMl, alt: Parameters<typeof alterarAnuncio>[1]) => {
    setOcupado(a.id); setAviso(''); setErro(null);
    try {
      const novo = await alterarAnuncio(a.id, alt);
      setLista((l) => (l ?? []).map((x) => (x.id === a.id ? { ...novo, foto: novo.foto || x.foto } : x)));
      setRascunho((r) => { const { [a.id]: _, ...resto } = r; return resto; });
      setAviso(`Anúncio ${a.id} atualizado no Mercado Livre.`);
    } catch (e) { setErro(e); } finally { setOcupado(null); }
  };
  const campo = (a: AnuncioMl) => rascunho[a.id] ?? { preco: String(a.preco).replace('.', ','), estoque: String(a.estoque) };
  const editar = (a: AnuncioMl, k: 'preco' | 'estoque', v: string) => setRascunho((r) => ({ ...r, [a.id]: { ...campo(a), [k]: v } }));
  const salvarLinha = (a: AnuncioMl) => {
    const c = campo(a);
    const preco = Number(c.preco.replace(/\./g, '').replace(',', '.'));
    const estoque = Number(c.estoque);
    void aplicar(a, { preco: preco !== a.preco ? preco : undefined, estoque: estoque !== a.estoque ? estoque : undefined });
  };

  return (
    <>
      <div class="cartao">
        <label>Buscar<input value={busca} onInput={(e) => setBusca(e.currentTarget.value)} placeholder="título, código do anúncio ou SKU" /></label>
        <p class="peq">{filtrada.length} anúncios. Alterar preço, estoque ou pausar aqui muda direto no Mercado Livre. <button class="botao" onClick={carregar}>Atualizar</button></p>
        {aviso && <p class="peq">✅ {aviso}</p>}
      </div>
      {erro ? <Erro e={erro} /> : null}
      {!lista && !erro && <div class="cartao vazio">Buscando anúncios no Mercado Livre…</div>}
      {lista && !filtrada.length && <div class="cartao vazio">Nenhum anúncio encontrado.</div>}
      {filtrada.length > 0 && (
        <div class="cartao" style={tab}>
          <table class="tabela">
            <thead><tr><th>Anúncio</th><th>Preço (R$)</th><th>Estoque</th><th>Vendidos</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {filtrada.map((a) => {
                const c = campo(a);
                const sujo = !!rascunho[a.id];
                const pode = a.status === 'active' || a.status === 'paused';
                return (
                  <tr key={a.id}>
                    <td><a href={a.link} target="_blank" rel="noopener noreferrer">{a.titulo}</a><div class="peq">{a.id}{a.sku ? ` · SKU ${a.sku}` : ''}</div></td>
                    <td>{a.comVariacoes ? <span class="peq">variações</span> : <input style="width:6.5rem" inputMode="decimal" value={c.preco} onInput={(e) => editar(a, 'preco', e.currentTarget.value)} />}</td>
                    <td>{a.comVariacoes ? <span class="peq">variações</span> : <input style="width:4.5rem" inputMode="numeric" value={c.estoque} onInput={(e) => editar(a, 'estoque', e.currentTarget.value)} />}</td>
                    <td>{a.vendidos}</td>
                    <td>{nomeStatusAnuncio(a.status)}</td>
                    <td>
                      {sujo && <button class="primario" disabled={ocupado === a.id} onClick={() => salvarLinha(a)}>Salvar</button>}{' '}
                      {pode && <button class="botao" disabled={ocupado === a.id} onClick={() => void aplicar(a, { status: a.status === 'active' ? 'paused' : 'active' })}>{a.status === 'active' ? 'Pausar' : 'Reativar'}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
