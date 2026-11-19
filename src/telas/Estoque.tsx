import { useMemo, useState } from 'preact/hooks';
import { CampoValor, Topo } from '../componentes';
import { db, excluir, salvar } from '../db';
import { fmtDataHora } from '../lib/datas';
import { nomeMaterial, novoMaterial, novoMovimento, planejarImportacaoMateriais, type PlanoMateriais } from '../lib/estoque';
import type { MaterialLido } from '../lib/importarMateriais';
import { EMBALAGENS, type Material, type Movimento, type TipoMovimento } from '../lib/model';
import { fmtMoeda, lerMoeda } from '../lib/regras';
import { normalizar } from '../lib/texto';
import { daUnidade } from '../lib/unidades';
import { gtinValido, limparGtin } from '../lib/gtin';
import { Fotos } from './Fotos';
import { ir, useDados, voltar } from '../store';

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const baixo = (m: Material, saldo: number) => saldo <= 0 || (m.estoqueMinimo !== null && saldo < m.estoqueMinimo);

// ---------- lista ----------

/** Preço com centavos (R$ 8.045,99). Vazio quando não se sabe. */
const fmtPreco = (v: number | null | undefined) => (v === null || v === undefined ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

type ColunaGrade = 'descricao' | 'embalagem' | 'fabricante' | 'modelo' | 'ean' | 'local' | 'saldo' | 'venda' | 'compra' | 'valor';
const COLUNAS: { k: ColunaGrade; rot: string; num?: boolean }[] = [
  { k: 'descricao', rot: 'Descrição' }, { k: 'embalagem', rot: 'Embalagem' }, { k: 'fabricante', rot: 'Fabricante' }, { k: 'modelo', rot: 'Modelo' },
  { k: 'ean', rot: 'EAN' },
  { k: 'local', rot: 'Local' }, { k: 'saldo', rot: 'Qtd', num: true }, { k: 'venda', rot: 'Preço venda', num: true },
  { k: 'compra', rot: 'Preço compra', num: true }, { k: 'valor', rot: 'Valor em estoque (venda)', num: true },
];

export function Estoque() {
  const d = useDados();
  const [busca, setBusca] = useState('');
  const [soBaixo, setSoBaixo] = useState(false);
  const [emb, setEmb] = useState<'' | 'Com caixa' | 'Sem caixa'>('');
  const [ordem, setOrdem] = useState<{ k: ColunaGrade; desc: boolean }>({ k: 'descricao', desc: false });
  const valorDe = (m: Material, k: ColunaGrade): string | number | null => {
    const s = d.saldo.get(m.id) ?? 0;
    switch (k) {
      case 'saldo': return s;
      case 'venda': return m.precoVenda;
      case 'compra': return m.precoCompra ?? null;
      case 'valor': return m.precoVenda === null ? null : s * m.precoVenda;
      case 'embalagem': return m.embalagem ?? '';
      case 'ean': return m.ean ?? '';
      default: return m[k];
    }
  };
  const lista = useMemo(() => {
    const termos = normalizar(busca).split(' ').filter(Boolean);
    const dir = ordem.desc ? -1 : 1;
    return d.materiais
      .filter((m) => {
        const alvo = normalizar(`${m.descricao} ${m.fabricante} ${m.modelo} ${m.local} ${m.ean ?? ''}`);
        return termos.every((t) => alvo.includes(t)) && (!soBaixo || baixo(m, d.saldo.get(m.id) ?? 0)) && (!emb || m.embalagem === emb);
      })
      .sort((a, b) => {
        const x = valorDe(a, ordem.k), y = valorDe(b, ordem.k);
        if (x === null || x === '') return 1; // vazios sempre no fim
        if (y === null || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * dir;
      });
  }, [d.materiais, d.saldo, busca, soBaixo, emb, ordem]);
  const nBaixo = d.materiais.filter((m) => baixo(m, d.saldo.get(m.id) ?? 0)).length;
  const tot = lista.reduce((t, m) => {
    const s = d.saldo.get(m.id) ?? 0;
    return { qtd: t.qtd + s, venda: t.venda + (m.precoVenda ?? 0) * s, compra: t.compra + (m.precoCompra ?? 0) * s, semCompra: t.semCompra + (m.precoCompra == null ? 1 : 0) };
  }, { qtd: 0, venda: 0, compra: 0, semCompra: 0 });

  if (d.unidade && !d.unidade.temEstoque) {
    return <div class="cartao vazio"><p>{d.unidade.nome} não controla estoque.</p><p class="peq">Escolha outra empresa no seletor acima ou marque "Tem estoque" em Ajustes › Empresas do grupo.</p></div>;
  }
  if (d.pronto && !d.materiais.length) {
    return (
      <div class="cartao vazio">
        <p>Nenhum material no estoque ainda.</p>
        <button class="primario grande" onClick={() => ir('estoque/importar')}>Importar planilha de materiais</button>
        <p><button onClick={() => ir('material/novo')}>Cadastrar material</button></p>
      </div>
    );
  }
  return (
    <>
      <div class="busca"><input type="search" placeholder="Buscar descrição, fabricante, modelo ou local" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} /></div>
      <div class="chips">
        {(['', 'Com caixa', 'Sem caixa'] as const).map((e) => (
          <button key={e} class={`chip peq ${emb === e ? 'sel' : ''}`} onClick={() => setEmb(e)}>{e || 'Todos'}</button>
        ))}
        <button class={`chip peq ${soBaixo ? 'sel' : ''}`} onClick={() => setSoBaixo(!soBaixo)}>Sem saldo / abaixo do mínimo ({nBaixo})</button>
      </div>
      <div class="fila" style="margin:8px 0">
        <span class="peq">{lista.length} de {d.materiais.length} itens</span>
        <button style="flex:0" onClick={() => ir('estoque/importar')}>Importar</button>
        <button class="primario" style="flex:0" onClick={() => ir('material/novo')}>+ Material</button>
      </div>
      <div class="cartao" style="overflow-x:auto;padding:6px 8px">
        <table class="tabela" style="white-space:nowrap">
          <thead>
            <tr>
              {COLUNAS.map((c) => (
                <th key={c.k} style={`cursor:pointer;${c.num ? 'text-align:right' : ''}`} title="Ordenar"
                  onClick={() => setOrdem({ k: c.k, desc: ordem.k === c.k ? !ordem.desc : !!c.num })}>
                  {c.rot}{ordem.k === c.k ? (ordem.desc ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.map((m) => {
              const s = d.saldo.get(m.id) ?? 0;
              return (
                <tr key={m.id} style="cursor:pointer" onClick={() => ir(`material/${m.id}`)}>
                  <td style="white-space:normal;min-width:220px"><a href={`#/material/${m.id}`}>{m.descricao || '(sem descrição)'}</a></td>
                  <td>{m.embalagem || ''}</td>
                  <td>{m.fabricante}</td>
                  <td>{m.modelo}</td>
                  <td>{m.ean ?? ''}</td>
                  <td>{m.local}</td>
                  <td style={`text-align:right;${baixo(m, s) ? 'color:var(--perigo);font-weight:600' : ''}`}>{fmtQtd(s)} {m.unidade}</td>
                  <td style="text-align:right">{fmtPreco(m.precoVenda)}</td>
                  <td style="text-align:right">{fmtPreco(m.precoCompra)}</td>
                  <td style="text-align:right">{m.precoVenda === null ? '' : fmtPreco(s * m.precoVenda)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style="font-weight:600">
              <td colSpan={6}>Total ({lista.length} itens)</td>
              <td style="text-align:right">{fmtQtd(tot.qtd)}</td>
              <td></td>
              <td style="text-align:right" title="Soma só dos itens com preço de compra conhecido">{tot.compra ? fmtPreco(tot.compra) : ''}</td>
              <td style="text-align:right">{fmtPreco(tot.venda)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="peq">Clique no título da coluna para ordenar e na linha para abrir o item. Preço de compra em branco = ainda não se sabe
        {tot.semCompra ? ` (${tot.semCompra} itens)` : ''}; o total de compra soma só os conhecidos.</p>
    </>
  );
}

// ---------- material: cadastro + entradas/saídas ----------

export function MaterialTela({ id }: { id: string }) {
  const d = useDados();
  if (!d.pronto) return null;
  const m = id === 'novo' ? null : d.materiais.find((x) => x.id === id);
  if (id !== 'novo' && !m) return <><Topo titulo="Material" voltar={() => voltar('estoque')} /><main><div class="vazio">Material não encontrado.</div></main></>;
  return <FichaMaterial key={id} material={m ?? null} />;
}

function FichaMaterial({ material }: { material: Material | null }) {
  const d = useDados();
  const [m, setM] = useState<Material>(() => material ?? novoMaterial());
  const [tipo, setTipo] = useState<TipoMovimento | null>(null);
  const [qtd, setQtd] = useState('');
  const [destino, setDestino] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const saldo = material ? d.saldo.get(material.id) ?? 0 : 0;
  const movs = d.movimentos.filter((v) => v.materialId === m.id).sort((a, b) => b.data.localeCompare(a.data));
  const semFotos = (x: Material) => JSON.stringify({ ...x, fotos: undefined, atualizadoEm: undefined });
  const mudou = !material || semFotos(m) !== semFotos(material);

  async function gravar() {
    if (!m.descricao.trim()) return setErro('Informe a descrição.');
    const ean = limparGtin(m.ean);
    if (ean && !gtinValido(ean)) return setErro('EAN inválido: confira os dígitos (8, 12, 13 ou 14, com o verificador).');
    await salvar('materiais', { ...m, ean, fotos: material?.fotos ?? m.fotos }); // fotos são gravadas pela seção Fotos
    if (!material) ir(`material/${m.id}`);
  }

  async function lancar() {
    const n = lerMoeda(qtd);
    if (n === null || (tipo !== 'Ajuste' && n <= 0) || n < 0) return setErro(tipo === 'Ajuste' ? 'Informe a quantidade contada.' : 'Informe uma quantidade maior que zero.');
    if (tipo === 'Saída' && n > saldo && !confirm(`Saída de ${fmtQtd(n)} com saldo de ${fmtQtd(saldo)}. O saldo vai ficar negativo. Continuar?`)) return;
    const q = tipo === 'Ajuste' ? n - saldo : n; // ajuste: informa o que contou, lança a diferença
    if (tipo === 'Ajuste' && !q) { setTipo(null); return; }
    await salvar('movimentos', novoMovimento(m.id, tipo!, q, { destino: destino.trim(), observacao: obs.trim() }));
    setTipo(null); setQtd(''); setDestino(''); setObs(''); setErro('');
  }

  const campo = (k: keyof Material, rot: string, ph = '') => (
    <div><label>{rot}</label><input value={String(m[k] ?? '')} placeholder={ph} onInput={(e) => setM({ ...m, [k]: e.currentTarget.value })} /></div>
  );

  return (
    <>
      <Topo titulo={material ? m.descricao || 'Material' : 'Novo material'} voltar={() => voltar('estoque')} />
      <main>
        {material && (
          <div class="cartao">
            <div class="fila" style="align-items:center">
              <div><div class="peq">Saldo atual</div><div class={`saldo grande-saldo ${baixo(material, saldo) ? 'baixo' : ''}`}>{fmtQtd(saldo)}<small>{m.unidade}</small></div></div>
              {material.estoqueMinimo !== null && <div class="peq" style="text-align:right">mínimo: {fmtQtd(material.estoqueMinimo)}</div>}
            </div>
            {!tipo ? (
              <div class="acoes" style="grid-template-columns:repeat(3,1fr)">
                <button class="registrar" onClick={() => setTipo('Entrada')}><span class="ic">＋</span>Entrada</button>
                <button onClick={() => setTipo('Saída')}><span class="ic">－</span>Saída</button>
                <button onClick={() => { setTipo('Ajuste'); setQtd(fmtQtd(saldo)); }}><span class="ic">⟳</span>Inventário</button>
              </div>
            ) : (
              <div style="margin-top:10px">
                <div class="grade2">
                  <div><label>{tipo === 'Ajuste' ? 'Quantidade contada' : `Quantidade (${tipo.toLowerCase()})`}</label>
                    <input inputMode="decimal" value={qtd} autoFocus onInput={(e) => setQtd(e.currentTarget.value)} /></div>
                  <div><label>{tipo === 'Entrada' ? 'Origem (fornecedor/NF)' : tipo === 'Saída' ? 'Destino (cliente/obra)' : 'Motivo'}</label>
                    <input value={destino} onInput={(e) => setDestino(e.currentTarget.value)} /></div>
                </div>
                <label>Observação</label><input value={obs} onInput={(e) => setObs(e.currentTarget.value)} />
                {erro && <div class="erro">{erro}</div>}
                <div class="fila" style="margin-top:10px">
                  <button class="primario" onClick={lancar}>Lançar {tipo === 'Ajuste' ? 'inventário' : tipo.toLowerCase()}</button>
                  <button style="flex:0" onClick={() => { setTipo(null); setErro(''); }}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        )}

        <h2>Cadastro</h2>
        <div class="cartao">
          <label style="margin-top:0">Descrição *</label>
          <input value={m.descricao} onInput={(e) => setM({ ...m, descricao: e.currentTarget.value })} />
          <div class="grade2">
            {campo('fabricante', 'Fabricante')}
            {campo('modelo', 'Modelo / código')}
            {campo('ean', 'EAN / código de barras', '13 dígitos')}
            <div><label>Embalagem</label>
              <select value={m.embalagem ?? ''} onChange={(e) => setM({ ...m, embalagem: e.currentTarget.value as Material['embalagem'] })}>
                <option value="">Não informada</option>
                {EMBALAGENS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select></div>
            {campo('local', 'Local no estoque', 'ex.: Prateleira A3, caixa 2')}
            {campo('unidade', 'Unidade', 'un, m, cx…')}
            <div><label>Estoque mínimo</label><CampoValor valor={m.estoqueMinimo} aoMudar={(v) => setM({ ...m, estoqueMinimo: v })} /></div>
            <div><label>Preço de venda (R$)</label><CampoValor valor={m.precoVenda} aoMudar={(v) => setM({ ...m, precoVenda: v })} /></div>
            <div><label>Preço de compra (R$)</label><CampoValor valor={m.precoCompra} ph="em branco = não se sabe" aoMudar={(v) => setM({ ...m, precoCompra: v })} /></div>
          </div>
          <label>Observações</label><textarea value={m.observacoes} onInput={(e) => setM({ ...m, observacoes: e.currentTarget.value })} />
          {erro && !tipo && <div class="erro">{erro}</div>}
          {mudou && <button class="primario grande" style="margin-top:10px" onClick={gravar}>{material ? 'Salvar alterações' : 'Cadastrar material'}</button>}
          {material?.precoVenda !== null && material?.precoVenda !== undefined && <p class="peq">Valor do saldo: {fmtMoeda(saldo * material.precoVenda)}</p>}
        </div>

        {material && <Fotos material={material} />}

        {material && (
          <>
            <h2>Movimentações ({movs.length})</h2>
            <div class="cartao"><ListaMovimentos movs={movs} /></div>
            <button class="perigo" style="margin-top:12px;width:100%" onClick={async () => {
              if (confirm(`Excluir "${m.descricao}" do estoque? (as movimentações ficam no histórico e no backup)`)) { await excluir('materiais', m.id); ir('estoque'); }
            }}>Excluir material</button>
          </>
        )}
      </main>
    </>
  );
}

function ListaMovimentos({ movs, nomes }: { movs: Movimento[]; nomes?: Map<string, Material> }) {
  if (!movs.length) return <div class="peq">Nenhuma movimentação.</div>;
  return (
    <ul class="timeline">
      {movs.map((v) => (
        <li key={v.id}>
          <div class="quando">{fmtDataHora(v.data)} · {v.tipo}</div>
          {nomes && <div><a href={`#/material/${v.materialId}`}>{nomes.get(v.materialId)?.descricao ?? '(material excluído)'}</a></div>}
          <div class={`res ${v.quantidade < 0 ? 'neg' : 'pos'}`}>{v.quantidade > 0 ? '+' : ''}{fmtQtd(v.quantidade)}</div>
          {(v.destino || v.observacao) && <div class="peq">{[v.destino, v.observacao].filter(Boolean).join(' · ')}</div>}
          <button onClick={() => confirm('Desfazer este lançamento? O saldo será recalculado.') && excluir('movimentos', v.id)}>Desfazer</button>
        </li>
      ))}
    </ul>
  );
}

export function Movimentacoes() {
  const d = useDados();
  const nomes = useMemo(() => new Map(d.materiais.map((m) => [m.id, m])), [d.materiais]);
  const movs = useMemo(() => [...d.movimentos].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 300), [d.movimentos]);
  return <div class="cartao"><ListaMovimentos movs={movs} nomes={nomes} />{d.movimentos.length > 300 && <p class="peq">Mostrando as 300 mais recentes. A lista completa está no Excel (Ajustes › Exportar).</p>}</div>;
}

// ---------- importar planilha ----------

export function ImportarMateriais() {
  const d = useDados();
  const [lidos, setLidos] = useState<MaterialLido[] | null>(null);
  const [plano, setPlano] = useState<PlanoMateriais | null>(null);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function escolher(f: File | undefined) {
    setErro(''); setPlano(null); setFeito('');
    if (!f) return;
    setOcupado(true);
    try {
      const { lerArquivoMateriais } = await import('../lib/importarMateriais');
      const l = lerArquivoMateriais(await f.arrayBuffer());
      if (!l.length) throw new Error('Nenhuma aba com as colunas Fabricante, Modelo e Quant. foi encontrada.');
      setLidos(l);
      setPlano(planejarImportacaoMateriais(d.materiais, d.saldo, l));
    } catch (e) { setErro(`Não consegui ler a planilha: ${(e as Error).message}`); } finally { setOcupado(false); }
  }

  async function confirmar() {
    if (!lidos) return;
    setOcupado(true);
    const todos = await db.materiais.toArray().then((ms) => ms.filter((m) => !m.excluidoEm));
    const p = planejarImportacaoMateriais(daUnidade(todos, d.unidade?.id ?? null, d.unidades.length > 0), d.saldo, lidos);
    await salvar('materiais', ...p.novos, ...p.atualizados);
    if (p.movimentos.length) await salvar('movimentos', ...p.movimentos);
    setFeito(`${p.novos.length} materiais novos, ${p.atualizados.length} atualizados, ${p.movimentos.length} lançamentos de quantidade.`);
    setPlano(null); setOcupado(false);
  }

  return (
    <>
      <Topo titulo="Importar materiais" voltar={() => voltar('estoque')} />
      <main>
        <div class="cartao">
          <p style="margin-top:0">Escolha a planilha (.xlsx) de controle de materiais com as colunas <b>Descrição</b>, <b>Fabricante</b>, <b>Modelo</b> e <b>Quant.</b></p>
          <p class="peq">Linhas do mesmo modelo são somadas. Abas "C/ EMBALAGEM" e "S/ EMBALAGEM" viram itens separados (com caixa e sem caixa), cada um com seu preço.
            A coluna "Valor Dimensional" (ou "Valor unitário") vira o preço de venda. Material que já existe não é duplicado: se a quantidade da planilha
            for diferente do saldo, entra um lançamento de inventário com a diferença.</p>
          <input type="file" accept=".xlsx,.xls,.csv" disabled={ocupado} onChange={(e) => { const i = e.currentTarget; void escolher(i.files?.[0]).finally(() => { i.value = ''; }); }} />
        </div>
        {erro && <div class="erro">{erro}</div>}
        {plano && (
          <div class="cartao">
            <div class="resumo-num">
              <div><b>{plano.novos.length}</b>novos</div>
              <div><b>{plano.atualizados.length + plano.movimentos.filter((v) => v.tipo === 'Ajuste').length}</b>com mudança</div>
              <div><b>{plano.semMudanca}</b>iguais</div>
            </div>
            {plano.somadas > 0 && <p class="peq">{plano.somadas} itens apareciam em mais de uma linha e foram somados (com caixa e sem caixa ficam separados).</p>}
            {plano.precos.length > 0 && (
              <details>
                <summary>{plano.precos.length} preços de venda definidos ou alterados</summary>
                <table class="tabela"><thead><tr><th>Item</th><th>Antes</th><th>Planilha</th></tr></thead><tbody>
                  {plano.precos.map((x) => <tr key={x.material.id}><td>{nomeMaterial(x.material)} · {x.material.modelo}</td><td>{x.de === null ? '—' : fmtPreco(x.de)}</td><td>{fmtPreco(x.para)}</td></tr>)}
                </tbody></table>
              </details>
            )}
            {plano.conflitosPreco.length > 0 && (
              <div class="erro">
                {plano.conflitosPreco.length} itens aparecem em mais de uma linha com preços diferentes. Foi usado o maior; revise depois na ficha do material:
                <ul class="peq">{plano.conflitosPreco.map((l) => (
                  <li key={`${l.modelo}-${l.embalagem}`}>{l.modelo || l.descricao} ({l.embalagem || 'sem embalagem informada'}): {l.precosDiferentes.map(fmtPreco).join(' / ')} · linhas {l.linhas.join(', ')}</li>
                ))}</ul>
              </div>
            )}
            <button class="primario grande" disabled={ocupado || (!plano.novos.length && !plano.atualizados.length && !plano.movimentos.length)} onClick={confirmar}>
              {plano.novos.length || plano.atualizados.length || plano.movimentos.length ? 'Confirmar importação' : 'Nada para importar'}
            </button>
          </div>
        )}
        {feito && <div class="sucesso">{feito} <button onClick={() => ir('estoque')}>Ver estoque</button></div>}
      </main>
    </>
  );
}
