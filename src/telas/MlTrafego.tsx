import { useEffect, useMemo, useState } from 'preact/hooks';
import { token } from '../auth';
import type { Material } from '../lib/model';
import { enviarFotos, fotosJaEnviadas } from '../lib/ml/fotos';
import { MAX_FOTOS_ML, planejarFotos } from '../lib/ml/fotosPlano';
import { AjudanteOffline, NaoConectado, buscarAnuncios, buscarPedidos, type AnuncioMl } from '../lib/ml/mercadolivre';
import { urlMiniatura } from '../onedrive';
import {
  JANELA_DIAS, LIMITE_TITULO_ML, PARAMETROS_PADRAO, ROTULO_ACAO, analisar, aplicarDescricao, aplicarTitulo, buscarVisitas, ordenarAnalises,
  problemasDeQualidade, sugerirDescricao, sugerirTitulo, vendasPorAnuncio, vincularProduto,
  type Acao, type Analise, type ParametrosTrafego, type VendasItem,
} from '../lib/ml/trafego';
import { useDados } from '../store';

// ML04 Tráfego: onde investir em anúncio e o que corrigir. O KIVOR só sugere; nada muda no Mercado Livre sem o clique.

const tab = { width: '100%', overflowX: 'auto' } as const;
const CHAVE_PARAMS = 'kivor-ml-trafego';
function lerParams(): ParametrosTrafego {
  try { return { ...PARAMETROS_PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_PARAMS) ?? '{}') }; } catch { return PARAMETROS_PADRAO; }
}
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const COR_ACAO: Record<Acao, string> = { investir: '#1b7f3b', corrigir: '#b45f06', testar: '#555', dados: '#555', evitar: '#b3261e' };

function Erro({ e }: { e: unknown }) {
  if (e instanceof AjudanteOffline) return <div class="erro">{e.message}</div>;
  if (e instanceof NaoConectado) return <div class="erro">{e.message} <a href="#/ml03">Conectar</a></div>;
  return <div class="erro">{(e as Error).message}</div>;
}

