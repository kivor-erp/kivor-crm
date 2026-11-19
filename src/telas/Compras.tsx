import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CampoValor, Topo } from '../componentes';
import { EMISSOR } from '../config';
import { excluir, salvar } from '../db';
import {
  fornecedoresDoTipo, lerTipos, novoFornecedor, novoItemCompra, novoPedidoCompra, pedidoDoOrcamento, proximoNumeroCompra, totalCompra, totalItemCompra,
  validarFornecedor, validarPedido,
} from '../lib/compras';
import { fmtData } from '../lib/datas';
import { nomeMaterial } from '../lib/estoque';
import { STATUS_COMPRA, nomeEmpresa, type Fornecedor, type PedidoCompra, type StatusCompra } from '../lib/model';
import { normalizar } from '../lib/texto';
import { fmtCnpj } from '../lib/unidades';
import { CATEGORIAS, nomeCategoria } from '../lib/catalogoCompras';
import { estaNoES } from '../lib/buscaFornecedor';
import { lerCarga, planejarCarga, type PlanoCarga } from '../lib/cargaFornecedores';
import { emailCotacao } from '../lib/cotacao';
import { ir, useDados, voltar } from '../store';

// Compras: pedidos (ordens) de compra a fornecedores, ligados ao orçamento do cliente que os originou.

const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const COR: Record<StatusCompra, string> = { Rascunho: 'Rascunho', 'Em cotação': 'Enviado', Enviado: 'Enviado', Recebido: 'Aprovado', Cancelado: 'Recusado' };

