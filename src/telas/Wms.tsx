import { useEffect, useMemo, useState } from 'preact/hooks';
import { token } from '../auth';
import { CampoValor, Topo } from '../componentes';
import { EMISSOR } from '../config';
import { excluir, salvar } from '../db';
import { fmtData, fmtDataHora } from '../lib/datas';
import { nomeMaterial } from '../lib/estoque';
import { nomeEmpresa, type Embalagem, type Material, type Recibo } from '../lib/model';
import { lerNfe, notaJaLancada, planejarEntradaNfe, sugerirMaterial, type DestinoItem, type Nfe } from '../lib/nfe';
import { itemDoMaterial, movimentosDoRecibo, novoRecibo, proximoNumeroRecibo, totalRecibo, validarRecibo } from '../lib/recibos';
import { normalizar, soDigitos } from '../lib/texto';
import { fmtCnpj } from '../lib/unidades';
import { guardarArquivo } from '../onedrive';
import { ir, useDados, voltar } from '../store';

// WMS: entrada pelo XML da NF-e e saídas com recibo.

const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const rotuloMat = (m: Material) => `${nomeMaterial(m)} · ${m.modelo || 's/ modelo'}`;

// ---------- Entrada por NF-e ----------

function codDestino(d: DestinoItem): string {
  return d.tipo === 'existente' ? `m:${d.materialId}` : d.tipo === 'novo' ? `n:${d.embalagem}` : 'x';
}
function lerDestino(v: string): DestinoItem {
  if (v.startsWith('m:')) return { tipo: 'existente', materialId: v.slice(2) };
  if (v.startsWith('n:')) return { tipo: 'novo', embalagem: v.slice(2) as Embalagem | '' };
  return { tipo: 'ignorar' };
}

