import { useState } from 'preact/hooks';
import { CampoValor } from '../componentes';
import { excluir, salvar, salvarOrcamento } from '../db';
import { validarDefinicao } from '../lib/calc/motor';
import { CALCULADORAS_DO_SISTEMA, catalogoCalculadoras } from '../lib/calc/orcamentoCalc';
import { vigentesEm } from '../lib/calc/parametros';
import { brl } from '../lib/calc/preco';
import { CATEGORIAS, ROTULO_CATEGORIA, type CalculadoraSalva, type Categoria, type DefinicaoCalculadora } from '../lib/calc/tipos';
import { fmtData, hojeSP } from '../lib/datas';
import { agoraIso, novoId, type Orcamento } from '../lib/model';
import { ir, useDados } from '../store';
import { classeStatus } from './OrcamentoObra';

// OR02 Calculadoras: definições declarativas (JSON). Criar uma calculadora nova = importar outra definição, sem código novo.
// OR04 Real × estimado: depois da obra, compara horas e custos reais com o estimado e sugere a produtividade corrigida.

function baixar(nome: string, texto: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Calculadoras() {
  const d = useDados();
  const lista = catalogoCalculadoras(d.calculadoras);
  const [texto, setTexto] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  async function importar(t: string) {
    setErros([]); setMsg('');
    let def: DefinicaoCalculadora;
    try { def = JSON.parse(t) as DefinicaoCalculadora; } catch { return setErros(['O texto não é um JSON válido.']); }
    const p = validarDefinicao(def);
    if (CALCULADORAS_DO_SISTEMA.some((c) => c.id === def.id)) p.push(`O id "${def.id}" é de uma calculadora do sistema: use outro id.`);
    if (p.length) return setErros(p);
    const agora = agoraIso();
    const existente = d.calculadoras.find((c) => c.definicao.id === def.id);
    const reg: CalculadoraSalva = existente
      ? { ...existente, nome: def.nome, definicao: def, excluidoEm: null }
      : { id: novoId(), nome: def.nome, definicao: def, criadoEm: agora, atualizadoEm: agora, excluidoEm: null };
    await salvar('calculadoras', reg);
    setTexto('');
    setMsg(`Calculadora "${def.nome}" ${existente ? 'atualizada' : 'cadastrada'}. Já aparece na criação de orçamentos.`);
  }

  return (
    <>
      <div class="cartao">
        <b>Calculadoras</b>
        <p class="peq" style="margin-bottom:0">Cada calculadora é só uma definição: entradas, escopo, fórmulas e blocos de custo. Os preços, horas e alíquotas vêm da aba Parâmetros. O motor é o mesmo para todas.</p>
      </div>
      {msg && <div class="sucesso">{msg}</div>}
      {lista.map((def) => {
        const salva = d.calculadoras.find((c) => c.definicao.id === def.id);
        return (
          <div class="cartao" key={def.id}>
            <div class="fila" style="align-items:flex-start">
              <div>
                <b>{def.nome}</b> <span class="selo">{salva ? 'criada por você' : 'do sistema'}</span> <span class="peq">v{def.versao} · id <code>{def.id}</code></span>
                {def.descricao && <div class="peq">{def.descricao}</div>}
                <div class="peq">{def.escopo.length} itens de escopo · {def.entradas.length} entradas · {def.variaveis.length} variáveis · {def.blocos.reduce((s, b) => s + b.linhas.length, 0)} linhas de custo em {def.blocos.length} blocos</div>
              </div>
              <div style="flex:0;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
                <button class="primario" onClick={() => ir(`orcamento/novo?calc=${encodeURIComponent(def.id)}`)}>Novo orçamento</button>
                <button onClick={() => baixar(`calculadora_${def.id}.json`, JSON.stringify(def, null, 2))}>Exportar JSON</button>
                {salva && <button class="perigo" onClick={async () => { if (confirm(`Excluir a calculadora "${def.nome}"? Orçamentos já feitos continuam com o resultado salvo.`)) await excluir('calculadoras', salva.id); }}>Excluir</button>}
              </div>
            </div>
          </div>
        );
      })}

      <h2>Cadastrar uma calculadora nova</h2>
      <div class="cartao">
        <p class="peq" style="margin-top:0">Exporte uma existente (ex.: CFTV), altere o <code>id</code>, as entradas, as fórmulas e os blocos e cole aqui. O sistema confere a definição antes de aceitar. Fórmulas usam <code>+ − * / ^ %</code>, comparações, <code>&amp;&amp; ||</code>, <code>se(cond, a, b)</code>, <code>max min teto piso arred proximoDe</code> e as funções de parâmetros <code>mo('tecnico')</code>, <code>prod('chave')</code>, <code>material('codigo')</code>, <code>dsl('item')</code>, <code>loc('município','km')</code>, <code>tec('regra')</code>, <code>com('regra')</code>, <code>tem('item_de_escopo')</code>.</p>
        <textarea rows={8} placeholder='{ "id": "eletrica", "nome": "Elétrica por ponto", "versao": 1, "escopo": [...], "entradas": [...], "variaveis": [...], "blocos": [...] }' value={texto} onInput={(e) => setTexto(e.currentTarget.value)} />
        {erros.length > 0 && <div class="erro"><b>A definição tem problemas:</b><ul style="margin:4px 0 0;padding-left:18px">{erros.map((e) => <li key={e}>{e}</li>)}</ul></div>}
        <div class="fila" style="margin-top:8px">
          <button class="primario" disabled={!texto.trim()} onClick={() => importar(texto)}>Conferir e cadastrar</button>
          <label class="botao" style="flex:0;white-space:nowrap;cursor:pointer">Abrir arquivo .json
            <input type="file" accept=".json,application/json" style="display:none" onChange={async (e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) setTexto(await f.text()); }} /></label>
        </div>
      </div>
    </>
  );
}