export function Compras() {
  const d = useDados();
  const [status, setStatus] = useState<StatusCompra | ''>('');
  const [busca, setBusca] = useState('');
  const [orc, setOrc] = useState('');
  const lista = useMemo(() => {
    const t = normalizar(busca);
    return d.compras.filter((p) => (!status || p.status === status) && (!t || normalizar(`${p.numero} ${p.fornecedor} ${p.observacao} ${p.itens.map((i) => i.descricao).join(' ')}`).includes(t)))
      .sort((a, b) => b.data.localeCompare(a.data) || b.numero.localeCompare(a.numero));
  }, [d.compras, status, busca]);
  const abertos = d.compras.filter((p) => p.status === 'Em cotação' || p.status === 'Enviado').reduce((s, p) => s + totalCompra(p), 0);

  return (
    <>
      <div class="busca"><input type="search" placeholder="Buscar número, fornecedor ou item" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} /></div>
      <div class="chips">
        {STATUS_COMPRA.map((s) => <button key={s} class={`chip peq ${status === s ? 'sel' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>{s}</button>)}
      </div>
      <div class="fila" style="margin:8px 0">
        <span class="peq">{lista.length} pedidos{abertos ? ` · ${fmtR(abertos)} em aberto` : ''}</span>
        <select style="max-width:280px" value={orc} onChange={(e) => setOrc(e.currentTarget.value)}>
          <option value="">A partir de um orçamento…</option>
          {d.orcamentos.filter((o) => o.status !== 'Recusado').map((o) => <option key={o.id} value={o.id}>{o.numero} · {o.cliente}</option>)}
        </select>
        <button style="flex:0" disabled={!orc} onClick={() => ir(`compra/novo?orcamento=${orc}`)}>Gerar pedido</button>
        <button class="primario" style="flex:0" onClick={() => ir('compra/novo')}>+ Pedido de compra</button>
      </div>
      <div class="cartao" style="overflow-x:auto">
        {lista.length === 0 ? <span class="peq">Nenhum pedido de compra{status || busca ? ' com esse filtro' : ' ainda'}.</span> : (
          <table class="tabela">
            <thead><tr><th>Número</th><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Para</th><th>Status</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>{lista.map((p) => {
              const o = p.orcamentoId ? d.orcamentos.find((x) => x.id === p.orcamentoId) : undefined;
              return (
                <tr key={p.id} style="cursor:pointer" onClick={() => ir(`compra/${p.id}`)}>
                  <td><a href={`#/compra/${p.id}`}>{p.numero}</a></td><td>{fmtData(p.data)}</td><td>{p.fornecedor || <span class="peq">a definir</span>}</td>
                  <td>{p.itens.filter((i) => i.descricao.trim()).length}</td><td>{o ? `${o.numero} · ${o.cliente}` : '—'}</td>
                  <td><span class={`selo status-${COR[p.status]}`}>{p.status}</span></td>
                  <td style="text-align:right">{totalCompra(p) ? fmtR(totalCompra(p)) : <span class="peq">a cotar</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      <p class="peq">Quando o material chegar, lance a entrada pelo XML da NF-e em WMS › Entrada; ela grava o preço de compra no estoque.</p>
    </>
  );
}

export function CompraTela({ id, orcamentoId }: { id: string; orcamentoId: string | null }) {
  const d = useDados();
  const criado = useRef(false);
  useEffect(() => {
    if (id !== 'novo' || criado.current || !d.pronto) return;
    criado.current = true;
    const o = orcamentoId ? d.orcamentos.find((x) => x.id === orcamentoId) : undefined;
    const numero = proximoNumeroCompra(d.compras);
    const p = o ? pedidoDoOrcamento(numero, o) : novoPedidoCompra(numero);
    void salvar('compras', p).then(() => location.replace(`#/compra/${p.id}`));
  }, [id, d.pronto]);
  if (!d.pronto || id === 'novo') return null;
  const p = d.compras.find((x) => x.id === id);
  if (!p) return <><Topo titulo="Pedido de compra" voltar={() => voltar('compras')} /><main><div class="vazio">Pedido não encontrado.</div></main></>;
  return <EditorCompra key={p.id} inicial={p} />;
}

function EditorCompra({ inicial }: { inicial: PedidoCompra }) {
  const d = useDados();
  const [p, setP] = useState(inicial);
  const [erros, setErros] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const mudou = JSON.stringify({ ...p, atualizadoEm: 0 }) !== JSON.stringify({ ...inicial, atualizadoEm: 0 });
  const mudarItem = (k: number, x: Partial<PedidoCompra['itens'][number]>) => setP({ ...p, itens: p.itens.map((i, j) => (j === k ? { ...i, ...x } : i)) });
  const campo = (k: 'fornecedor' | 'fornecedorCnpj' | 'fornecedorContato' | 'condicoes', rot: string, ph = '') => (
    <div><label>{rot}</label><input value={p[k]} placeholder={ph} onInput={(e) => setP({ ...p, [k]: e.currentTarget.value })} /></div>
  );
  const materiais = useMemo(() => [...d.materiais].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')), [d.materiais]);
  const orc = p.orcamentoId ? d.orcamentos.find((x) => x.id === p.orcamentoId) : undefined;

  async function gravar(status?: StatusCompra) {
    const novo = { ...p, status: status ?? p.status, itens: p.itens.filter((i, k) => i.descricao.trim() || k === 0) };
    if (status === 'Enviado') {
      const e = validarPedido(novo);
      setErros(e);
      if (e.length) return;
    }
    await salvar('compras', novo);
    setP(novo); setMsg(status ? `Pedido marcado como "${status}".` : 'Pedido salvo.');
  }

  return (
    <>
      <Topo titulo={`Pedido de compra ${p.numero}`} voltar={() => voltar('compras')} />
      <main>
        <div class="cartao">
          <div class="fila">
            <span class={`selo status-${COR[p.status]}`} style="flex:0">{p.status}</span>
            <span class="peq">{fmtData(p.data)}{orc ? ` · para o orçamento ${orc.numero} (${orc.cliente})` : ''}</span>
          </div>
          <div class="grade2">
            <div><label>Fornecedor * <a href="#/fornecedores" class="peq">(cadastro)</a></label>
              <input list="lista-fornecedores" value={p.fornecedor} placeholder="ex.: distribuidor WEG" onInput={(e) => {
                const nome = e.currentTarget.value;
                const f = d.fornecedores.find((x) => x.nome === nome);
                setP(f ? { ...p, fornecedor: f.nome, fornecedorCnpj: f.cnpj ? fmtCnpj(f.cnpj) : p.fornecedorCnpj, fornecedorContato: [f.telefone, f.email].filter(Boolean).join(' · ') || p.fornecedorContato } : { ...p, fornecedor: nome });
              }} />
              <datalist id="lista-fornecedores">{d.fornecedores.map((f) => <option key={f.id} value={f.nome}>{f.tipos.join(', ')}</option>)}</datalist></div>
            {campo('fornecedorCnpj', 'CNPJ do fornecedor')}
            {campo('fornecedorContato', 'Contato (vendedor, telefone, e-mail)')}
            <div><label>Previsão de entrega</label><input type="date" value={p.previsaoEntrega ?? ''} onInput={(e) => setP({ ...p, previsaoEntrega: e.currentTarget.value || null })} /></div>
            {campo('condicoes', 'Pagamento e frete', 'ex.: 28 dias, CIF')}
            <div><label>Status</label>
              <select value={p.status} onChange={(e) => setP({ ...p, status: e.currentTarget.value as StatusCompra })}>
                {STATUS_COMPRA.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
          </div>
          <label>Observação</label><textarea value={p.observacao} onInput={(e) => setP({ ...p, observacao: e.currentTarget.value })} />
        </div>

        <h2>Itens</h2>
        <div class="cartao" style="overflow-x:auto">
          <table class="tabela">
            <thead><tr><th>Descrição</th><th>Cód. fornecedor</th><th>Item do estoque</th><th>Un</th><th>Qtd</th><th>Custo unit. (R$)</th><th style="text-align:right">Total</th><th></th></tr></thead>
            <tbody>{p.itens.map((i, k) => (
              <tr key={k}>
                <td style="min-width:260px;width:42%"><textarea rows={3} value={i.descricao} onInput={(e) => mudarItem(k, { descricao: e.currentTarget.value })} /></td>
                <td style="min-width:120px"><input value={i.codigo} onInput={(e) => mudarItem(k, { codigo: e.currentTarget.value })} /></td>
                <td style="min-width:160px">
                  <select value={i.materialId ?? ''} onChange={(e) => mudarItem(k, { materialId: e.currentTarget.value || null })}>
                    <option value="">— (item novo)</option>
                    {materiais.map((m) => <option key={m.id} value={m.id}>{nomeMaterial(m)} · {m.modelo}</option>)}
                  </select></td>
                <td style="width:60px"><input value={i.unidade} onInput={(e) => mudarItem(k, { unidade: e.currentTarget.value })} /></td>
                <td style="width:80px"><CampoValor valor={i.quantidade} aoMudar={(v) => mudarItem(k, { quantidade: v ?? 0 })} /></td>
                <td style="width:110px"><CampoValor valor={i.valorUnitario || null} ph="a cotar" aoMudar={(v) => mudarItem(k, { valorUnitario: v ?? 0 })} /></td>
                <td style="text-align:right;white-space:nowrap">{i.valorUnitario ? fmtR(totalItemCompra(i)) : '—'}</td>
                <td><button onClick={() => setP({ ...p, itens: p.itens.filter((_, j) => j !== k) })}>×</button></td>
              </tr>
            ))}</tbody>
            <tfoot><tr style="font-weight:600"><td colSpan={6}>Total</td><td style="text-align:right">{totalCompra(p) ? fmtR(totalCompra(p)) : 'a cotar'}</td><td></td></tr></tfoot>
          </table>
          <button style="margin-top:6px" onClick={() => setP({ ...p, itens: [...p.itens, novoItemCompra()] })}>+ Item</button>
        </div>

        {erros.length > 0 && <div class="erro"><ul style="margin:0;padding-left:18px">{erros.map((e) => <li key={e}>{e}</li>)}</ul></div>}
        {msg && <div class="sucesso">{msg}</div>}
        <div class="fila" style="margin-top:10px">
          <button class="primario" disabled={!mudou} onClick={() => gravar()}>Salvar</button>
          {p.status !== 'Enviado' && p.status !== 'Recebido' && <button onClick={() => gravar('Enviado')}>Marcar como enviado ao fornecedor</button>}
          {p.status === 'Enviado' && <button onClick={() => ir('entradas')}>Chegou: lançar NF-e</button>}
          <button onClick={async () => { if (mudou) await gravar(); ir(`imprimir-compra/${p.id}`); }}>🖨 Imprimir pedido</button>
          <button class="perigo" style="flex:0" onClick={async () => { if (confirm(`Excluir o pedido ${p.numero}?`)) { await excluir('compras', p.id); ir('compras'); } }}>Excluir</button>
        </div>
      </main>
    </>
  );
}

export function ImprimirCompra({ id }: { id: string }) {
  const d = useDados();
  const p = d.compras.find((x) => x.id === id);
  useEffect(() => { document.title = p ? `${p.numero} – ${p.fornecedor}` : 'Pedido de compra'; return () => { document.title = 'KIVOR-CRM'; }; }, [p?.id]);
  if (!d.pronto) return null;
  if (!p) return <main><div class="vazio">Pedido não encontrado.</div></main>;
  const u = d.unidades.find((x) => x.id === p.unidadeId) ?? d.unidade;
  const em = u ? { nome: u.razaoSocial || u.nome, cnpj: fmtCnpj(u.cnpj), telefone: u.telefone, email: u.email, cidade: u.cidade } : EMISSOR;
  const cliente = p.empresaId ? d.porId.get(p.empresaId) : undefined;
  const itens = p.itens.filter((i) => i.descricao.trim());
  return (
    <div class="impressao">
      <div class="barra-impressao">
        <button onClick={() => voltar(`compra/${p.id}`)}>← Voltar</button>
        <button class="primario" onClick={() => print()}>🖨 Imprimir / salvar em PDF</button>
      </div>
      <table class="doc">
        <thead><tr><td><div class="doc-topo"><span class="doc-marca">{em.nome}</span><span class="doc-cnpj">CNPJ {em.cnpj}</span></div></td></tr></thead>
        <tfoot><tr><td><div class="doc-rodape">{[em.telefone, em.email, em.cidade].filter(Boolean).join(' · ')}</div></td></tr></tfoot>
        <tbody><tr><td class="doc-corpo">
          <p class="doc-data">{em.cidade ? `${em.cidade}, ` : ''}{fmtData(p.data)}</p>
          <h1 class="doc-titulo">Pedido de compra</h1>
          <div class="doc-subtitulo">Nº {p.numero}</div>
          <div class="doc-linha" />
          <p class="doc-cab"><b>Fornecedor:</b> {p.fornecedor || 'a definir'}{p.fornecedorCnpj ? ` · CNPJ ${p.fornecedorCnpj}` : ''}{p.fornecedorContato ? ` · ${p.fornecedorContato}` : ''}</p>
          <table class="doc-itens">
            <thead><tr><th>Item</th><th>Descrição</th><th>Código</th><th>Qtd</th><th>Valor unit.</th><th>Total</th></tr></thead>
            <tbody>{itens.map((i, k) => (
              <tr key={k}><td>{k + 1}</td><td style="white-space:pre-line">{i.descricao}</td><td>{i.codigo}</td><td>{fmtQ(i.quantidade)} {i.unidade}</td>
                <td>{i.valorUnitario ? fmtR(i.valorUnitario) : 'a cotar'}</td><td>{i.valorUnitario ? fmtR(totalItemCompra(i)) : '—'}</td></tr>
            ))}</tbody>
          </table>
          {totalCompra(p) > 0 && <p style="text-align:right;font-size:12pt"><b>Total: {fmtR(totalCompra(p))}</b></p>}
          {p.previsaoEntrega && <p><b>Previsão de entrega:</b> {fmtData(p.previsaoEntrega)}</p>}
          {p.condicoes && <p><b>Pagamento e frete:</b> {p.condicoes}</p>}
          {p.observacao && <p><b>Observação:</b> {p.observacao}</p>}
          {cliente && <p class="peq">Uso interno: atende {nomeEmpresa(cliente)}.</p>}
          <p>Favor enviar a nota fiscal com o número deste pedido e o XML da NF-e.</p>
        </td></tr></tbody>
      </table>
    </div>
  );
}

// ---------- fornecedores ----------

export function Fornecedores() {
  const d = useDados();
  const [ed, setEd] = useState<Fornecedor | null>(null);
  const [tiposTxt, setTiposTxt] = useState('');
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('');
  const [plano, setPlano] = useState<PlanoCarga | null>(null);
  const [erroCarga, setErroCarga] = useState('');
  const lista = fornecedoresDoTipo(d.fornecedores, filtro);
  const todosTipos = [...new Set(d.fornecedores.flatMap((f) => f.tipos))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const abrir = (f: Fornecedor) => { setEd(f); setTiposTxt(f.tipos.join('; ')); setErro(''); };

  async function lerArquivo(arq: File | undefined) {
    setPlano(null); setErroCarga('');
    if (!arq) return;
    const r = lerCarga(await arq.text());
    if (r.erro || !r.carga) return setErroCarga(r.erro ?? 'Arquivo inválido.');
    setPlano(planejarCarga(d.fornecedores, r.carga));
  }
  async function confirmarCarga() {
    if (!plano) return;
    await salvar('fornecedores', ...plano.novos, ...plano.atualizados);
    setPlano(null);
  }

  async function gravar() {
    if (!ed) return;
    const f = { ...ed, cnpj: ed.cnpj.replace(/\D/g, ''), whatsapp: (ed.whatsapp ?? '').replace(/\D/g, ''), tipos: lerTipos(tiposTxt) };
    const e = validarFornecedor(f, d.fornecedores);
    if (e) return setErro(e);
    await salvar('fornecedores', f);
    setEd(null);
  }
  const campo = (k: 'nome' | 'razaoSocial' | 'cnpj' | 'cidade' | 'endereco' | 'telefone' | 'email' | 'site' | 'marcas' | 'whatsapp' | 'emailCotacao' | 'fonte', rot: string, ph = '') => (
    <div><label>{rot}</label><input value={ed![k] ?? ''} placeholder={ph} onInput={(e) => setEd({ ...ed!, [k]: e.currentTarget.value })} /></div>
  );

  return (
    <>
      <div class="chips" style="margin-top:8px">
        <button class={`chip peq ${!filtro ? 'sel' : ''}`} onClick={() => setFiltro('')}>Todos</button>
        {todosTipos.map((t) => <button key={t} class={`chip peq ${filtro === t ? 'sel' : ''}`} onClick={() => setFiltro(filtro === t ? '' : t)}>{t}</button>)}
      </div>
      <div class="fila" style="margin:8px 0">
        <span class="peq">{lista.length} fornecedores (valem para todas as empresas do grupo)</span>
        <label class="botao" style="flex:0;white-space:nowrap;cursor:pointer">Importar JSON
          <input type="file" accept=".json,application/json" style="display:none" onChange={(e) => { void lerArquivo(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label>
        <button class="primario" style="flex:0" onClick={() => abrir(novoFornecedor())}>+ Fornecedor</button>
      </div>
      {erroCarga && <div class="erro">{erroCarga}</div>}
      {plano && (
        <div class="cartao">
          <b>Carga de fornecedores</b>
          <p>{plano.novos.length} novos · {plano.atualizados.length} a completar (só campos vazios e listas; o que você editou não muda) · {plano.iguais} já iguais</p>
          {plano.avisos.length > 0 && <details><summary class="peq">{plano.avisos.length} avisos</summary><ul class="peq" style="margin:4px 0;padding-left:18px">{plano.avisos.slice(0, 50).map((a, k) => <li key={k}>{a}</li>)}</ul></details>}
          <div class="fila">
            <button class="primario" disabled={!plano.novos.length && !plano.atualizados.length} onClick={confirmarCarga}>{plano.novos.length || plano.atualizados.length ? 'Confirmar importação' : 'Nada para importar'}</button>
            <button style="flex:0" onClick={() => setPlano(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {ed && (
        <div class="cartao">
          <div class="grade2">
            {campo('nome', 'Nome *')}{campo('razaoSocial', 'Razão social')}
            {campo('cnpj', 'CNPJ')}{campo('cidade', 'Cidade/UF', 'ex.: Serra/ES')}
            {campo('endereco', 'Endereço')}{campo('telefone', 'Telefone')}
            {campo('email', 'E-mail')}{campo('site', 'Site')}
            {campo('marcas', 'Marcas', 'ex.: WEG; Siemens; Intelbras')}
            {campo('whatsapp', 'WhatsApp comercial', 'DDD + número')}{campo('emailCotacao', 'E-mail de vendas/cotação')}
            {campo('fonte', 'Fonte da informação', 'site, catálogo, indicação')}
            <div><label>Tipos de equipamento que vende</label><input value={tiposTxt} placeholder="separe com ; (ex.: Inversores de frequência; Motores)" onInput={(e) => setTiposTxt(e.currentTarget.value)} /></div>
          </div>
          <label>Categorias de produto (usadas na busca da Cotação)</label>
          <div class="chips">{CATEGORIAS.map((c) => {
            const on = (ed.categorias ?? []).includes(c.id);
            return <button key={c.id} type="button" class={`chip peq ${on ? 'sel' : ''}`} onClick={() => setEd({ ...ed, categorias: on ? (ed.categorias ?? []).filter((x) => x !== c.id) : [...(ed.categorias ?? []), c.id] })}>{c.nome}</button>;
          })}</div>
          <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" style="flex:0" checked={!!ed.verificado} onChange={(e) => setEd({ ...ed, verificado: e.currentTarget.checked })} /> Contato verificado (telefone/CNPJ confirmados)</label>
          <label>Observação (fonte da informação, o que falta confirmar)</label>
          <textarea value={ed.observacao} onInput={(e) => setEd({ ...ed, observacao: e.currentTarget.value })} />
          {erro && <div class="erro">{erro}</div>}
          <div class="fila" style="margin-top:8px">
            <button class="primario" onClick={gravar}>Salvar</button>
            <button style="flex:0" onClick={() => setEd(null)}>Cancelar</button>
            {d.fornecedores.some((f) => f.id === ed.id) && <button class="perigo" style="flex:0" onClick={async () => { if (confirm(`Excluir ${ed.nome}?`)) { await excluir('fornecedores', ed.id); setEd(null); } }}>Excluir</button>}
          </div>
        </div>
      )}
      <div class="cartao" style="overflow-x:auto">
        {lista.length === 0 ? <span class="peq">Nenhum fornecedor{filtro ? ' desse tipo' : ''}.</span> : (
          <table class="tabela">
            <thead><tr><th>Fornecedor</th><th>Cidade</th><th>Vende</th><th>Contato</th><th></th></tr></thead>
            <tbody>{lista.map((f) => (
              <tr key={f.id}>
                <td>{f.nome}<div class="peq">{[f.razaoSocial, f.cnpj && fmtCnpj(f.cnpj)].filter(Boolean).join(' · ')}</div></td>
                <td>{f.cidade}{estaNoES(f) && <div><span class="selo status-Aprovado">ES</span></div>}</td>
                <td>{f.tipos.join(', ')}{f.marcas && <div class="peq">{f.marcas}</div>}{(f.categorias ?? []).length > 0 && <div class="peq">{(f.categorias ?? []).map(nomeCategoria).join(' · ')}</div>}</td>
                <td>{f.whatsapp || f.telefone}{f.verificado && <span class="peq"> ✓</span>}<div class="peq">{[emailCotacao(f), f.site].filter(Boolean).join(' · ')}</div></td>
                <td><button onClick={() => abrir(f)}>Editar</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