export function EntradaNfe() {
  const d = useDados();
  const [nfe, setNfe] = useState<Nfe | null>(null);
  const [xml, setXml] = useState('');
  const [emb, setEmb] = useState<Embalagem | ''>('Com caixa');
  const [destinos, setDestinos] = useState<Map<number, DestinoItem>>(new Map());
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const materiais = useMemo(() => [...d.materiais].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')), [d.materiais]);

  function sugerir(n: Nfe, e: Embalagem | '') {
    setDestinos(new Map(n.itens.map((it) => {
      const m = sugerirMaterial(it, d.materiais, e);
      return [it.n, m ? { tipo: 'existente', materialId: m.id } : { tipo: 'novo', embalagem: e }] as const;
    })));
  }

  async function ler(f: File | undefined) {
    setErro(''); setFeito(''); setNfe(null);
    if (!f) return;
    try {
      const texto = await f.text();
      const n = lerNfe(texto);
      setXml(texto); setNfe(n); sugerir(n, emb);
    } catch (e) { setErro(`Não consegui ler o XML: ${(e as Error).message}`); }
  }

  const doutraEmpresa = nfe && d.unidade && nfe.destinatarioCnpj && nfe.destinatarioCnpj !== soDigitos(d.unidade.cnpj);
  const jaLancada = nfe && notaJaLancada(nfe.chave, d.movimentos);

  async function confirmar() {
    if (!nfe) return;
    if (jaLancada && !confirm('Esta nota já foi lançada. Lançar de novo vai duplicar as entradas. Continuar?')) return;
    if (doutraEmpresa && !confirm(`A nota é para o CNPJ ${fmtCnpj(nfe.destinatarioCnpj)}, não para ${d.unidade!.nome}. Lançar mesmo assim?`)) return;
    setOcupado(true);
    const p = planejarEntradaNfe(nfe, destinos, d.materiais);
    await salvar('materiais', ...p.novos, ...p.atualizados);
    await salvar('movimentos', ...p.movimentos);
    let aviso = '';
    try {
      const ano = (nfe.emissao || new Date().toISOString()).slice(0, 4);
      await guardarArquivo(await token(), `nfe/${ano}`, `${nfe.chave}.xml`, xml, 'application/xml');
    } catch { aviso = ' O XML não foi guardado no OneDrive (sem internet?); as entradas foram lançadas.'; }
    setFeito(`NF-e ${nfe.numero} lançada: ${p.movimentos.length} entradas, ${p.novos.length} itens novos, preço de compra atualizado.${aviso}`);
    setNfe(null); setOcupado(false);
  }

  // notas já lançadas (pelas movimentações com documento nfe:)
  const notas = useMemo(() => {
    const m = new Map<string, { chave: string; destino: string; data: string; itens: number; ids: string[] }>();
    for (const v of d.movimentos) {
      if (!v.documento?.startsWith('nfe:')) continue;
      const k = v.documento.slice(4);
      const n = m.get(k) ?? { chave: k, destino: v.destino, data: v.data, itens: 0, ids: [] };
      n.itens++; n.ids.push(v.id); m.set(k, n);
    }
    return [...m.values()].sort((a, b) => b.data.localeCompare(a.data));
  }, [d.movimentos]);

  if (d.unidade && !d.unidade.temEstoque) return <div class="cartao vazio">{d.unidade.nome} não controla estoque.</div>;
  return (
    <>
      <div class="cartao">
        <p style="margin-top:0">Anexe o <b>XML da NF-e</b> de compra. O KIVOR lê os itens, sugere o item do estoque de cada um e lança as entradas com o <b>preço de compra</b>.</p>
        <div class="fila">
          <input type="file" accept=".xml,text/xml,application/xml" disabled={ocupado} onChange={(e) => { const i = e.currentTarget; void ler(i.files?.[0]).finally(() => { i.value = ''; }); }} />
          <div style="flex:0;min-width:200px"><label style="margin-top:0">Itens novos entram como</label>
            <select value={emb} onChange={(e) => { const v = e.currentTarget.value as Embalagem | ''; setEmb(v); if (nfe) sugerir(nfe, v); }}>
              <option value="Com caixa">Com caixa</option><option value="Sem caixa">Sem caixa</option><option value="">Sem embalagem informada</option>
            </select></div>
        </div>
      </div>
      {erro && <div class="erro">{erro}</div>}
      {feito && <div class="sucesso">{feito} <button onClick={() => ir('estoque')}>Ver estoque</button></div>}
      {nfe && (
        <div class="cartao">
          <h3 style="margin-top:0">NF-e {nfe.numero}{nfe.serie ? `/${nfe.serie}` : ''} · {nfe.emitente.nome}</h3>
          <p class="peq">CNPJ {fmtCnpj(nfe.emitente.cnpj)} · emissão {fmtData(nfe.emissao)} · total {fmtR(nfe.valorTotal)} · chave {nfe.chave}</p>
          {jaLancada && <div class="erro">Esta nota já foi lançada antes.</div>}
          {doutraEmpresa && <div class="erro">O destinatário da nota é o CNPJ {fmtCnpj(nfe.destinatarioCnpj)}, que não é {d.unidade!.nome} ({fmtCnpj(d.unidade!.cnpj)}). Confira a empresa no seletor.</div>}
          <div style="overflow-x:auto">
            <table class="tabela">
              <thead><tr><th>#</th><th>Item da nota</th><th style="text-align:right">Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Custo unit.*</th><th>EAN</th><th>Lançar em</th></tr></thead>
              <tbody>
                {nfe.itens.map((it) => {
                  const dest = destinos.get(it.n) ?? { tipo: 'ignorar' };
                  return (
                    <tr key={it.n}>
                      <td>{it.n}</td>
                      <td style="min-width:200px">{it.descricao}<div class="peq">cód. {it.codigo} · NCM {it.ncm} · CFOP {it.cfop}</div></td>
                      <td style="text-align:right;white-space:nowrap">{fmtQ(it.quantidade)} {it.unidade}</td>
                      <td style="text-align:right">{fmtR(it.valorUnitario)}</td>
                      <td style="text-align:right">{fmtR(it.custoUnitario)}</td>
                      <td>{it.ean || '—'}</td>
                      <td style="min-width:240px">
                        <select value={codDestino(dest)} onChange={(e) => setDestinos(new Map(destinos).set(it.n, lerDestino(e.currentTarget.value)))}>
                          <option value="n:Com caixa">➕ Novo item (com caixa)</option>
                          <option value="n:Sem caixa">➕ Novo item (sem caixa)</option>
                          <option value="n:">➕ Novo item</option>
                          <option value="x">✕ Não lançar</option>
                          {materiais.map((m) => <option key={m.id} value={`m:${m.id}`}>{rotuloMat(m)}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p class="peq">* Custo unitário = (valor do item − desconto + frete + seguro + outras despesas + IPI + ICMS-ST) ÷ quantidade. Vira o preço de compra do item.
            O EAN da nota é gravado no item quando ele ainda não tem. Confira a unidade de medida: se a nota vier em caixa com 10, ajuste depois.</p>
          <button class="primario grande" disabled={ocupado} onClick={confirmar}>Lançar entradas</button>
        </div>
      )}
      <h2>Notas lançadas ({notas.length})</h2>
      <div class="cartao">
        {notas.length === 0 ? <span class="peq">Nenhuma nota lançada ainda.</span> : (
          <table class="tabela">
            <thead><tr><th>Data</th><th>Nota / fornecedor</th><th>Itens</th><th></th></tr></thead>
            <tbody>{notas.map((n) => (
              <tr key={n.chave}>
                <td>{fmtData(n.data)}</td><td>{n.destino}<div class="peq">{n.chave}</div></td><td>{n.itens}</td>
                <td><button onClick={async () => {
                  if (!confirm(`Desfazer as ${n.itens} entradas desta nota? O saldo será recalculado (o preço de compra não volta).`)) return;
                  for (const id of n.ids) await excluir('movimentos', id);
                }}>Desfazer</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p class="peq">Os XML ficam guardados no OneDrive em SOF_CRM › nfe › ano.</p>
      </div>
    </>
  );
}

// ---------- Saídas (recibos) ----------

export function Saidas() {
  const d = useDados();
  const lista = [...d.recibos].sort((a, b) => b.data.localeCompare(a.data));
  if (d.unidade && !d.unidade.temEstoque) return <div class="cartao vazio">{d.unidade.nome} não controla estoque.</div>;
  return (
    <>
      <div class="fila" style="margin:8px 0">
        <span class="peq">{lista.length} recibos</span>
        <button class="primario" style="flex:0" onClick={() => ir('recibo/novo')}>+ Nova saída</button>
      </div>
      <div class="cartao" style="overflow-x:auto">
        {lista.length === 0 ? <span class="peq">Nenhuma saída com recibo ainda.</span> : (
          <table class="tabela">
            <thead><tr><th>Número</th><th>Data</th><th>Cliente</th><th>Itens</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>{lista.map((r) => (
              <tr key={r.id} style="cursor:pointer" onClick={() => ir(`recibo/${r.id}`)}>
                <td><a href={`#/recibo/${r.id}`}>{r.numero}</a></td><td>{fmtDataHora(r.data)}</td><td>{r.cliente}</td>
                <td>{r.itens.length}</td><td style="text-align:right">{fmtR(totalRecibo(r))}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <p class="peq">O recibo é um comprovante interno de saída do estoque; a venda continua precisando da nota fiscal.</p>
    </>
  );
}

export function ReciboTela({ id }: { id: string }) {
  const d = useDados();
  if (!d.pronto) return null;
  const r = id === 'novo' ? null : d.recibos.find((x) => x.id === id);
  if (id !== 'novo' && !r) return <><Topo titulo="Recibo" voltar={() => voltar('saidas')} /><main><div class="vazio">Recibo não encontrado.</div></main></>;
  return r ? <VerRecibo r={r} /> : <NovoRecibo />;
}

function NovoRecibo() {
  const d = useDados();
  const [r, setR] = useState<Recibo>(() => novoRecibo(proximoNumeroRecibo(d.recibos, new Date().getFullYear())));
  const [busca, setBusca] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const achados = useMemo(() => {
    const t = normalizar(busca).split(' ').filter(Boolean);
    if (!t.length) return [];
    return d.materiais.filter((m) => { const a = normalizar(`${m.descricao} ${m.modelo} ${m.ean ?? ''} ${m.fabricante}`); return t.every((x) => a.includes(x)); }).slice(0, 12);
  }, [busca, d.materiais]);
  const mudarItem = (i: number, p: Partial<Recibo['itens'][number]>) => setR({ ...r, itens: r.itens.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const empresas = useMemo(() => [...d.empresas].sort((a, b) => nomeEmpresa(a).localeCompare(nomeEmpresa(b), 'pt-BR')), [d.empresas]);

  async function emitir() {
    const e = validarRecibo(r, d.saldo);
    setErros(e);
    if (e.length) return;
    setOcupado(true);
    const final = { ...r, numero: proximoNumeroRecibo(d.recibos, new Date(r.data).getFullYear()) };
    await salvar('recibos', final);
    await salvar('movimentos', ...movimentosDoRecibo(final));
    ir(`imprimir-recibo/${final.id}`);
  }

  return (
    <>
      <Topo titulo={`Nova saída · ${r.numero}`} voltar={() => voltar('saidas')} />
      <main>
        <div class="cartao">
          <div class="grade2">
            <div><label style="margin-top:0">Cliente *</label><input value={r.cliente} onInput={(e) => setR({ ...r, cliente: e.currentTarget.value })} /></div>
            <div><label style="margin-top:0">CPF/CNPJ</label><input value={r.documentoCliente} onInput={(e) => setR({ ...r, documentoCliente: e.currentTarget.value })} /></div>
            <div><label>Empresa no CRM (opcional)</label>
              <select value={r.empresaId ?? ''} onChange={(e) => {
                const emp = d.porId.get(e.currentTarget.value);
                setR({ ...r, empresaId: emp?.id ?? null, cliente: r.cliente || (emp ? nomeEmpresa(emp) : ''), documentoCliente: r.documentoCliente || (emp?.cnpj ? fmtCnpj(emp.cnpj) : '') });
              }}>
                <option value="">—</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{nomeEmpresa(e)}</option>)}
              </select></div>
            <div><label>Forma de pagamento</label><input value={r.formaPagamento} placeholder="PIX, dinheiro, boleto…" onInput={(e) => setR({ ...r, formaPagamento: e.currentTarget.value })} /></div>
          </div>
          <label>Observação</label><input value={r.observacao} onInput={(e) => setR({ ...r, observacao: e.currentTarget.value })} />
        </div>

        <h2>Itens</h2>
        <div class="cartao">
          <input type="search" placeholder="Buscar item por descrição, modelo ou EAN" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} />
          {achados.length > 0 && (
            <ul class="lista" style="margin-top:6px">
              {achados.map((m) => (
                <li key={m.id} class="fila" style="padding:4px 0;border-bottom:1px solid var(--borda)">
                  <span>{rotuloMat(m)} <span class="peq">· saldo {fmtQ(d.saldo.get(m.id) ?? 0)} · {m.precoVenda !== null ? fmtR(m.precoVenda) : 'sem preço'}</span></span>
                  <button style="flex:0" onClick={() => { setR({ ...r, itens: [...r.itens, itemDoMaterial(m)] }); setBusca(''); }}>Incluir</button>
                </li>
              ))}
            </ul>
          )}
          {r.itens.length > 0 && (
            <div style="overflow-x:auto;margin-top:8px">
              <table class="tabela">
                <thead><tr><th>Item</th><th>Saldo</th><th>Qtd</th><th>Valor unit. (R$)</th><th style="text-align:right">Total</th><th></th></tr></thead>
                <tbody>{r.itens.map((i, k) => (
                  <tr key={`${i.materialId}-${k}`}>
                    <td>{i.descricao}{i.embalagem ? ` (${i.embalagem.toLowerCase()})` : ''}<div class="peq">{i.modelo}</div></td>
                    <td>{fmtQ(d.saldo.get(i.materialId) ?? 0)}</td>
                    <td style="width:90px"><CampoValor valor={i.quantidade} aoMudar={(v) => mudarItem(k, { quantidade: v ?? 0 })} /></td>
                    <td style="width:120px"><CampoValor valor={i.valorUnitario} aoMudar={(v) => mudarItem(k, { valorUnitario: v ?? 0 })} /></td>
                    <td style="text-align:right">{fmtR(i.quantidade * i.valorUnitario)}</td>
                    <td><button onClick={() => setR({ ...r, itens: r.itens.filter((_, j) => j !== k) })}>×</button></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr style="font-weight:600"><td colSpan={4}>Total</td><td style="text-align:right">{fmtR(totalRecibo(r))}</td><td></td></tr></tfoot>
              </table>
            </div>
          )}
        </div>
        {erros.length > 0 && <div class="erro"><ul style="margin:0;padding-left:18px">{erros.map((e) => <li key={e}>{e}</li>)}</ul></div>}
        <button class="primario grande" disabled={ocupado} onClick={emitir}>Dar saída e emitir recibo</button>
      </main>
    </>
  );
}

function VerRecibo({ r }: { r: Recibo }) {
  const d = useDados();
  async function cancelar() {
    if (!confirm(`Cancelar o recibo ${r.numero}? Os itens voltam para o estoque.`)) return;
    for (const v of d.movimentos.filter((x) => x.documento === `rs:${r.id}`)) await excluir('movimentos', v.id);
    await excluir('recibos', r.id);
    ir('saidas');
  }
  return (
    <>
      <Topo titulo={`Recibo ${r.numero}`} voltar={() => voltar('saidas')} />
      <main>
        <div class="cartao">
          <p style="margin-top:0"><b>{r.cliente}</b>{r.documentoCliente ? ` · ${r.documentoCliente}` : ''}<br /><span class="peq">{fmtDataHora(r.data)}{r.formaPagamento ? ` · ${r.formaPagamento}` : ''}</span></p>
          <table class="tabela">
            <thead><tr><th>Item</th><th>Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>{r.itens.map((i, k) => <tr key={k}><td>{i.descricao}<div class="peq">{i.modelo}</div></td><td>{fmtQ(i.quantidade)}</td><td style="text-align:right">{fmtR(i.valorUnitario)}</td><td style="text-align:right">{fmtR(i.quantidade * i.valorUnitario)}</td></tr>)}</tbody>
            <tfoot><tr style="font-weight:600"><td colSpan={3}>Total</td><td style="text-align:right">{fmtR(totalRecibo(r))}</td></tr></tfoot>
          </table>
          {r.observacao && <p class="peq">{r.observacao}</p>}
          <div class="fila" style="margin-top:10px">
            <button class="primario" onClick={() => ir(`imprimir-recibo/${r.id}`)}>🖨 Imprimir recibo</button>
            <button class="perigo" style="flex:0" onClick={cancelar}>Cancelar recibo</button>
          </div>
        </div>
      </main>
    </>
  );
}

const porExtensoSimples = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ImprimirRecibo({ id }: { id: string }) {
  const d = useDados();
  const r = d.recibos.find((x) => x.id === id);
  useEffect(() => { document.title = r ? `Recibo ${r.numero} – ${r.cliente}` : 'Recibo'; return () => { document.title = 'KIVOR-CRM'; }; }, [r?.id]);
  if (!d.pronto) return null;
  if (!r) return <main><div class="vazio">Recibo não encontrado.</div></main>;
  const u = d.unidades.find((x) => x.id === r.unidadeId) ?? d.unidade;
  const em = u ? { nome: u.nome, cnpj: fmtCnpj(u.cnpj), telefone: u.telefone, email: u.email, cidade: u.cidade, responsavel: u.responsavel } : EMISSOR;
  const total = totalRecibo(r);
  return (
    <div class="impressao">
      <div class="barra-impressao">
        <button onClick={() => voltar(`recibo/${r.id}`)}>← Voltar</button>
        <button class="primario" onClick={() => print()}>🖨 Imprimir / salvar em PDF</button>
        <span class="peq">No diálogo, desmarque "Cabeçalhos e rodapés".</span>
      </div>
      <table class="doc">
        <thead><tr><td><div class="doc-topo"><span class="doc-marca">{em.nome}</span><span class="doc-cnpj">CNPJ {em.cnpj}</span></div></td></tr></thead>
        <tfoot><tr><td><div class="doc-rodape">{[em.telefone, em.email, em.cidade].filter(Boolean).join(' · ')}</div></td></tr></tfoot>
        <tbody><tr><td class="doc-corpo">
          <p class="doc-data">{em.cidade ? `${em.cidade}, ` : ''}{fmtData(r.data)}</p>
          <h1 class="doc-titulo">Recibo de saída</h1>
          <div class="doc-subtitulo">Nº {r.numero}</div>
          <div class="doc-linha" />
          <p class="doc-cab"><b>Cliente:</b> {r.cliente}{r.documentoCliente ? ` · CPF/CNPJ ${r.documentoCliente}` : ''}</p>
          <table class="doc-itens">
            <thead><tr><th>Item</th><th>Descrição</th><th>Modelo</th><th>Qtd</th><th>Valor unit.</th><th>Total</th></tr></thead>
            <tbody>{r.itens.map((i, k) => (
              <tr key={k}><td>{k + 1}</td><td>{i.descricao}{i.embalagem ? ` (${i.embalagem.toLowerCase()})` : ''}</td><td>{i.modelo}</td>
                <td>{fmtQ(i.quantidade)}</td><td>{fmtR(i.valorUnitario)}</td><td>{fmtR(i.quantidade * i.valorUnitario)}</td></tr>
            ))}</tbody>
          </table>
          <p style="text-align:right;font-size:12pt"><b>Total: {porExtensoSimples(total)}</b></p>
          {r.formaPagamento && <p><b>Forma de pagamento:</b> {r.formaPagamento}</p>}
          {r.observacao && <p><b>Observação:</b> {r.observacao}</p>}
          <p>Declaro que recebi os itens acima em perfeito estado.</p>
          <div style="display:flex;gap:40px;margin-top:40px">
            <div style="flex:1;border-top:1px solid #333;padding-top:4px;text-align:center">{r.cliente}<br /><span class="peq">recebedor</span></div>
            <div style="flex:1;border-top:1px solid #333;padding-top:4px;text-align:center">{em.nome}<br /><span class="peq">{em.responsavel || 'emitente'}</span></div>
          </div>
          <p class="peq" style="margin-top:16px">Documento sem valor fiscal.</p>
        </td></tr></tbody>
      </table>
    </div>
  );
}
