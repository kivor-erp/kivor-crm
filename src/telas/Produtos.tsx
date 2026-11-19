import { useMemo, useState } from 'preact/hooks';
import { margemProduto, pendenciasProduto, type Pendencia } from '../lib/estoque';
import type { Material } from '../lib/model';
import { normalizar } from '../lib/texto';
import { ir, useDados } from '../store';

// WMS › Produtos: cadastro de todos os produtos que a empresa vende, com ou sem estoque.
// O "Estoque" mostra saldo e valor; aqui o foco é o cadastro estar completo (preços, EAN, fotos).

const fmtR = (v: number | null | undefined) => (v === null || v === undefined ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
type Filtro = 'todos' | 'sem-estoque' | 'incompletos' | Pendencia;
const FILTROS: [Filtro, string][] = [
  ['todos', 'Todos'], ['sem-estoque', 'Sem estoque'], ['incompletos', 'Cadastro incompleto'],
  ['preço de venda', 'Sem preço de venda'], ['preço de compra', 'Sem preço de compra'], ['EAN', 'Sem EAN'], ['foto', 'Sem foto'],
];

export function Produtos() {
  const d = useDados();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const pend = useMemo(() => new Map(d.materiais.map((m) => [m.id, pendenciasProduto(m)])), [d.materiais]);
  const saldo = (m: Material) => d.saldo.get(m.id) ?? 0;
  const passa = (m: Material, f: Filtro) => f === 'todos' || (f === 'sem-estoque' ? saldo(m) <= 0 : f === 'incompletos' ? pend.get(m.id)!.length > 0 : pend.get(m.id)!.includes(f));
  const lista = useMemo(() => {
    const t = normalizar(busca).split(' ').filter(Boolean);
    return d.materiais
      .filter((m) => passa(m, filtro) && t.every((x) => normalizar(`${m.descricao} ${m.fabricante} ${m.modelo} ${m.ean ?? ''}`).includes(x)))
      .sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
  }, [d.materiais, d.saldo, busca, filtro, pend]);
  const conta = (f: Filtro) => d.materiais.filter((m) => passa(m, f)).length;

  if (d.unidade && !d.unidade.temEstoque) {
    return <div class="cartao vazio"><p>{d.unidade.nome} não tem cadastro de produtos (WMS).</p><p class="peq">Escolha outra empresa no seletor acima.</p></div>;
  }
  return (
    <>
      <div class="busca"><input type="search" placeholder="Buscar descrição, fabricante, modelo ou EAN" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} /></div>
      <div class="chips">
        {FILTROS.map(([f, rot]) => <button key={f} class={`chip peq ${filtro === f ? 'sel' : ''}`} onClick={() => setFiltro(f)}>{rot} ({conta(f)})</button>)}
      </div>
      <div class="fila" style="margin:8px 0">
        <span class="peq">{lista.length} de {d.materiais.length} produtos</span>
        <button style="flex:0" onClick={async () => { const { exportarProdutos } = await import('../lib/exportar'); exportarProdutos(d.materiais, d.saldo, d.unidade?.nome ?? ''); }}>Exportar base (Excel)</button>
        <button style="flex:0" onClick={() => ir('estoque/importar')}>Importar planilha / EANs</button>
        <button class="primario" style="flex:0" onClick={() => ir('material/novo')}>+ Produto</button>
      </div>
      <div class="cartao" style="padding:6px 8px">
        {lista.length === 0 ? <span class="peq">Nenhum produto{filtro !== 'todos' || busca ? ' com esse filtro' : ''}.</span> : (
          <table class="tabela">
            <thead><tr>
              <th>Produto</th><th>Fabricante / modelo</th><th>EAN</th><th style="text-align:right">Venda</th><th style="text-align:right">Compra</th>
              <th style="text-align:right">Margem</th><th style="text-align:right">Saldo</th><th>Fotos</th><th>Falta no cadastro</th>
            </tr></thead>
            <tbody>{lista.map((m) => {
              const p = pend.get(m.id)!;
              const mg = margemProduto(m);
              const s = saldo(m);
              return (
                <tr key={m.id} style="cursor:pointer" onClick={() => ir(`material/${m.id}`)}>
                  <td style="min-width:200px"><a href={`#/material/${m.id}`}>{m.descricao || '(sem descrição)'}</a>{m.embalagem && <div class="peq">{m.embalagem}</div>}</td>
                  <td>{m.fabricante}<div class="peq">{m.modelo}</div></td>
                  <td>{m.ean ?? ''}</td>
                  <td style="text-align:right">{fmtR(m.precoVenda)}</td>
                  <td style="text-align:right">{fmtR(m.precoCompra)}</td>
                  <td style={`text-align:right;${mg !== null && mg < 0 ? 'color:var(--perigo)' : ''}`}>{mg === null ? '' : `${Math.round(mg * 100)}%`}</td>
                  <td style={`text-align:right;${s <= 0 ? 'color:var(--suave)' : ''}`}>{s <= 0 ? 'sem estoque' : `${fmtQ(s)} ${m.unidade}`}</td>
                  <td>{m.fotos?.length ? `${m.fotos.filter((f) => f.tipo === 'estudio').length} est. / ${m.fotos.filter((f) => f.tipo === 'loja').length} loja` : ''}</td>
                  <td class="peq" style={p.length ? 'color:#8a6d00' : 'color:var(--ok)'}>{p.length ? p.join(', ') : 'completo'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      <p class="peq">Produto pode ser cadastrado sem estoque (ex.: compra sob pedido). Clique na linha para editar preços, EAN, fotos e observações; o saldo muda só por entrada (NF-e), saída (recibo) ou inventário.</p>
    </>
  );
}