export function Trafego({ userId }: { userId: number }) {
  const d = useDados();
  const [params, setParams] = useState(lerParams);
  const [bruto, setBruto] = useState<{ anuncios: AnuncioMl[]; vendas: Map<string, VendasItem>; visitas: Map<string, number | null> } | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [prog, setProg] = useState('');
  const [filtro, setFiltro] = useState<Acao | ''>('');
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = () => {
    setBruto(null); setErro(null); setProg('Lendo anúncios…');
    (async () => {
      const anuncios = await buscarAnuncios(userId);
      setProg('Lendo pedidos dos últimos 30 dias…');
      const pedidos = await buscarPedidos(userId, { desde: new Date(Date.now() - JANELA_DIAS * 86_400_000) });
      const ativos = anuncios.filter((a) => a.status === 'active').map((a) => a.id);
      const visitas = await buscarVisitas(ativos, (n) => setProg(`Lendo visitas… ${n} de ${ativos.length}`));
      setBruto({ anuncios, vendas: vendasPorAnuncio(pedidos, new Date()), visitas });
    })().then(() => setProg(''), (e) => { setErro(e); setProg(''); });
  };
  useEffect(carregar, [userId]);

  const mudar = (k: keyof ParametrosTrafego, v: string) => {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return;
    const novo = { ...params, [k]: n };
    setParams(novo);
    try { localStorage.setItem(CHAVE_PARAMS, JSON.stringify(novo)); } catch { /* sem armazenamento: vale só nesta visita */ }
  };

  const analises = useMemo(() => {
    if (!bruto) return [];
    return ordenarAnalises(bruto.anuncios.map((a) => analisar(
      a, a.status === 'active' ? bruto.visitas.get(a.id) ?? null : null, bruto.vendas.get(a.id), vincularProduto(a, d.materiaisWms), params,
    )));
  }, [bruto, d.materiaisWms, params]);
  const contagem = (ac: Acao) => analises.filter((x) => x.acao === ac).length;
  const lista = analises.filter((x) => !filtro || x.acao === filtro);

  return (
    <>
      <div class="cartao">
        <p class="peq">
          Cruza visitas e vendas dos últimos {JANELA_DIAS} dias com o custo do produto no KIVOR (o SKU do anúncio precisa ser igual ao código/modelo do produto).
          O KIVOR só sugere: nada muda no Mercado Livre sem o seu clique. <button class="botao" onClick={carregar}>Atualizar</button>
        </p>
        <div class="chips">
          <button class={filtro === '' ? 'primario' : 'botao'} onClick={() => setFiltro('')}>Todos ({analises.length})</button>{' '}
          {(Object.keys(ROTULO_ACAO) as Acao[]).map((ac) => (
            <button key={ac} class={filtro === ac ? 'primario' : 'botao'} onClick={() => setFiltro(ac)}>{ROTULO_ACAO[ac]} ({contagem(ac)})</button>
          ))}
        </div>
        <details>
          <summary class="peq">Regras da análise</summary>
          <div class="grade2">
            <label>Margem mínima para anunciar (%)<input inputMode="decimal" value={String(params.margemMinPct)} onChange={(e) => mudar('margemMinPct', e.currentTarget.value)} /></label>
            <label>Conversão mínima (%)<input inputMode="decimal" value={String(params.conversaoMinPct)} onChange={(e) => mudar('conversaoMinPct', e.currentTarget.value)} /></label>
            <label>Visitas mínimas em 30 dias<input inputMode="numeric" value={String(params.visitasMin)} onChange={(e) => mudar('visitasMin', e.currentTarget.value)} /></label>
            <label>Tarifa do Mercado Livre, se o pedido não informar (%)<input inputMode="decimal" value={String(params.tarifaPadraoPct)} onChange={(e) => mudar('tarifaPadraoPct', e.currentTarget.value)} /></label>
          </div>
          <p class="peq">A margem desconta custo de compra e tarifa; não inclui frete nem imposto. O "limite de anúncio" é o maior gasto com anúncio, em % da venda, antes de dar prejuízo.</p>
        </details>
      </div>
      {prog && <div class="cartao vazio">{prog}</div>}
      {erro ? <Erro e={erro} /> : null}
      {bruto && !lista.length && <div class="cartao vazio">Nenhum anúncio nesta categoria.</div>}
      {lista.length > 0 && (
        <div class="cartao" style={tab}>
          <table class="tabela">
            <thead><tr><th>Anúncio</th><th>Visitas</th><th>Vendas</th><th>Conversão</th><th>Margem</th><th>Limite de anúncio</th><th>Recomendação</th></tr></thead>
            <tbody>
              {lista.map((x) => {
                const a = x.anuncio;
                return (
                  <>
                    <tr key={a.id}>
                      <td><a href={a.link} target="_blank" rel="noopener noreferrer">{a.titulo}</a><div class="peq">{a.id}{a.sku ? ` · SKU ${a.sku}` : ''} · {a.fotos} fotos</div></td>
                      <td>{x.visitas ?? '—'}</td>
                      <td>{x.vendas}</td>
                      <td>{pct(x.conversaoPct)}</td>
                      <td>{pct(x.margemPct)}</td>
                      <td>{pct(x.acosMaximoPct)}</td>
                      <td>
                        <b style={{ color: COR_ACAO[x.acao] }}>{ROTULO_ACAO[x.acao]}</b>
                        {x.motivos.map((m) => <div class="peq" key={m}>{m}</div>)}
                        {problemasDeQualidade(a).map((m) => <div class="peq" key={m}>⚠ {m}</div>)}
                        {x.produto && <div><button class="botao" onClick={() => setAberto(aberto === a.id ? null : a.id)}>{aberto === a.id ? 'Fechar' : 'Textos e fotos'}</button></div>}
                      </td>
                    </tr>
                    {aberto === a.id && x.produto && <tr key={a.id + 't'}><td colSpan={7}><PainelTextos analise={x} /></td></tr>}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PainelTextos({ analise }: { analise: Analise }) {
  const a = analise.anuncio;
  const m = analise.produto!;
  const [titulo, setTitulo] = useState(() => sugerirTitulo(m));
  const [desc, setDesc] = useState(() => sugerirDescricao(m));
  const [msg, setMsg] = useState<{ ok: boolean; t: unknown } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const rodar = async (f: () => Promise<void>, ok: string) => {
    setOcupado(true); setMsg(null);
    try { await f(); setMsg({ ok: true, t: ok }); } catch (e) { setMsg({ ok: false, t: e }); } finally { setOcupado(false); }
  };
  return (
    <div class="cartao">
      <label>Título sugerido ({titulo.length}/{LIMITE_TITULO_ML})
        <input value={titulo} maxLength={LIMITE_TITULO_ML} onInput={(e) => setTitulo(e.currentTarget.value)} />
      </label>
      <p class="peq">Atual: {a.titulo}{a.vendidos > 0 ? ' · Este anúncio já vendeu; o Mercado Livre pode não deixar trocar o título.' : ''}</p>
      <button class="primario" disabled={ocupado || titulo.trim() === a.titulo} onClick={() => void rodar(() => aplicarTitulo(a.id, titulo), 'Título atualizado no Mercado Livre.')}>Aplicar título</button>
      <label style="margin-top:.75rem;display:block">Descrição sugerida (revise antes de aplicar)
        <textarea rows={8} value={desc} onInput={(e) => setDesc(e.currentTarget.value)} />
      </label>
      <button class="primario" disabled={ocupado} onClick={() => void rodar(() => aplicarDescricao(a.id, desc), 'Descrição atualizada no Mercado Livre.')}>Aplicar descrição</button>
      {msg && (msg.ok ? <p class="peq">✅ {String(msg.t)}</p> : <Erro e={msg.t} />)}
      <SeletorFotos anuncio={a} material={m} />
    </div>
  );
}

function Miniatura({ itemId }: { itemId: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { token().then((t) => urlMiniatura(t, itemId)).then(setUrl, () => setUrl('')); }, [itemId]);
  return url ? <img src={url} alt="" style="width:64px;height:64px;object-fit:cover;border-radius:6px" /> : <span style="display:inline-block;width:64px;height:64px;background:#8883;border-radius:6px" />;
}

/** Escolhe fotos do produto (WMS › Produtos) e as envia ao anúncio. */
function SeletorFotos({ anuncio, material }: { anuncio: AnuncioMl; material: Material }) {
  const [a, setA] = useState(anuncio);
  const [jaEnviadas, setJaEnviadas] = useState(() => fotosJaEnviadas(anuncio.id));
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; t: unknown } | null>(null);
  const [ocupado, setOcupado] = useState('');
  const fotos = material.fotos ?? [];
  const escolhidas = fotos.filter((f) => marcadas.has(f.id));
  const plano = planejarFotos(a, escolhidas, jaEnviadas);

  const alternar = (id: string) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const enviar = async () => {
    setOcupado('Enviando…'); setMsg(null);
    try {
      const novo = await enviarFotos(a, plano, (i, n) => setOcupado(`Enviando foto ${Math.min(i + 1, n)} de ${n}…`));
      setA(novo); setJaEnviadas(fotosJaEnviadas(a.id)); setMarcadas(new Set());
      setMsg({ ok: true, t: `${plano.enviar.length} foto(s) enviada(s). O anúncio agora tem ${novo.fotos}.` });
    } catch (e) { setMsg({ ok: false, t: e }); } finally { setOcupado(''); }
  };

  return (
    <div style="margin-top:.75rem">
      <b>Fotos</b> <span class="peq">O anúncio tem {a.fotos} de {MAX_FOTOS_ML}. O produto tem {fotos.length} no KIVOR (WMS › Produtos).</span>
      {!fotos.length && <p class="peq">Cadastre fotos do produto em WMS › Produtos para enviá-las ao anúncio.</p>}
      <div style="display:flex;flex-wrap:wrap;gap:.75rem;margin:.5rem 0">
        {fotos.map((f) => {
          const feita = jaEnviadas.has(f.id);
          return (
            <label key={f.id} class="peq" style="display:flex;flex-direction:column;align-items:center;gap:.25rem;width:84px">
              <Miniatura itemId={f.itemId} />
              <span><input type="checkbox" style="width:auto" disabled={feita} checked={marcadas.has(f.id)} onChange={() => alternar(f.id)} /> {feita ? 'enviada' : f.tipo === 'estudio' ? 'estúdio' : 'loja'}</span>
            </label>
          );
        })}
      </div>
      {escolhidas.length > 0 && plano.bloqueio && <p class="peq">⚠ {plano.bloqueio}</p>}
      {plano.semVaga > 0 && !plano.bloqueio && <p class="peq">⚠ {plano.semVaga} foto(s) ficarão de fora por falta de vaga.</p>}
      <button class="primario" disabled={!!ocupado || !!plano.bloqueio} onClick={() => void enviar()}>{ocupado || `Enviar ${plano.enviar.length || ''} foto(s) ao anúncio`}</button>
      <p class="peq">As fotos novas entram depois das atuais; a capa continua a mesma. O Mercado Livre pede no mínimo 500 px no maior lado.</p>
      {msg && (msg.ok ? <p class="peq">✅ {String(msg.t)}</p> : <Erro e={msg.t} />)}
    </div>
  );
}
