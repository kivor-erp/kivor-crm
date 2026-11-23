import { useMemo, useState } from 'preact/hooks';
import { CampoValor } from '../componentes';
import { AVISO_FISCAL, ROTULO_EXEMPLO, vigentesEm } from '../lib/calc/parametros';
import { SEM_DETALHE, pontosDeCsv, resumoPontos } from '../lib/calc/orcamentoCalc';
import { brl } from '../lib/calc/preco';
import {
  CATEGORIAS, FATURAMENTOS, ROTULO_CATEGORIA, ROTULO_FATURAMENTO,
  type CalcOrcamento, type DefinicaoCalculadora, type EntradaDef, type Faturamento, type PontoOrc, type ResultadoCompleto, type Valor,
} from '../lib/calc/tipos';
import { hojeSP } from '../lib/datas';
import { useDados } from '../store';

const pct1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

// ---------- aba Pontos ----------

const qtdTexto = (p: PontoOrc) => (p.situacao === 'pendente' ? '?' : p.situacao === 'nao_instalar' ? 'N/A' : String(p.qtd ?? 0));
function lerQtd(t: string): Pick<PontoOrc, 'qtd' | 'situacao'> | null {
  const s = t.trim();
  if (s === '?') return { qtd: null, situacao: 'pendente' };
  if (/^n\/?a$/i.test(s)) return { qtd: null, situacao: 'nao_instalar' };
  const n = Number(s.replace(',', '.'));
  return Number.isInteger(n) && n >= 0 && s !== '' ? { qtd: n, situacao: 'ok' } : null;
}

