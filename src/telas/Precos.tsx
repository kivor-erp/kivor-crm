import { useMemo, useState } from 'preact/hooks';
import { CampoValor } from '../componentes';
import { excluir, salvar } from '../db';
import { proximoNumeroCompra } from '../lib/compras';
import { fmtData, hojeSP } from '../lib/datas';
import { gravarParametrosMapa, lerParametrosMapa, chaveModelo, custoTotal, custoUnitario, ipiUnitario, esperandoResposta, lerCargaPrecos, mapaDePrecos, margemLiquida, nivelVenda, novoPreco, pedidoDaOferta, planejarCargaPrecos, precoPiso, precoSugerido, situacaoValidade, type GrupoPreco, type ParametrosVenda, type PlanoPrecos } from '../lib/precos';
import { STATUS_PRECO, TIPOS_FRETE, type Material, type PrecoCotado, type StatusPreco, type TipoFrete } from '../lib/model';
import { normalizar } from '../lib/texto';
import { ir, useDados } from '../store';

// Compras › Mapa de preços: todas as cotações recebidas, por produto, com o custo real (IPI/ST/frete) e o que isso
// significa para o preço de venda. Serve para comprar do melhor fornecedor e para não vender abaixo do custo.

const fmtR = (v: number | null | undefined) => (v === null || v === undefined ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtPct = (v: number | null) => (v === null ? '' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
type Filtro = 'todos' | 'aguardando' | 'vigentes' | 'vencendo' | 'sem-vigente' | 'sem-venda';

export function Precos() {
  const d = useDados();
  const [params, setParams] = useState(lerParametrosMapa);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [demanda, setDemanda] = useState('');
  const [abertos, setAbertos] = useState<string[]>([]);
  const [ed, setEd] = useState<PrecoCotado | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [plano, setPlano] = useState<PlanoPrecos | null>(null);
  const [erroCarga, setErroCarga] = useState('');
  const hoje = hojeSP();
  const o = { creditaIpi: params.creditaIpi };

  const mudarParams = (p: typeof params) => { setParams(p); gravarParametrosMapa(p); };
  const materialPorModelo = useMemo(() => new Map(d.materiais.filter((m) => chaveModelo(m.modelo)).map((m) => [chaveModelo(m.modelo), m])), [d.materiais]);
  const materialDe = (g: GrupoPreco): Material | undefined => (g.materialId ? d.materiais.find((m) => m.id === g.materialId) : undefined) ?? materialPorModelo.get(chaveModelo(g.modelo));

  const grupos = useMemo(() => mapaDePrecos(d.precos, hoje, o), [d.precos, hoje, params.creditaIpi]);
  const lista = useMemo(() => {
    const t = normalizar(busca).split(' ').filter(Boolean);
    return grupos.filter((g) => {
      const texto = normalizar(`${g.modelo} ${g.descricao} ${g.fabricante} ${g.demandas.join(' ')} ${g.ofertas.map((x) => `${x.fornecedor} ${x.oferta} ${x.codigoFornecedor}`).join(' ')}`);
      if (!t.every((x) => texto.includes(x))) return false;
      if (demanda && !g.demandas.includes(demanda)) return false;
      if (filtro === 'aguardando') return g.aguardando > 0;
      if (filtro === 'vigentes') return g.vigentes > 0;
      if (filtro === 'sem-vigente') return g.vigentes === 0;
      if (filtro === 'vencendo') return !!g.melhor && situacaoValidade(g.melhor, hoje).situacao === 'vence-logo';
      if (filtro === 'sem-venda') return g.vigentes > 0 && !materialDe(g)?.precoVenda;
      return true;
    });
  }, [grupos, busca, filtro, demanda, materialPorModelo, d.materiais]);
  const conta = (f: Filtro) => grupos.filter((g) => (f === 'aguardando' ? g.aguardando > 0 : f === 'vigentes' ? g.vigentes > 0 : f === 'sem-vigente' ? g.vigentes === 0 : f === 'vencendo' ? !!g.melhor && situacaoValidade(g.melhor, hoje).situacao === 'vence-logo' : f === 'sem-venda' ? g.vigentes > 0 && !materialDe(g)?.precoVenda : true)).length;

  const pendentes = useMemo(() => esperandoResposta(d.precos, hoje), [d.precos, hoje]);
  const demandas = useMemo(() => [...new Set(d.precos.filter((p) => !p.excluidoEm).map((p) => p.demanda?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [d.precos]);
  const nomeGrupo = (p: PrecoCotado) => p.modelo || p.descricao || '(sem nome)';
  const lancarResposta = (p: PrecoCotado) => { setEd({ ...p, status: 'Cotado', data: hoje, observacao: [p.observacao, `Pedido de cotação feito em ${fmtData(p.data)}.`].filter(Boolean).join(' ') }); setErro(''); globalThis.scrollTo?.({ top: 0, behavior: 'smooth' }); };

  async function lerArquivo(arq: File | undefined) {
    setPlano(null); setErroCarga('');
    if (!arq) return;
    const r = lerCargaPrecos(await arq.text());
    if (r.erro || !r.carga) return setErroCarga(r.erro ?? 'Arquivo inválido.');
    setPlano(planejarCargaPrecos(d.precos, r.carga, d.materiais));
  }
  async function confirmarCarga() {
    if (!plano) return;
    await salvar('precos', ...plano.novos);
    setAviso(`${plano.novos.length} cotação(ões) importada(s).`);
    setPlano(null);
  }

  async function gravar() {
    if (!ed) return;
    const p = { ...ed, modelo: ed.modelo.trim(), fornecedor: ed.fornecedor.trim() };
    if (!p.fornecedor) return setErro('Informe o fornecedor.');
    if (!p.modelo && !p.descricao.trim()) return setErro('Informe o modelo ou a descrição.');
    if (p.status !== 'Aguardando' && !(p.precoUnitario > 0)) return setErro('Informe o preço unitário (líquido, sem IPI), ou deixe a situação como “Aguardando”.');
    if (!(p.quantidade > 0)) return setErro('Quantidade inválida.');
    if (p.status !== 'Aguardando' && p.validade && p.validade < p.data) return setErro('A validade é anterior à data da cotação.');
    await salvar('precos', { ...p, materialId: p.materialId ?? materialPorModelo.get(chaveModelo(p.modelo))?.id ?? null });
    setEd(null); setErro('');
  }

  async function gerarPedido(ref: PrecoCotado) {
    // todos os itens da mesma proposta do mesmo fornecedor entram no pedido (a proposta vale para o conjunto)
    const mesma = ref.oferta ? d.precos.filter((x) => x.fornecedor === ref.fornecedor && x.oferta === ref.oferta && x.status === 'Cotado' && situacaoValidade(x, hoje).situacao !== 'vencida') : [ref];
    const p = pedidoDaOferta(proximoNumeroCompra(d.compras), mesma.length ? mesma : [ref], hoje);
    await salvar('compras', p);
    ir(`compra/${p.id}`);
  }

  async function usarPrecoVenda(m: Material, preco: number) {
    if (!confirm(`Definir o preço de venda de "${m.descricao}" em ${fmtR(preco)}? (hoje: ${fmtR(m.precoVenda) || 'sem preço'})`)) return;
    await salvar('materiais', { ...m, precoVenda: preco });
    setAviso(`Preço de venda de "${m.descricao}" atualizado para ${fmtR(preco)}.`);
  }

  const campo = (k: 'modelo' | 'codigoFornecedor' | 'fabricante' | 'ncm' | 'oferta' | 'faturadoPor' | 'pagamento' | 'unidade', rot: string, ph = '') => (
    <div><label>{rot}</label><input value={ed![k]} placeholder={ph} onInput={(e) => setEd({ ...ed!, [k]: e.currentTarget.value })} /></div>
  );

  return (
    <>
      <div class="busca"><input type="search" placeholder="Buscar modelo, descrição, fabricante, fornecedor ou nº da proposta" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} /></div>
      <div class="chips">
        {([['todos', 'Todos'], ['aguardando', 'Aguardando resposta'], ['vigentes', 'Com cotação vigente'], ['vencendo', 'Vence em 7 dias'], ['sem-vigente', 'Sem cotação vigente'], ['sem-venda', 'Sem preço de venda']] as [Filtro, string][]).map(([f, rot]) => (
          <button key={f} class={`chip peq ${filtro === f ? 'sel' : ''}`} onClick={() => setFiltro(f)}>{rot} ({conta(f)})</button>
        ))}
      </div>

      <div class="cartao">
        <b>Regras de custo e venda</b>
        <div class="grade2" style="margin-top:6px">
          <div><label>Margem líquida desejada (%)</label>
            <CampoValor valor={Math.round(params.venda.margemAlvo * 1000) / 10} aoMudar={(v) => mudarParams({ ...params, venda: { ...params.venda, margemAlvo: (v ?? 0) / 100 } })} /></div>
          <div><label>Impostos e taxas sobre a venda (%)</label>
            <CampoValor valor={Math.round(params.venda.impostoVenda * 1000) / 10} ph="0" aoMudar={(v) => mudarParams({ ...params, venda: { ...params.venda, impostoVenda: (v ?? 0) / 100 } })} /></div>
        </div>
        <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" style="flex:0" checked={params.creditaIpi} onChange={(e) => mudarParams({ ...params, creditaIpi: e.currentTarget.checked })} /> Aproveito o crédito do IPI (o IPI não entra no custo)</label>
        <p class="peq" style="margin:4px 0 0">Custo = preço líquido + IPI + ICMS-ST + frete. ICMS, PIS e COFINS já vêm dentro do preço líquido. Margem e preço sugerido são sobre o preço de venda, depois dos impostos da venda. Confirme o regime tributário com o contador; estes números ficam só neste aparelho.</p>
      </div>

      <div class="fila" style="margin:8px 0">
        <span class="peq">{lista.length} de {grupos.length} produtos · {d.precos.filter((p) => !p.excluidoEm).length} cotações</span>
        <label class="botao" style="flex:0;white-space:nowrap;cursor:pointer">Importar JSON
          <input type="file" accept=".json,application/json" style="display:none" onChange={(e) => { void lerArquivo(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label>
        {demandas.length > 0 && (
          <select style="max-width:240px" value={demanda} onChange={(e) => setDemanda(e.currentTarget.value)}>
            <option value="">Todas as demandas</option>
            {demandas.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <button style="flex:0;white-space:nowrap" onClick={() => { setEd(novoPreco({ status: 'Aguardando', demanda })); setErro(''); }}>+ Aguardando resposta</button>
        <button class="primario" style="flex:0;white-space:nowrap" onClick={() => { setEd(novoPreco({ demanda })); setErro(''); }}>+ Cotação</button>
      </div>
      {aviso && <div class="sucesso">{aviso}</div>}
      {erroCarga && <div class="erro">{erroCarga}</div>}
      {plano && (
        <div class="cartao">
          <b>Carga de cotações</b>
          <p>{plano.novos.length} novas · {plano.iguais} já cadastradas (mesma proposta, fornecedor e modelo)</p>
          {plano.novos.length > 0 && (
            <ul class="peq" style="margin:4px 0;padding-left:18px">{plano.novos.map((p) => <li key={p.id}>{p.modelo || p.descricao} · {p.fornecedor} · {fmtR(p.precoUnitario)} + IPI {p.ipiPct}% = custo {fmtR(custoUnitario(p, o))}</li>)}</ul>
          )}
          {plano.avisos.length > 0 && <details open><summary class="peq">{plano.avisos.length} avisos</summary><ul class="peq" style="margin:4px 0;padding-left:18px">{plano.avisos.map((a, k) => <li key={k}>{a}</li>)}</ul></details>}
          <div class="fila">
            <button class="primario" disabled={!plano.novos.length} onClick={confirmarCarga}>{plano.novos.length ? 'Confirmar importação' : 'Nada para importar'}</button>
            <button style="flex:0" onClick={() => setPlano(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {pendentes.length > 0 && (
        <div class="cartao">
          <b>Aguardando resposta ({pendentes.length})</b>
          <table class="tabela" style="margin-top:6px">
            <thead><tr><th>Fornecedor</th><th>Produto</th><th>Demanda</th><th>Pedida em</th><th></th></tr></thead>
            <tbody>{pendentes.filter(({ preco }) => !demanda || preco.demanda === demanda).map(({ preco: p, dias }) => (
              <tr key={p.id}>
                <td>{p.fornecedor}</td>
                <td>{nomeGrupo(p)}{p.modelo && p.descricao && <div class="peq">{p.descricao}</div>}{p.quantidade > 1 && <div class="peq">{p.quantidade} {p.unidade}</div>}</td>
                <td class="peq">{p.demanda}</td>
                <td>{fmtData(p.data)}<div class="peq" style={dias >= 3 ? 'color:#8a6d00' : ''}>{dias === 0 ? 'hoje' : `há ${dias} dia${dias === 1 ? '' : 's'}`}</div></td>
                <td style="white-space:nowrap"><button class="primario" onClick={() => lancarResposta(p)}>Lançar resposta</button>{' '}<button onClick={async () => { await salvar('precos', { ...p, status: 'Descartado', observacao: [p.observacao, 'Sem resposta / não vai cotar.'].filter(Boolean).join(' ') }); }}>Não respondeu</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {ed && (
        <div class="cartao">
          <b>{ed.status === 'Aguardando' ? 'Pedido de cotação aguardando resposta' : d.precos.some((p) => p.id === ed.id) ? 'Editar cotação' : 'Nova cotação'}</b>
          <div class="grade2" style="margin-top:6px">
            <div><label>Fornecedor *</label>
              <input list="lista-fornecedores-preco" value={ed.fornecedor} onInput={(e) => setEd({ ...ed, fornecedor: e.currentTarget.value })} />
              <datalist id="lista-fornecedores-preco">{d.fornecedores.map((f) => <option key={f.id} value={f.nome} />)}</datalist></div>
            <div><label>Demanda (obra ou cliente)</label>
              <input list="lista-demandas-preco" value={ed.demanda ?? ''} placeholder="ex.: BNG – pontes rolantes" onInput={(e) => setEd({ ...ed, demanda: e.currentTarget.value })} />
              <datalist id="lista-demandas-preco">{demandas.map((x) => <option key={x} value={x} />)}</datalist></div>
            {campo('faturadoPor', 'Quem fatura (se for outro)', 'ex.: fábrica, matriz')}
            {campo('modelo', 'Modelo / part number *', 'ex.: CFW500D24P0T4DB20G2')}
            {campo('codigoFornecedor', 'Código no fornecedor')}
            <div><label>Descrição</label><input value={ed.descricao} onInput={(e) => setEd({ ...ed, descricao: e.currentTarget.value })} /></div>
            {campo('fabricante', 'Fabricante')}
            {campo('ncm', 'NCM')}
            <div><label>Produto do estoque</label>
              <select value={ed.materialId ?? ''} onChange={(e) => setEd({ ...ed, materialId: e.currentTarget.value || null })}>
                <option value="">— (automático pelo modelo)</option>
                {[...d.materiais].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')).map((m) => <option key={m.id} value={m.id}>{m.descricao} · {m.modelo}</option>)}
              </select></div>
            {campo('oferta', 'Nº da proposta', 'ex.: 240356924 rev. 0')}
            <div><label>Data da cotação</label><input type="date" value={ed.data} onInput={(e) => setEd({ ...ed, data: e.currentTarget.value })} /></div>
            <div><label>Válida até</label><input type="date" value={ed.validade ?? ''} onInput={(e) => setEd({ ...ed, validade: e.currentTarget.value || null })} /></div>
            <div><label>Quantidade cotada</label><CampoValor valor={ed.quantidade} aoMudar={(v) => setEd({ ...ed, quantidade: v ?? 0 })} /></div>
            {campo('unidade', 'Unidade')}
            <div><label>Preço unitário líquido (R$, sem IPI){ed.status === 'Aguardando' ? '' : ' *'}</label><CampoValor valor={ed.precoUnitario || null} aoMudar={(v) => setEd({ ...ed, precoUnitario: v ?? 0 })} /></div>
            <div><label>IPI (%) — não incluso</label><CampoValor valor={ed.ipiPct || null} ph="0" aoMudar={(v) => setEd({ ...ed, ipiPct: v ?? 0 })} /></div>
            <div><label>ICMS (%) — já incluso, informativo</label><CampoValor valor={ed.icmsPct} aoMudar={(v) => setEd({ ...ed, icmsPct: v })} /></div>
            <div><label>ICMS-ST por unidade (R$)</label><CampoValor valor={ed.stUnitario || null} ph="0" aoMudar={(v) => setEd({ ...ed, stUnitario: v ?? 0 })} /></div>
            <div><label>Frete</label>
              <select value={ed.freteTipo} onChange={(e) => setEd({ ...ed, freteTipo: e.currentTarget.value as TipoFrete })}>
                {TIPOS_FRETE.map((t) => <option key={t} value={t}>{t || '(não informado)'}</option>)}
              </select></div>
            <div><label>Frete por unidade (R$) — se FOB, estimativa</label><CampoValor valor={ed.freteUnitario || null} ph="0" aoMudar={(v) => setEd({ ...ed, freteUnitario: v ?? 0 })} /></div>
            {campo('pagamento', 'Pagamento', 'ex.: Antecipado, 28 dias')}
            <div><label>Prazo de entrega (dias)</label><CampoValor valor={ed.prazoDias} aoMudar={(v) => setEd({ ...ed, prazoDias: v })} /></div>
            <div><label>Situação</label>
              <select value={ed.status} onChange={(e) => setEd({ ...ed, status: e.currentTarget.value as StatusPreco })}>
                {STATUS_PRECO.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
          </div>
          <label>Observação</label><textarea value={ed.observacao} onInput={(e) => setEd({ ...ed, observacao: e.currentTarget.value })} />
          {ed.precoUnitario > 0 && <p class="peq" style="margin:6px 0 0">IPI {fmtR(ipiUnitario(ed))} · custo por unidade <b>{fmtR(custoUnitario(ed, o))}</b> · total da cotação <b>{fmtR(custoTotal(ed, o))}</b></p>}
          {erro && <div class="erro">{erro}</div>}
          <div class="fila" style="margin-top:8px">
            <button class="primario" onClick={gravar}>Salvar</button>
            <button style="flex:0" onClick={() => { setEd(null); setErro(''); }}>Cancelar</button>
            {d.precos.some((p) => p.id === ed.id) && <button class="perigo" style="flex:0" onClick={async () => { if (confirm('Excluir esta cotação?')) { await excluir('precos', ed.id); setEd(null); } }}>Excluir</button>}
          </div>
        </div>
      )}

      <div class="cartao" style="overflow-x:auto">
        {lista.length === 0 ? <span class="peq">{grupos.length ? 'Nenhum produto com esse filtro.' : 'Nenhuma cotação ainda. Use “+ Cotação” ou importe o JSON gerado a partir da proposta do fornecedor.'}</span> : (
          <table class="tabela">
            <thead><tr>
              <th>Produto</th><th>Melhor cotação vigente</th><th style="text-align:right">Líquido</th><th style="text-align:right">Custo c/ IPI e frete</th>
              <th>Validade</th><th style="text-align:right">Último custo (NF-e)</th><th style="text-align:right">Venda hoje</th><th style="text-align:right">Margem</th><th style="text-align:right">Venda mínima</th><th style="text-align:right">Venda sugerida</th>
            </tr></thead>
            <tbody>{lista.flatMap((g) => {
              const m = materialDe(g);
              const b = g.melhor;
              const custo = b ? custoUnitario(b, o) : null;
              const v = b ? situacaoValidade(b, hoje) : null;
              const mg = custo !== null ? margemLiquida(m?.precoVenda, custo, params.venda.impostoVenda) : null;
              const nivel = custo !== null ? nivelVenda(m?.precoVenda, custo, params.venda) : 'sem-preco';
              const piso = custo !== null ? precoPiso(custo, params.venda.impostoVenda) : null;
              const sug = custo !== null ? precoSugerido(custo, params.venda) : null;
              const aberto = abertos.includes(g.chave);
              const linhas = [
                <tr key={g.chave} style="cursor:pointer" onClick={() => setAbertos(aberto ? abertos.filter((x) => x !== g.chave) : [...abertos, g.chave])}>
                  <td style="min-width:220px"><b>{g.modelo || '(sem modelo)'}</b>{g.fabricante && <span class="peq"> · {g.fabricante}</span>}<div class="peq">{g.descricao}</div>
                    <div class="peq">{g.ofertas.length} cotaç{g.ofertas.length === 1 ? 'ão' : 'ões'}{g.vigentes ? ` · ${g.vigentes} vigente${g.vigentes > 1 ? 's' : ''}` : ''}{g.aguardando ? ` · aguardando ${g.aguardando}` : ''} {aberto ? '▾' : '▸'}{m ? ' · no cadastro' : ''}</div>{g.demandas.length > 0 && <div class="peq">{g.demandas.join(' · ')}</div>}</td>
                  <td>{b ? <>{b.fornecedor}<div class="peq">{b.pagamento}{b.freteTipo ? ` · frete ${b.freteTipo}` : ''}{b.prazoDias ? ` · ${b.prazoDias} d` : ''}</div></> : <span class="peq" style="color:#8a6d00">{g.aguardando ? `aguardando ${g.aguardando} resposta${g.aguardando > 1 ? 's' : ''}` : 'sem cotação vigente'}</span>}</td>
                  <td style="text-align:right">{b ? <>{fmtR(b.precoUnitario)}<div class="peq">IPI {String(b.ipiPct).replace('.', ',')}%</div></> : ''}</td>
                  <td style="text-align:right"><b>{fmtR(custo)}</b></td>
                  <td>{b && v ? <>{fmtData(b.validade)}<div class="peq" style={v.situacao === 'vence-logo' ? 'color:#8a6d00' : ''}>{v.dias === null ? 'sem validade' : v.dias === 0 ? 'vence hoje' : `${v.dias} dia${v.dias === 1 ? '' : 's'}`}</div></> : ''}</td>
                  <td style="text-align:right">{fmtR(m?.precoCompra)}</td>
                  <td style="text-align:right">{fmtR(m?.precoVenda)}{!m && <div class="peq">cadastre o produto</div>}</td>
                  <td style={`text-align:right;${nivel === 'prejuizo' ? 'color:var(--perigo);font-weight:600' : nivel === 'abaixo-da-meta' ? 'color:#8a6d00' : ''}`}>{fmtPct(mg)}{nivel === 'prejuizo' && <div class="peq">abaixo do custo</div>}{nivel === 'abaixo-da-meta' && <div class="peq">abaixo da meta</div>}</td>
                  <td style="text-align:right">{fmtR(piso)}</td>
                  <td style="text-align:right"><b>{fmtR(sug)}</b>{m && sug !== null && sug !== m.precoVenda && (
                    <div><button class="peq" onClick={(e) => { e.stopPropagation(); void usarPrecoVenda(m, sug); }}>usar</button></div>
                  )}</td>
                </tr>,
              ];
              if (aberto) {
                linhas.push(
                  <tr key={`${g.chave}-of`}><td colSpan={10} style="background:var(--fundo-suave, #f6f7f6)">
                    <table class="tabela">
                      <thead><tr><th>Fornecedor</th><th>Proposta</th><th>Data / validade</th><th style="text-align:right">Qtd</th><th style="text-align:right">Líquido</th><th style="text-align:right">IPI</th><th style="text-align:right">Custo unit.</th><th>Condições</th><th>Situação</th><th></th></tr></thead>
                      <tbody>{g.ofertas.map((x, i) => {
                        const sv = situacaoValidade(x, hoje);
                        if (x.status === 'Aguardando') {
                          const dias = Math.max(0, Math.round((Date.parse(hoje) - Date.parse(x.data)) / 86400000));
                          return (
                            <tr key={x.id}>
                              <td>{x.fornecedor}</td><td colSpan={2}>Pedido em {fmtData(x.data)}<div class="peq">{dias === 0 ? 'hoje' : `há ${dias} dia${dias === 1 ? '' : 's'}`}, sem resposta</div></td>
                              <td style="text-align:right">{x.quantidade} {x.unidade}</td><td colSpan={4} class="peq">{x.observacao}</td>
                              <td><span class="selo status-Enviado">Aguardando</span></td>
                              <td style="white-space:nowrap"><button class="primario" onClick={() => lancarResposta(x)}>Lançar resposta</button></td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={x.id} style={x.status === 'Descartado' || sv.situacao === 'vencida' ? 'opacity:.6' : ''}>
                            <td>{x.fornecedor}{i === 0 && x === b && <span class="selo status-Aprovado" style="margin-left:4px">menor custo</span>}{x.faturadoPor && <div class="peq">fatura: {x.faturadoPor}</div>}</td>
                            <td>{x.oferta}<div class="peq">{x.codigoFornecedor}</div></td>
                            <td>{fmtData(x.data)}<div class="peq" style={sv.situacao === 'vencida' ? 'color:var(--perigo)' : sv.situacao === 'vence-logo' ? 'color:#8a6d00' : ''}>{x.validade ? `até ${fmtData(x.validade)}${sv.situacao === 'vencida' ? ' (vencida)' : ''}` : 'sem validade'}</div></td>
                            <td style="text-align:right">{x.quantidade} {x.unidade}</td>
                            <td style="text-align:right">{fmtR(x.precoUnitario)}</td>
                            <td style="text-align:right">{String(x.ipiPct).replace('.', ',')}%<div class="peq">{fmtR(ipiUnitario(x))}</div></td>
                            <td style="text-align:right"><b>{fmtR(custoUnitario(x, o))}</b>{x.quantidade > 1 && <div class="peq">total {fmtR(custoTotal(x, o))}</div>}</td>
                            <td class="peq">{[x.pagamento, x.freteTipo && `frete ${x.freteTipo}${x.freteUnitario ? ` ${fmtR(x.freteUnitario)}` : ''}`, x.prazoDias && `entrega ${x.prazoDias} d`].filter(Boolean).join(' · ')}</td>
                            <td><span class={`selo status-${x.status === 'Comprado' ? 'Aprovado' : x.status === 'Descartado' ? 'Recusado' : 'Enviado'}`}>{x.status}</span></td>
                            <td style="white-space:nowrap">
                              <button onClick={() => { setEd(x); setErro(''); }}>Editar</button>{' '}
                              {x.status === 'Cotado' && sv.situacao !== 'vencida' && <button onClick={() => gerarPedido(x)}>Gerar pedido</button>}
                            </td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </td></tr>,
                );
              }
              return linhas;
            })}</tbody>
          </table>
        )}
      </div>
      <p class="peq">Cotação vencida não entra na comparação (continua no histórico). “Gerar pedido” cria um rascunho em Pedidos de compra com os itens da proposta e as condições combinadas; o preço de compra do produto só muda quando a NF-e entra pelo WMS (aí o “Último custo” passa a ser o real). Para vender, a coluna “Venda mínima” é o piso sem prejuízo e “Venda sugerida” entrega a margem desejada.</p>
    </>
  );
}