// ---------- OR04 Real × estimado ----------

export function RealEstimado() {
  const d = useDados();
  const obras = d.orcamentos.filter((o) => o.calc?.resultado).sort((a, b) => (a.status === 'Aprovado' ? 0 : 1) - (b.status === 'Aprovado' ? 0 : 1) || b.data.localeCompare(a.data));
  const [id, setId] = useState('');
  const o = obras.find((x) => x.id === id) ?? obras[0];
  if (!o) return <div class="cartao vazio">Nenhum orçamento com cálculo salvo. Depois que uma obra for feita, lance aqui as horas e os custos reais para recalibrar a produtividade.</div>;
  return (
    <>
      <div class="cartao">
        <label style="margin-top:0">Obra</label>
        <select value={o.id} onChange={(e) => setId(e.currentTarget.value)}>
          {obras.map((x) => <option key={x.id} value={x.id}>{x.numero} {`v${x.revisao + 1}`} · {x.cliente} · {x.status}</option>)}
        </select>
      </div>
      <Comparativo key={o.id} o={o} />
    </>
  );
}

function Comparativo({ o }: { o: Orcamento }) {
  const d = useDados();
  const res = o.calc!.resultado!;
  const [real, setReal] = useState(o.calc!.real ?? { atualizadoEm: '', horas: {}, custos: {}, observacao: '' });
  const [msg, setMsg] = useState('');
  const mo = res.motor.linhas.filter((l) => l.categoria === 'mao_obra' && !l.recorrente);
  const estHoras = mo.reduce((s, l) => s + l.quantidade, 0);
  const realHoras = mo.reduce((s, l) => s + (real.horas[l.id] ?? 0), 0);
  const estLancado = mo.filter((l) => (real.horas[l.id] ?? 0) > 0).reduce((s, l) => s + l.quantidade, 0);
  const estCusto = (c: Categoria) => res.motor.linhas.filter((l) => l.categoria === c && !l.recorrente).reduce((s, l) => s + l.custo, 0);
  const dif = (est: number, rl: number) => (est > 0 && rl > 0 ? `${rl >= est ? '+' : ''}${(((rl - est) / est) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
  const hoje = hojeSP();
  const prod = vigentesEm(d.parametros, 'produtividade', hoje);

  async function gravar() {
    await salvarOrcamento({ ...o, calc: { ...o.calc!, real: { ...real, atualizadoEm: agoraIso() } } });
    setMsg('Real × estimado salvo no orçamento.');
  }

  /** Produtividade corrigida = coeficiente atual × (horas reais ÷ horas estimadas) da linha. */
  const sugestoes = mo.flatMap((l) => {
    const rl = real.horas[l.id];
    if (!l.prodRef || !rl || rl <= 0 || l.quantidade <= 0) return [];
    const p = prod.find((x) => x.chave === l.prodRef);
    const atual = Number(p?.valores.horas);
    if (!p || !(atual > 0)) return [];
    return [{ l, p, atual, novo: Math.round(atual * (rl / l.quantidade) * 10000) / 10000 }];
  });

  async function aplicar(p: (typeof sugestoes)[number]) {
    if (!confirm(`Aplicar ${p.novo.toLocaleString('pt-BR')} h por unidade em "${p.p.chave}" a partir de hoje? (o valor antigo fica no histórico)`)) return;
    const agora = agoraIso();
    if (p.p.vigenteDe >= hoje) await salvar('parametros', { ...p.p, valores: { ...p.p.valores, horas: p.novo }, exemplo: false });
    else await salvar('parametros', { ...p.p, id: novoId(), valores: { ...p.p.valores, horas: p.novo }, vigenteDe: hoje, vigenteAte: null, exemplo: false, criadoEm: agora, atualizadoEm: agora, nota: `Recalibrado com a obra ${o.numero}` });
    setMsg(`Produtividade de "${p.p.chave}" atualizada.`);
  }

  return (
    <>
      <div class="cartao">
        <div class="fila"><b>{o.cliente}</b><span class={`selo status-${classeStatus(o.status)}`} style="flex:0">{o.status}</span></div>
        <div class="peq">Estimativa calculada em {fmtData(res.em.slice(0, 10))}. Lance as horas e custos que realmente aconteceram.</div>
      </div>
      {msg && <div class="sucesso">{msg}</div>}
      <div class="cartao" style="overflow-x:auto">
        <b>Horas de mão de obra</b>
        <table class="tabela"><thead><tr><th>Atividade</th><th style="text-align:right">Estimado (h)</th><th style="width:120px">Real (h)</th><th style="text-align:right">Diferença</th></tr></thead>
          <tbody>
            {mo.map((l) => <tr key={l.id}><td>{l.descricao}</td><td style="text-align:right">{l.quantidade.toLocaleString('pt-BR')}</td>
              <td><CampoValor valor={real.horas[l.id] ?? null} aoMudar={(n) => setReal({ ...real, horas: { ...real.horas, [l.id]: n ?? 0 } })} /></td>
              <td style="text-align:right">{dif(l.quantidade, real.horas[l.id] ?? 0)}</td></tr>)}
            <tr style="font-weight:700"><td>Total{estLancado < estHoras ? ' (só as atividades lançadas)' : ''}</td><td style="text-align:right">{estLancado.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td><td style="text-align:right">{realHoras.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td><td style="text-align:right">{dif(estLancado, realHoras)}</td></tr>
          </tbody></table>
      </div>
      <div class="cartao" style="overflow-x:auto">
        <b>Custos por categoria</b>
        <table class="tabela"><thead><tr><th>Categoria</th><th style="text-align:right">Estimado</th><th style="width:150px">Real (R$)</th><th style="text-align:right">Diferença</th></tr></thead>
          <tbody>{CATEGORIAS.map((c) => (
            <tr key={c}><td>{ROTULO_CATEGORIA[c]}</td><td style="text-align:right">{brl(estCusto(c))}</td>
              <td><CampoValor valor={real.custos[c] ?? null} aoMudar={(n) => setReal({ ...real, custos: { ...real.custos, [c]: n ?? undefined } })} /></td>
              <td style="text-align:right">{dif(estCusto(c), real.custos[c] ?? 0)}</td></tr>
          ))}</tbody></table>
        <label>Observações da obra</label>
        <textarea rows={2} value={real.observacao} onInput={(e) => setReal({ ...real, observacao: e.currentTarget.value })} />
        <button class="primario" style="margin-top:8px" onClick={gravar}>Salvar real × estimado</button>
      </div>
      {sugestoes.length > 0 && (
        <div class="cartao" style="overflow-x:auto">
          <b>Produtividade sugerida (para recalibrar)</b>
          <p class="peq">Horas por unidade corrigidas = valor atual × (horas reais ÷ horas estimadas da atividade). Confira se a obra foi típica antes de aplicar.</p>
          <table class="tabela"><thead><tr><th>Atividade</th><th style="text-align:right">Atual</th><th style="text-align:right">Sugerida</th><th></th></tr></thead>
            <tbody>{sugestoes.map((s) => <tr key={s.l.id}><td>{s.p.chave}<div class="peq">{s.l.descricao}</div></td><td style="text-align:right">{s.atual.toLocaleString('pt-BR')}</td><td style="text-align:right"><b>{s.novo.toLocaleString('pt-BR')}</b></td>
              <td><button style="min-height:32px;padding:4px 10px" onClick={() => aplicar(s)}>Aplicar</button></td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