export function AbaPontos({ calc, mudar, travado }: { calc: CalcOrcamento; mudar: (p: Partial<CalcOrcamento>) => void; travado: boolean }) {
  const r = useMemo(() => resumoPontos(calc.pontos), [calc.pontos]);
  const [csv, setCsv] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [novo, setNovo] = useState({ grupo: '', local: '' });
  const grupos = [...new Set(calc.pontos.map((p) => p.grupo))];
  const alterar = (id: string, p: Partial<PontoOrc>) => mudar({ pontos: calc.pontos.map((x) => (x.id === id ? { ...x, ...p } : x)) });

  function importar() {
    const l = pontosDeCsv(csv);
    setErros(l.erros);
    if (l.erros.length || !l.pontos.length) return;
    if (calc.pontos.length && !confirm(`Substituir os ${calc.pontos.length} pontos atuais por ${l.pontos.length} linhas do CSV?`)) return;
    mudar({ pontos: l.pontos });
    setCsv('');
  }

  return (
    <>
      <div class="grade-num">
        <div class="cartao num"><b>{r.total}</b><span>pontos a instalar</span></div>
        <div class="cartao num"><b style={r.pendentes ? 'color:var(--perigo)' : ''}>{r.pendentes}</b><span>linhas com quantidade pendente</span></div>
        <div class="cartao num"><b>{r.comAudio}</b><span>pontos com áudio</span></div>
        <div class="cartao num"><b>{r.comDetalhe}</b><span>pontos com detalhe</span></div>
        <div class="cartao num"><b>{r.semDetalhe}</b><span>pontos sem detalhe</span></div>
        <div class="cartao num"><b>{r.naoInstalar}</b><span>locais "não instalar"</span></div>
      </div>
      <p class="peq">Total confirmado: <b>{r.total} pontos</b> + <b>{r.pendentes} linhas pendentes</b> (quantidade "?" não entra na conta: não é inventada).</p>

      <div class="grade2">
        <div class="cartao">
          <b>Pontos por detalhe</b>
          <table class="tabela"><tbody>{r.porDetalhe.map(([k, n]) => <tr key={k}><td>{k === SEM_DETALHE ? k : `Detalhe ${k}`}</td><td style="text-align:right"><b>{n}</b></td></tr>)}</tbody></table>
        </div>
        <div class="cartao">
          <b>Pontos por grupo</b>
          <table class="tabela"><tbody>{r.porGrupo.map(([k, n]) => <tr key={k}><td>{k}</td><td style="text-align:right"><b>{n}</b></td></tr>)}</tbody></table>
        </div>
      </div>

      <h2>Locais</h2>
      {!calc.pontos.length && <div class="cartao vazio">Nenhum ponto lançado. Cole um CSV abaixo ou adicione linha a linha.</div>}
      {grupos.map((g) => (
        <div class="cartao" key={g} style="overflow-x:auto">
          <b>{g}</b> <span class="peq">· {calc.pontos.filter((p) => p.grupo === g && p.situacao === 'ok').reduce((s, p) => s + (p.qtd ?? 0), 0)} pontos</span>
          <table class="tabela">
            <thead><tr><th>Local</th><th style="width:70px">Qtd.</th><th style="width:80px">Detalhe</th><th style="width:60px">Áudio</th><th>Observação</th><th style="width:40px"></th></tr></thead>
            <tbody>{calc.pontos.filter((p) => p.grupo === g).map((p) => (
              <tr key={p.id} style={p.situacao === 'pendente' ? 'background:#fff7d6' : p.situacao === 'nao_instalar' ? 'opacity:.6' : ''}>
                <td><input disabled={travado} value={p.local} onInput={(e) => alterar(p.id, { local: e.currentTarget.value })} /></td>
                <td><input disabled={travado} value={qtdTexto(p)} title='Número, "?" (pendente) ou "N/A" (não instalar)' onChange={(e) => { const q = lerQtd(e.currentTarget.value); if (q) alterar(p.id, q); else e.currentTarget.value = qtdTexto(p); }} /></td>
                <td><input disabled={travado} value={p.detalhe} onInput={(e) => alterar(p.id, { detalhe: e.currentTarget.value.toUpperCase() })} /></td>
                <td><input type="checkbox" style="width:auto;min-height:0" disabled={travado} checked={p.audio} onChange={(e) => alterar(p.id, { audio: e.currentTarget.checked })} /></td>
                <td><input disabled={travado} value={p.obs} onInput={(e) => alterar(p.id, { obs: e.currentTarget.value })} /></td>
                <td><button class="perigo" style="min-height:32px;padding:2px 8px" disabled={travado} onClick={() => mudar({ pontos: calc.pontos.filter((x) => x.id !== p.id) })}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}

      {!travado && (
        <>
          <div class="cartao">
            <b>Adicionar local</b>
            <div class="fila">
              <input list="grupos-pontos" placeholder="Grupo (ex.: G1 Mezanino M1)" value={novo.grupo} onInput={(e) => setNovo({ ...novo, grupo: e.currentTarget.value })} />
              <datalist id="grupos-pontos">{grupos.map((g) => <option key={g} value={g} />)}</datalist>
              <input placeholder="Local" value={novo.local} onInput={(e) => setNovo({ ...novo, local: e.currentTarget.value })} />
              <button style="flex:0;white-space:nowrap" disabled={!novo.grupo.trim() || !novo.local.trim()} onClick={() => {
                mudar({ pontos: [...calc.pontos, { id: `p${Date.now().toString(36)}`, grupo: novo.grupo.trim(), local: novo.local.trim(), qtd: null, situacao: 'pendente', detalhe: '', audio: false, obs: '' }] });
                setNovo({ grupo: novo.grupo, local: '' });
              }}>+ Local</button>
            </div>
          </div>
          <details class="cartao">
            <summary>Importar pontos de um CSV</summary>
            <p class="peq">Colunas separadas por ponto e vírgula: <code>grupo;local;qtd;detalhe;audio;obs</code>. Quantidade: número, <code>?</code> (pendente) ou <code>N/A</code> (não instalar). Áudio: <code>sim</code>.</p>
            <textarea rows={6} value={csv} onInput={(e) => setCsv(e.currentTarget.value)} placeholder="grupo;local;qtd;detalhe;audio;obs" />
            {erros.map((e) => <div class="erro" key={e}>{e}</div>)}
            <button style="margin-top:6px" disabled={!csv.trim()} onClick={importar}>Importar</button>
          </details>
        </>
      )}
    </>
  );
}

// ---------- aba Cálculo ----------

function opcoesDe(e: EntradaDef, parametros: ReturnType<typeof useDados>['parametros']) {
  if (e.opcoes) return e.opcoes;
  if (e.opcoesParam) {
    const l = vigentesEm(parametros, e.opcoesParam.grupo, hojeSP()).map((p) => ({ valor: p.chave, rotulo: p.chave })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
    return e.opcoesParam.outro ? [...l, { valor: 'outro', rotulo: e.opcoesParam.outro }] : l;
  }
  return [];
}

export function AbaCalculo({ def, calc, mudar, travado, ao, salvo, aoSalvar }: {
  def: DefinicaoCalculadora; calc: CalcOrcamento; mudar: (p: Partial<CalcOrcamento>) => void; travado: boolean;
  ao: ResultadoCompleto; salvo: ResultadoCompleto | undefined; aoSalvar: () => void;
}) {
  const d = useDados();
  const motor = ao.motor;
  const faltando = new Set(motor.faltando);
  const setEntrada = (id: string, v: Valor | undefined) => {
    const e = { ...calc.entradas };
    if (v === undefined || v === '' || v === null) delete e[id]; else e[id] = v;
    mudar({ entradas: e });
  };
  const alternarEscopo = (id: string, exclusivo?: string) => {
    let esc = calc.escopo.includes(id) ? calc.escopo.filter((x) => x !== id) : [...calc.escopo, id];
    if (exclusivo && esc.includes(id)) esc = esc.filter((x) => x === id || def.escopo.find((s) => s.id === x)?.exclusivo !== exclusivo);
    mudar({ escopo: esc });
  };
  const grupos = [...new Set(def.entradas.filter((e) => motor.visiveis.includes(e.id)).map((e) => e.grupo ?? 'Dados'))];
  const desatualizado = !!salvo && JSON.stringify(salvo.pontual) !== JSON.stringify(ao.pontual);

  const campo = (e: EntradaDef) => {
    const explicito = calc.entradas[e.id];
    const efetivo = motor.entradas[e.id];
    const falta = faltando.has(e.id);
    const estilo = falta ? 'border-color:var(--perigo)' : '';
    let w;
    if (e.tipo === 'selecao') {
      w = (
        <select disabled={travado} style={estilo} value={String(explicito ?? efetivo ?? '')} onChange={(x) => setEntrada(e.id, x.currentTarget.value)}>
          <option value="">— escolha —</option>
          {opcoesDe(e, d.parametros).map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      );
    } else if (e.tipo === 'simnao') {
      w = <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" style="width:auto" disabled={travado} checked={!!(explicito ?? efetivo)} onChange={(x) => setEntrada(e.id, x.currentTarget.checked)} /> Sim</label>;
    } else if (e.tipo === 'texto') {
      w = <input disabled={travado} style={estilo} value={String(explicito ?? '')} placeholder={efetivo === null || efetivo === undefined ? '' : String(efetivo)} onInput={(x) => setEntrada(e.id, x.currentTarget.value)} />;
    } else {
      w = <CampoValor key={`${e.id}-${explicito ?? ''}`} valor={typeof explicito === 'number' ? explicito : null} ph={efetivo === null || efetivo === undefined ? '' : String(efetivo)} aoMudar={(n) => { if (!travado) setEntrada(e.id, n === null ? undefined : n); }} />;
    }
    return (
      <div key={e.id}>
        <label>{e.rotulo}{e.unidade ? ` (${e.unidade})` : ''}{e.obrigatoria ? ' *' : ''}</label>
        {w}
        {e.ajuda && <div class="peq">{e.ajuda}</div>}
      </div>
    );
  };

  return (
    <>
      <h2>Escopo</h2>
      <fieldset class="sem-borda" disabled={travado}>
        <div class="cartao">
          {def.escopo.map((s) => (
            <label key={s.id} style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;color:var(--texto)">
              <input type={s.exclusivo ? 'radio' : 'checkbox'} style="width:auto;min-height:0;margin-top:4px" checked={calc.escopo.includes(s.id)} onClick={() => alternarEscopo(s.id, s.exclusivo)} onChange={() => {}} />
              <span>{s.rotulo}{s.ajuda && <span class="peq"> — {s.ajuda}</span>}</span>
            </label>
          ))}
          {!calc.escopo.length && <div class="alerta">Escolha o escopo para a calculadora ligar os blocos de custo.</div>}
        </div>

        {grupos.map((g) => (
          <div key={g}>
            <h2>{g}</h2>
            <div class="cartao"><div class="grade2">{def.entradas.filter((e) => (e.grupo ?? 'Dados') === g && motor.visiveis.includes(e.id)).map(campo)}</div></div>
          </div>
        ))}

        <h2>Preço</h2>
        <div class="cartao">
          <div class="grade2">
            <div><label style="margin-top:0">Margem líquida desejada (%)</label>
              <CampoValor valor={calc.margemPct} ph="padrão dos Parâmetros" aoMudar={(n) => mudar({ margemPct: n })} /></div>
            <div><label style="margin-top:0">Contingência (%)</label>
              <CampoValor valor={calc.contingenciaPct} ph={`calculada: ${num(ao.contingenciaPct)}%`} aoMudar={(n) => mudar({ contingenciaPct: n })} /></div>
            <div><label>Nível de preço adotado</label>
              <select value={calc.nivelPreco} onChange={(e) => mudar({ nivelPreco: e.currentTarget.value as CalcOrcamento['nivelPreco'] })}>
                <option value="minimo">Mínimo</option><option value="recomendado">Recomendado</option><option value="maximo">Máximo</option>
              </select></div>
            {FATURAMENTOS.map((f) => (
              <div key={f}><label>Preço manual — {ROTULO_FATURAMENTO[f]} (opcional)</label>
                <CampoValor valor={calc.precoManual[f] ?? null} ph="usa o nível" aoMudar={(n) => { const m = { ...calc.precoManual }; if (n && n > 0) m[f] = n; else delete m[f]; mudar({ precoManual: m }); }} /></div>
            ))}
          </div>
        </div>
      </fieldset>

      <h2>Resultado</h2>
      <Resultado def={def} ao={ao} calc={calc} mudar={mudar} travado={travado} />
      <div class="cartao">
        <div class="fila">
          <button class="primario" disabled={travado || !!ao.bloqueios.length || ao.pontual.total === null} onClick={aoSalvar}>Salvar este cálculo no orçamento</button>
          {salvo && <span class="peq">Último cálculo salvo: {new Date(salvo.em).toLocaleString('pt-BR')}{desatualizado ? ' — mudou desde então: salve de novo para atualizar os itens e o PDF' : ' — igual ao que está na tela'}</span>}
          {!salvo && <span class="peq">Nenhum cálculo salvo: o orçamento ainda não tem itens nem preço.</span>}
        </div>
      </div>
    </>
  );
}

function Resultado({ def, ao, calc, mudar, travado }: { def: DefinicaoCalculadora; ao: ResultadoCompleto; calc: CalcOrcamento; mudar: (p: Partial<CalcOrcamento>) => void; travado: boolean }) {
  const { motor, pontual } = ao;
  const exemplos = motor.exemplos;
  const fiscalUsado = FATURAMENTOS.filter((f) => motor.linhas.some((l) => l.faturadoPor === f));
  return (
    <>
      {ao.bloqueios.length > 0 && (
        <div class="erro"><b>Sem preço por enquanto:</b><ul style="margin:4px 0 0;padding-left:18px">{ao.bloqueios.map((b) => <li key={b}>{b}</li>)}</ul></div>
      )}
      {pontual.alertas.map((a) => <div class="alerta" key={a}>{a}</div>)}
      {exemplos.length > 0 && <div class="alerta">Este cálculo usa {exemplos.length} parâmetro(s) de exemplo ({ROTULO_EXEMPLO}): {exemplos.slice(0, 6).join('; ')}{exemplos.length > 6 ? '…' : ''}. Não envie ao cliente antes de conferir.</div>}

      {fiscalUsado.length > 0 && (
        <div class="cartao">
          <b>Imposto por CNPJ</b>
          <table class="tabela"><thead><tr><th>Quem fatura</th><th>Anexo</th><th>RBT12</th><th>Alíquota efetiva</th></tr></thead>
            <tbody>{fiscalUsado.map((f) => {
              const x = ao.fiscal[f];
              return (
                <tr key={f}><td>{ROTULO_FATURAMENTO[f]}{x.unidadeNome && <div class="peq">{x.unidadeNome}</div>}</td><td>{x.anexo ?? '—'}</td><td>{x.rbt12 ? brl(x.rbt12) : '—'}</td>
                  <td>{x.ok ? <b>{pct1(x.aliquota)}</b> : <span style="color:var(--perigo)">bloqueado: {x.motivo}</span>}</td></tr>
              );
            })}</tbody></table>
          <p class="peq" style="margin-bottom:0">{AVISO_FISCAL}.</p>
        </div>
      )}

      {pontual.grupos.length > 0 && (
        <div class="cartao" style="overflow-x:auto">
          <b>Resumo por CNPJ (separado: custo, imposto, margem e preço)</b>
          <table class="tabela">
            <thead><tr><th></th>{pontual.grupos.map((g) => <th key={g.faturadoPor} style="text-align:right">{ROTULO_FATURAMENTO[g.faturadoPor]}</th>)}<th style="text-align:right">Total</th></tr></thead>
            <tbody>
              {([
                ['Custo direto', (g) => g.custoDireto, pontual.custoDireto],
                [`Contingência (${num(ao.contingenciaPct)}%)`, (g) => g.contingencia, pontual.grupos.reduce((s, g) => s + g.contingencia, 0)],
                ['Custo total', (g) => g.custoTotal, pontual.custoTotal],
              ] as [string, (g: (typeof pontual.grupos)[number]) => number, number][]).map(([rot, f, tot]) => (
                <tr key={rot}><td>{rot}</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{brl(f(g))}</td>)}<td style="text-align:right">{brl(tot)}</td></tr>
              ))}
              <tr><td>Imposto efetivo</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{g.impostoPct === null ? 'bloqueado' : `${num(g.impostoPct)}%`}</td>)}<td></td></tr>
              <tr><td>Preço mínimo</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{g.minimo === null ? '—' : brl(g.minimo)}</td>)}<td style="text-align:right">{sum(pontual.grupos.map((g) => g.minimo))}</td></tr>
              <tr><td>Preço recomendado</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{g.recomendado === null ? '—' : brl(g.recomendado)}</td>)}<td style="text-align:right">{sum(pontual.grupos.map((g) => g.recomendado))}</td></tr>
              <tr><td>Preço máximo</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{g.maximo === null ? '—' : brl(g.maximo)}</td>)}<td style="text-align:right">{sum(pontual.grupos.map((g) => g.maximo))}</td></tr>
              <tr style="font-weight:700"><td>Preço adotado</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{g.adotado === null ? '—' : brl(g.adotado)}</td>)}<td style="text-align:right">{pontual.total === null ? '—' : brl(pontual.total)}</td></tr>
              <tr><td>Imposto a pagar (estimado)</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{g.valorImposto === null ? '—' : brl(g.valorImposto)}</td>)}<td style="text-align:right">{sum(pontual.grupos.map((g) => g.valorImposto))}</td></tr>
              <tr><td>Margem líquida</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style={`text-align:right;${g.abaixoDaMinima ? 'color:var(--perigo);font-weight:700' : ''}`}>{pct1(g.margemAdotada)}</td>)}<td></td></tr>
              <tr><td>Lucro (após imposto e custo)</td>{pontual.grupos.map((g) => <td key={g.faturadoPor} style="text-align:right">{g.lucro === null ? '—' : brl(g.lucro)}</td>)}<td style="text-align:right">{sum(pontual.grupos.map((g) => g.lucro))}</td></tr>
            </tbody>
          </table>
          {pontual.entradaSugerida !== null && <p style="margin-bottom:0"><b>Entrada sugerida: {brl(pontual.entradaSugerida)}</b> <span class="peq">({pontual.entradaComposicao})</span></p>}
          {pontual.total !== null && <p class="peq" style="margin-bottom:0">Faturamento não é lucro: o lucro acima é o que sobra depois do custo e do imposto estimado.</p>}
          {ao.recorrente && ao.recorrente.total !== null && <p><b>Contrato de manutenção: {brl(ao.recorrente.total)} por mês</b> <span class="peq">(custo mensal {brl(ao.recorrente.custoTotal)})</span></p>}
          <p class="peq" style="margin-bottom:0">{AVISO_FISCAL}.{ao.fiscal.servico.retencaoIssPct || ao.fiscal.servico.retencaoInssPct ? ` Retenções possíveis nos serviços: ISS ${ao.fiscal.servico.retencaoIssPct ?? 0}% · INSS ${ao.fiscal.servico.retencaoInssPct ?? 0}% (afetam o caixa, não o preço).` : ''}</p>
        </div>
      )}

      {Object.keys(motor.valores).length > 0 && (
        <div class="cartao"><b>Números do cálculo</b>
          <div class="grade2">{Object.entries(motor.valores).map(([k, v]) => <div key={k} class="peq"><b>{String(v === null ? '—' : typeof v === 'number' ? num(v) : v)}</b> {def.variaveis.find((x) => x.id === k)?.unidade ?? ''} {def.variaveis.find((x) => x.id === k)?.rotulo ?? k}</div>)}</div>
        </div>
      )}

      {motor.linhas.length > 0 && (
        <div class="cartao" style="overflow-x:auto">
          <b>Linhas de custo</b>
          <table class="tabela">
            <thead><tr><th>Item</th><th style="text-align:right">Qtd.</th><th style="text-align:right">Custo unit.</th><th style="text-align:right">Custo</th><th style="text-align:right">Venda</th><th>Faturado por</th></tr></thead>
            <tbody>{CATEGORIAS.flatMap((c) => {
              const ls = motor.linhas.filter((l) => l.categoria === c && !l.recorrente);
              if (!ls.length) return [];
              return [
                <tr key={c}><td colSpan={6} style="background:#f1f4f2;font-weight:600">{ROTULO_CATEGORIA[c]} · {brl(ls.reduce((s, l) => s + l.custo, 0))}</td></tr>,
                ...ls.map((l) => (
                  <tr key={l.id}>
                    <td>{l.descricao}{l.fonte && <div class="peq">{l.fonte}</div>}</td>
                    <td style="text-align:right;white-space:nowrap">{num(l.quantidade)} {l.unidade}</td>
                    <td style="text-align:right">{brl(l.custoUnitario)}</td><td style="text-align:right">{brl(l.custo)}</td>
                    <td style="text-align:right">{l.venda === undefined ? '—' : brl(l.venda)}</td>
                    <td><select disabled={travado} style="min-height:32px;padding:2px 6px" value={l.faturadoPor} onChange={(e) => mudar({ faturadoPorLinha: { ...calc.faturadoPorLinha, [l.id]: e.currentTarget.value as Faturamento } })}>
                      {FATURAMENTOS.map((f) => <option key={f} value={f}>{ROTULO_FATURAMENTO[f]}</option>)}</select></td>
                  </tr>
                )),
              ];
            })}</tbody>
          </table>
          {motor.contingenciaExtra.map((c) => <p class="peq" key={c.motivo}>Contingência +{num(c.pct)}%: {c.motivo}.</p>)}
        </div>
      )}
    </>
  );
}

function sum(v: (number | null)[]): string {
  return v.some((x) => x === null) ? '—' : brl(v.reduce<number>((s, x) => s + (x ?? 0), 0));
}
