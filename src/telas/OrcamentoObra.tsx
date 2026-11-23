import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Topo } from '../componentes';
import { salvarOrcamento, excluir } from '../db';
import { CFTV } from '../lib/calc/cftv';
import { interpolar } from '../lib/calc/formula';
import {
  aplicarStatusObra, catalogoCalculadoras, compararVersoes, executarCalculo, itensDoResultado, pendenciasCriticasAbertas, podeMudarStatus, resumoPontos, sugestoesNovas,
} from '../lib/calc/orcamentoCalc';
import { brl } from '../lib/calc/preco';
import { FATURAMENTOS, ROTULO_FATURAMENTO, type CalcOrcamento, type DefinicaoCalculadora, type Faturamento, type PendenciaOrc } from '../lib/calc/tipos';
import { fmtData } from '../lib/datas';
import { nomeEmpresa, type Orcamento, type StatusOrcamento } from '../lib/model';
import { copiar, porExtenso, totalItem, totalOrcamento } from '../lib/orcamento';
import { fmtCnpj } from '../lib/unidades';
import { ir, useDados, useRota, voltar } from '../store';
import { AbaCalculo, AbaPontos } from './ObraCalculo';

// Orçamento com calculadora: cabeçalho + abas (Geral, Pontos, Pendências, Cálculo, Versões, Documentos).

const rev = (o: Orcamento) => `v${o.revisao + 1}`;
export const classeStatus = (s: string) => s.replace(/\s+/g, '-');
type Aba = 'geral' | 'pontos' | 'pendencias' | 'calculo' | 'versoes' | 'docs';

export function ObraEditor({ inicial }: { inicial: Orcamento }) {
  const d = useDados();
  const [o, setO] = useState(inicial);
  const [aba, setAba] = useState<Aba>('geral');
  const [msg, setMsg] = useState('');
  const [bloqueio, setBloqueio] = useState<string[]>([]);
  const pendente = useRef<Orcamento | null>(null);
  const travado = o.status === 'Enviado' || o.status === 'Aprovado' || o.status === 'Perdido';
  const calc = o.calc!;

  useEffect(() => {
    if (o === inicial) return;
    pendente.current = o;
    const t = setTimeout(() => { void salvarOrcamento(o); pendente.current = null; }, 700);
    return () => clearTimeout(t);
  }, [o]);
  useEffect(() => () => { if (pendente.current) void salvarOrcamento(pendente.current); }, []);

  const mudar = (p: Partial<Orcamento>) => setO((x) => ({ ...x, ...p }));
  const mudarCalc = (p: Partial<CalcOrcamento>) => setO((x) => ({ ...x, calc: { ...x.calc!, ...p } }));
  const empresa = o.empresaId ? d.porId.get(o.empresaId) : undefined;
  const def = useMemo(() => catalogoCalculadoras(d.calculadoras).find((c) => c.id === calc.calculadoraId) ?? CFTV, [d.calculadoras, calc.calculadoraId]);
  // cálculo ao vivo: sempre reflete as tabelas de parâmetros de hoje; só vira documento quando o usuário salva
  const ao = useMemo(() => executarCalculo({ def, calc, params: d.parametros, unidades: d.unidades, materiaisWms: d.materiaisWms }), [def, calc, d.parametros, d.unidades, d.materiaisWms]);
  const salvo = calc.resultado;
  const total = totalOrcamento(o);
  const abertas = pendenciasCriticasAbertas(calc);
  const r = useMemo(() => resumoPontos(calc.pontos), [calc.pontos]);

  function salvarCalculo() {
    const itens = itensDoResultado(ao.motor.linhas);
    const validade = Number(ao.motor.entradas.validade_dias);
    const premissas = calc.premissas.length ? calc.premissas : (def.premissas ?? []).map((p) => interpolar(p, { ...ao.motor.entradas, ...ao.motor.valores }));
    setO((x) => ({ ...x, itens, validadeDias: validade > 0 ? validade : x.validadeDias, calc: { ...x.calc!, resultado: ao, premissas } }));
    setMsg('Cálculo salvo: os itens do orçamento e os PDFs agora usam este resultado.');
  }

  async function aplicarStatus(s: StatusOrcamento) {
    setMsg(''); setBloqueio([]);
    const t = podeMudarStatus(o, s);
    if (!t.ok) return setBloqueio(t.bloqueios);
    if (t.avisos.length && !confirm(`${t.avisos.join('\n')}\n\nEnviar mesmo assim?`)) return;
    let motivo = '';
    if (s === 'Perdido') {
      const m = prompt('Motivo (vai para o CRM):', '');
      if (m === null) return;
      motivo = m.trim();
    }
    const res = aplicarStatusObra(o, s, empresa, motivo);
    pendente.current = null;
    await salvarOrcamento(res.orcamento, res.empresa);
    setO(res.orcamento);
    setMsg(res.empresa ? `Status: ${s}. CRM atualizado: ${nomeEmpresa(res.empresa)} na etapa ${res.empresa.etapa}.` : `Status: ${s}.`);
  }

  async function novaVersao() {
    if (pendente.current) await salvarOrcamento(pendente.current);
    const n = copiar(o);
    await salvarOrcamento(n);
    ir(`orcamento/${n.id}`);
  }

  const abas: [Aba, string][] = [['geral', 'Geral'], ['pontos', `Pontos (${r.total}${r.pendentes ? ` + ${r.pendentes}?` : ''})`], ['pendencias', `Pendências${abertas.length ? ` (${abertas.length})` : ''}`], ['calculo', 'Calculadora'], ['versoes', 'Versões'], ['docs', 'Documentos']];

  return (
    <>
      <Topo titulo={`${o.numero} · ${rev(o)}`} voltar={() => voltar('orcamentos')} />
      <main>
        <div class="cartao">
          <div class="fila">
            <span class={`selo status-${classeStatus(o.status)}`} style="flex:0;white-space:nowrap">{o.status}</span>
            <div>{o.cliente || '(sem cliente)'}{empresa && <span class="peq"> · CRM: etapa {empresa.etapa}</span>}</div>
            <b style="flex:0;white-space:nowrap">{total ? brl(total) : 'sem preço'}</b>
          </div>
          {msg && <div class="sucesso">{msg}</div>}
          {bloqueio.length > 0 && <div class="erro"><b>Não dá para mudar o status:</b><ul style="margin:4px 0 0;padding-left:18px">{bloqueio.map((b) => <li key={b}>{b}</li>)}</ul></div>}
          {abertas.length > 0 && !travado && <div class="alerta">{abertas.length} pendência(s) crítica(s) em aberto: bloqueiam "Enviado" até serem resolvidas.</div>}
          <div class="fila" style="margin-top:10px">
            {o.status === 'Rascunho' && <button onClick={() => aplicarStatus('Aguardando dados')}>Aguardando dados do cliente</button>}
            {o.status === 'Aguardando dados' && <button onClick={() => aplicarStatus('Rascunho')}>Voltar a rascunho</button>}
            {(o.status === 'Rascunho' || o.status === 'Aguardando dados') && <button class="primario" onClick={() => aplicarStatus('Enviado')}>Marcar como enviado</button>}
            {o.status === 'Enviado' && <button class="primario" onClick={() => aplicarStatus('Aprovado')}>Aprovado</button>}
            {(o.status === 'Enviado' || o.status === 'Rascunho' || o.status === 'Aguardando dados') && <button onClick={() => aplicarStatus('Perdido')}>Perdido</button>}
            <button onClick={novaVersao}>Nova versão</button>
          </div>
          {travado && <p class="peq">Orçamento {o.status.toLowerCase()}: para alterar, crie uma nova versão.</p>}
          {o.status === 'Perdido' && o.motivoRecusa && <p class="peq">Motivo: {o.motivoRecusa}</p>}
        </div>

        <nav class="abas" style="position:static;margin-bottom:10px;border:1px solid var(--borda);border-radius:10px">
          {abas.map(([id, rot]) => <a key={id} href="#" class={aba === id ? 'ativa' : ''} onClick={(e) => { e.preventDefault(); setAba(id); }}>{rot}</a>)}
        </nav>

        {aba === 'geral' && <Geral o={o} mudar={mudar} mudarCalc={mudarCalc} travado={travado} />}
        {aba === 'pontos' && <AbaPontos calc={calc} mudar={mudarCalc} travado={travado} />}
        {aba === 'pendencias' && <Pendencias calc={calc} mudarCalc={mudarCalc} travado={travado} sugeridas={sugestoesNovas(calc, ao)} />}
        {aba === 'calculo' && <AbaCalculo def={def} calc={calc} mudar={mudarCalc} travado={travado} ao={ao} salvo={salvo} aoSalvar={salvarCalculo} />}
        {aba === 'versoes' && <Versoes o={o} />}
        {aba === 'docs' && <Documentos o={o} aoAbrir={() => { if (pendente.current) void salvarOrcamento(pendente.current); }} />}

        <div class="fila" style="margin-top:16px">
          <button class="perigo" onClick={async () => { if (confirm(`Excluir o orçamento ${o.numero} ${rev(o)}? (fica no histórico e no backup)`)) { pendente.current = null; await excluir('orcamentos', o.id); ir('orcamentos'); } }}>Excluir</button>
        </div>
      </main>
    </>
  );
}

// ---------- Geral ----------

function Geral({ o, mudar, mudarCalc, travado }: { o: Orcamento; mudar: (p: Partial<Orcamento>) => void; mudarCalc: (p: Partial<CalcOrcamento>) => void; travado: boolean }) {
  const d = useDados();
  const calc = o.calc!;
  const empresa = o.empresaId ? d.porId.get(o.empresaId) : undefined;
  const c = calc.contato;
  const setC = (p: Partial<typeof c>) => mudarCalc({ contato: { ...c, ...p } });
  return (
    <fieldset class="sem-borda" disabled={travado}>
      <h2>Cliente e oportunidade</h2>
      <div class="cartao">
        <label style="margin-top:0">Oportunidade no CRM (a empresa liga o orçamento ao funil)</label>
        <input list="lista-empresas-obra" value={empresa ? nomeEmpresa(empresa) : ''} placeholder="Digite para buscar" onChange={(e) => {
          const emp = d.empresas.find((x) => nomeEmpresa(x) === e.currentTarget.value);
          mudar(emp ? { empresaId: emp.id, cliente: o.cliente || nomeEmpresa(emp) } : { empresaId: null });
        }} />
        <datalist id="lista-empresas-obra">{d.empresas.map((e) => <option key={e.id} value={nomeEmpresa(e)} />)}</datalist>
        {empresa && <p class="peq"><a href={`#/empresa/${empresa.id}`}>Abrir ficha no CRM</a></p>}
        <div class="grade2">
          <div><label>Cliente (como sai na proposta)</label><input value={o.cliente} onInput={(e) => mudar({ cliente: e.currentTarget.value })} /></div>
          <div><label>Local da obra</label><input value={o.local} placeholder="Endereço da obra (pendente?)" onInput={(e) => mudar({ local: e.currentTarget.value })} /></div>
          <div><label>Contato — nome</label><input value={c.nome} onInput={(e) => { setC({ nome: e.currentTarget.value }); mudar({ aosCuidados: e.currentTarget.value }); }} /></div>
          <div><label>Cargo</label><input value={c.cargo} onInput={(e) => setC({ cargo: e.currentTarget.value })} /></div>
          <div><label>E-mail</label><input value={c.email} onInput={(e) => { setC({ email: e.currentTarget.value }); mudar({ email: e.currentTarget.value }); }} /></div>
          <div><label>Telefone</label><input value={c.telefone} onInput={(e) => setC({ telefone: e.currentTarget.value })} /></div>
          <div><label>Com cópia</label><input value={c.copia.join('; ')} onInput={(e) => setC({ copia: e.currentTarget.value.split(';').map((x) => x.trim()).filter(Boolean) })} /></div>
          <div><label>Origem do pedido</label><input value={calc.origem} onInput={(e) => mudarCalc({ origem: e.currentTarget.value })} /></div>
        </div>
      </div>

      <h2>Proposta</h2>
      <div class="cartao">
        <div class="grade2">
          <div><label style="margin-top:0">Número</label><input value={o.numero} onInput={(e) => mudar({ numero: e.currentTarget.value })} /></div>
          <div><label style="margin-top:0">Data</label><input type="date" value={o.data} onInput={(e) => mudar({ data: e.currentTarget.value })} /></div>
          <div><label>Título</label><input value={o.titulo} onInput={(e) => mudar({ titulo: e.currentTarget.value })} /></div>
          <div><label>Serviço</label><input value={o.subtitulo} onInput={(e) => mudar({ subtitulo: e.currentTarget.value })} /></div>
          <div><label>Validade (dias)</label><input inputMode="numeric" value={String(o.validadeDias)} onInput={(e) => mudar({ validadeDias: Math.max(0, Math.round(Number(e.currentTarget.value) || 0)) })} /></div>
          <div><label>Condições de pagamento</label><input value={o.pagamento} placeholder="ex.: entrada de materiais + saldo na conclusão" onInput={(e) => mudar({ pagamento: e.currentTarget.value })} /></div>
        </div>
        <label>Referência</label><input value={o.referencia} onInput={(e) => mudar({ referencia: e.currentTarget.value })} />
      </div>

      <h2>Premissas</h2>
      <div class="cartao">
        <textarea rows={Math.min(12, Math.max(4, calc.premissas.length + 2))} value={calc.premissas.join('\n')} placeholder="Uma premissa por linha. Aparecem no PDF." onInput={(e) => mudarCalc({ premissas: e.currentTarget.value.split('\n') })} />
        <p class="peq" style="margin-bottom:0">Ex.: "Presume-se CFTV (câmeras); confirmar por escrito." Se ficar vazio, ao salvar o cálculo entram as premissas da calculadora.</p>
      </div>
    </fieldset>
  );
}

// ---------- Pendências (checklist) ----------

function Pendencias({ calc, mudarCalc, travado, sugeridas }: { calc: CalcOrcamento; mudarCalc: (p: Partial<CalcOrcamento>) => void; travado: boolean; sugeridas: PendenciaOrc[] }) {
  const [novo, setNovo] = useState('');
  const alterar = (id: string, p: Partial<PendenciaOrc>) => mudarCalc({ pendencias: calc.pendencias.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const abertas = calc.pendencias.filter((p) => !p.resolvida);
  const criticas = abertas.filter((p) => p.critica);
  return (
    <fieldset class="sem-borda" disabled={travado}>
      <div class="cartao">
        <b>{abertas.length} em aberto · {criticas.length} crítica(s)</b>
        <p class="peq" style="margin-bottom:0">Pendência crítica em aberto bloqueia a mudança para "Enviado". Marque como resolvida e anote a resposta do cliente.</p>
      </div>
      {calc.pendencias.map((p, i) => (
        <div class="cartao" key={p.id} style={p.resolvida ? 'opacity:.7' : p.critica ? 'border-left:4px solid var(--perigo)' : ''}>
          <div class="fila" style="align-items:flex-start;flex-wrap:nowrap">
            <input type="checkbox" style="width:22px;min-height:22px;flex:0 0 22px;margin-top:6px" checked={p.resolvida} onChange={(e) => alterar(p.id, { resolvida: e.currentTarget.checked })} />
            <div style="flex:1">
              <div class="fila" style="flex-wrap:nowrap"><span class="peq" style="flex:0">{i + 1}.</span>
                <input value={p.texto} style={p.resolvida ? 'text-decoration:line-through' : ''} onInput={(e) => alterar(p.id, { texto: e.currentTarget.value })} />
                <label style="flex:0;white-space:nowrap;margin:0;display:flex;gap:4px;align-items:center"><input type="checkbox" style="width:auto;min-height:0" checked={p.critica} onChange={(e) => alterar(p.id, { critica: e.currentTarget.checked })} /> crítica</label>
                <button class="perigo" style="flex:0;min-height:32px;padding:2px 8px" onClick={() => mudarCalc({ pendencias: calc.pendencias.filter((x) => x.id !== p.id) })}>✕</button>
              </div>
              <input style="margin-top:4px" placeholder="Resposta do cliente / como foi resolvida" value={p.resposta} onInput={(e) => alterar(p.id, { resposta: e.currentTarget.value })} />
              {p.origem === 'calculadora' && <div class="peq">sugerida pela calculadora</div>}
            </div>
          </div>
        </div>
      ))}
      {!travado && (
        <div class="cartao">
          <div class="fila">
            <input placeholder="Nova pendência" value={novo} onInput={(e) => setNovo(e.currentTarget.value)} />
            <button style="flex:0;white-space:nowrap" disabled={!novo.trim()} onClick={() => { mudarCalc({ pendencias: [...calc.pendencias, { id: `m${Date.now().toString(36)}`, texto: novo.trim(), critica: true, resolvida: false, resposta: '', origem: 'manual' }] }); setNovo(''); }}>+ Pendência crítica</button>
          </div>
        </div>
      )}
      {sugeridas.length > 0 && !travado && (
        <div class="cartao">
          <b>Sugeridas pela calculadora</b>
          {sugeridas.map((s) => (
            <div class="fila" key={s.id} style="padding:4px 0"><span style="flex:1">{s.critica && <span class="selo status-Perdido">crítica</span>} {s.texto}</span>
              <button style="flex:0;white-space:nowrap;min-height:32px" onClick={() => mudarCalc({ pendencias: [...calc.pendencias, s] })}>+ ao checklist</button></div>
          ))}
        </div>
      )}
    </fieldset>
  );
}

// ---------- Versões ----------

function Versoes({ o }: { o: Orcamento }) {
  const d = useDados();
  const todas = d.orcamentos.filter((x) => x.numero === o.numero).sort((a, b) => a.revisao - b.revisao);
  const [a, setA] = useState(todas.length > 1 ? todas[todas.length - 2].id : o.id);
  const [b, setB] = useState(o.id);
  const va = todas.find((x) => x.id === a), vb = todas.find((x) => x.id === b);
  const dif = va && vb ? compararVersoes(va, vb) : [];
  return (
    <>
      <div class="cartao">
        <b>Versões de {o.numero}</b>
        <table class="tabela"><thead><tr><th>Versão</th><th>Data</th><th>Status</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>{todas.map((x) => (
            <tr key={x.id}><td><a href={`#/orcamento/${x.id}`}>{rev(x)}{x.id === o.id ? ' (esta)' : ''}</a></td><td>{fmtData(x.data)}</td><td><span class={`selo status-${classeStatus(x.status)}`}>{x.status}</span></td>
              <td style="text-align:right">{totalOrcamento(x) ? brl(totalOrcamento(x)) : '—'}</td></tr>
          ))}</tbody></table>
      </div>
      {todas.length < 2 ? <div class="cartao vazio">Só existe uma versão. Use "Nova versão" no topo para criar a v2 e comparar.</div> : (
        <div class="cartao" style="overflow-x:auto">
          <div class="fila"><select value={a} onChange={(e) => setA(e.currentTarget.value)}>{todas.map((x) => <option key={x.id} value={x.id}>{rev(x)}</option>)}</select>
            <span style="flex:0">→</span>
            <select value={b} onChange={(e) => setB(e.currentTarget.value)}>{todas.map((x) => <option key={x.id} value={x.id}>{rev(x)}</option>)}</select></div>
          {!dif.length ? <p class="peq">Nenhuma diferença entre as duas versões.</p> : (
            <table class="tabela"><thead><tr><th>O que mudou</th><th>{va && rev(va)}</th><th>{vb && rev(vb)}</th></tr></thead>
              <tbody>{dif.map((x) => <tr key={x.campo}><td>{x.campo}</td><td>{x.a}</td><td><b>{x.b}</b></td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </>
  );
}

// ---------- Documentos (um PDF por CNPJ) ----------

function Documentos({ o, aoAbrir }: { o: Orcamento; aoAbrir: () => void }) {
  const calc = o.calc!;
  const res = calc.resultado;
  const por = (f: Faturamento) => o.itens.filter((i) => i.faturadoPor === f);
  const pronto = !!res && res.pontual.total !== null;
  return (
    <>
      <div class="cartao">
        <b>Propostas por CNPJ (sem misturar)</b>
        <p class="peq">Cada CNPJ emite o seu documento, com o seu cabeçalho e só os seus itens: serviços no papel timbrado da SOF Montagens, material no da loja.</p>
        {!pronto && <div class="alerta">Ainda não há cálculo salvo com preço. Preencha escopo e dados na aba Calculadora e salve o cálculo.</div>}
        {FATURAMENTOS.map((f) => {
          const itens = por(f);
          const fis = res?.fiscal[f];
          return (
            <div key={f} class="fila" style="padding:6px 0;border-top:1px solid var(--borda)">
              <div><b>{ROTULO_FATURAMENTO[f]}</b>{fis?.unidadeNome && <span class="peq"> · {fis.unidadeNome} · CNPJ {fmtCnpj(fis.cnpj ?? '')}</span>}
                <div class="peq">{itens.length} item(ns) · {brl(itens.reduce((s, i) => s + totalItem(i), 0))}</div></div>
              <button style="flex:0;white-space:nowrap" disabled={!pronto || !itens.length} onClick={() => { aoAbrir(); ir(`imprimir/${o.id}?cnpj=${f}`); }}>🖨 Gerar PDF</button>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- impressão (PDF) ----------

const fmtDataLonga = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function ImprimirObra({ o }: { o: Orcamento }) {
  const d = useDados();
  const rota = useRota();
  const calc = o.calc!;
  const res = calc.resultado;
  const fat: Faturamento = rota.q.get('cnpj') === 'servico' ? 'servico' : 'produto';
  const emissor = res?.fiscal[fat];
  const u = d.unidades.find((x) => x.id === emissor?.unidadeId);
  useEffect(() => { document.title = `${o.numero} ${rev(o)} – ${o.cliente} (${ROTULO_FATURAMENTO[fat]})`; return () => { document.title = 'KIVOR-CRM'; }; }, [o.id, fat]);

  const barra = (
    <div class="barra-impressao">
      <button onClick={() => voltar(`orcamento/${o.id}`)}>← Voltar</button>
    </div>
  );
  if (!res || res.pontual.total === null || !u) {
    return <div class="impressao">{barra}<main><div class="erro">Este orçamento não pode ser impresso ainda: {!res || res.pontual.total === null ? 'não há cálculo salvo com preço.' : `a empresa que emite ${ROTULO_FATURAMENTO[fat]} não está cadastrada (Ajustes › Empresas do grupo).`}</div></main></div>;
  }
  const itens = o.itens.filter((i) => i.faturadoPor === fat);
  const total = Math.round(itens.reduce((s, i) => s + totalItem(i), 0) * 100) / 100;
  const g = res.pontual.grupos.find((x) => x.faturadoPor === fat);
  const entrada = fat === 'produto' ? g?.vendaMateriais : g?.vendaMobilizacao;
  const escopo = escopoDoDocumento(catalogoCalculadoras(d.calculadoras).find((c) => c.id === calc.calculadoraId) ?? CFTV, calc, fat);
  const premissas = calc.premissas.map((p) => p.trim()).filter(Boolean);
  const pontos = resumoPontos(calc.pontos);
  const titulo = fat === 'produto' ? 'Fornecimento de materiais' : 'Prestação de serviços';
  const nomeDoc = u.nome;
  const cnpj = fmtCnpj(u.cnpj);
  const pend = pendenciasCriticasAbertas(calc).length;

  return (
    <div class="impressao">
      <div class="barra-impressao">
        <button onClick={() => voltar(`orcamento/${o.id}`)}>← Voltar</button>
        <button class="primario" onClick={() => print()}>🖨 Imprimir / salvar em PDF</button>
        <span class="peq">Documento de {ROTULO_FATURAMENTO[fat]}: só itens deste CNPJ. Desmarque "Cabeçalhos e rodapés".</span>
        {pend > 0 && <span class="erro" style="margin:0">Há {pend} pendência(s) crítica(s) em aberto: não envie ao cliente.</span>}
      </div>
      <table class="doc">
        <thead><tr><td><div class="doc-topo"><span class="doc-marca">{nomeDoc}</span><span class="doc-cnpj">CNPJ {cnpj}</span></div></td></tr></thead>
        <tfoot><tr><td><div class="doc-rodape"><span><b>{u.telefone && <>CONTATO: <em>{u.telefone}</em> · </>}</b>{u.email} · CNPJ {cnpj}</span></div></td></tr></tfoot>
        <tbody>
          <tr><td class="doc-corpo">
            <p class="doc-data">{u.cidade || 'Serra/ES'}, {fmtDataLonga(o.data)}.</p>
            <h1 class="doc-titulo">{titulo}</h1>
            {o.subtitulo && <div class="doc-subtitulo">{o.subtitulo}</div>}
            <div class="doc-linha" />
            {o.local && <div class="doc-local">{o.local}</div>}
            <p class="doc-cab">
              <b>PROPOSTA:</b> {o.numero} · {rev(o)}<br />
              <b>CLIENTE:</b> {o.cliente}<br />
              {o.aosCuidados && <><b>AT.:</b> {o.aosCuidados}<br /></>}
              {o.email && <><b>E-MAIL:</b> {o.email}<br /></>}
              {o.referencia && <><b>Ref.:</b> {o.referencia}</>}
            </p>
            <p>Senhores,</p>
            <p>Apresentamos nossa Proposta Comercial {o.numero} {rev(o)}, referente {fat === 'produto' ? 'ao fornecimento dos materiais' : 'à prestação dos serviços'} descritos abaixo.</p>
          </td></tr>
          {escopo.length > 0 && <tr><td class="doc-corpo doc-secao"><h2>1. Escopo</h2><ul>{escopo.map((e) => <li key={e}>{e}</li>)}</ul>
            {fat === 'servico' && pontos.total > 0 && <p>Pontos de instalação: <b>{pontos.total}</b> ({pontos.porGrupo.map(([k, n]) => `${k}: ${n}`).join('; ')}).</p>}</td></tr>}
          <tr><td class="doc-corpo doc-secao">
            <h2>{escopo.length ? '2' : '1'}. Investimento e condições comerciais</h2>
            <table class="doc-itens">
              <thead><tr><th>Item</th><th>Descrição</th><th>Unid.</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
              <tbody>{itens.map((it, k) => <tr key={k}><td>{String(k + 1).padStart(2, '0')}</td><td>{it.descricao}</td><td>{it.unidade}</td><td>{it.quantidade.toLocaleString('pt-BR')}</td><td>{brl(it.valorUnitario)}</td><td>{brl(totalItem(it))}</td></tr>)}</tbody>
            </table>
            <table class="doc-condicoes"><tbody>
              <tr><th>Valor total</th><td><b>{brl(total)}</b> ({porExtenso(total)})</td></tr>
              {entrada ? <tr><th>Entrada</th><td>{brl(entrada)} {fat === 'produto' ? '(materiais)' : '(mobilização)'}; saldo na conclusão</td></tr> : null}
              {o.pagamento && <tr><th>Condições de pagamento</th><td>{o.pagamento}</td></tr>}
              <tr><th>Impostos</th><td>Os impostos desta proposta estão incluídos nos valores.</td></tr>
              <tr><th>Validade da proposta</th><td>{o.validadeDias} dias a contar da data de emissão</td></tr>
            </tbody></table>
          </td></tr>
          {premissas.length > 0 && <tr><td class="doc-corpo doc-secao"><h2>{escopo.length ? '3' : '2'}. Premissas</h2><ul>{premissas.map((p, i) => <li key={i}>{p}</li>)}</ul></td></tr>}
          <tr><td class="doc-corpo">
            <p style="margin-top:18px">Estamos à inteira disposição para ajustar este escopo ou realizar uma reunião de alinhamento técnico.</p>
            <p><i>Atenciosamente,</i></p>
            <p class="doc-assina"><b>{u.responsavel}</b><br />{u.cargo && <>{u.cargo} · </>}{nomeDoc} · CNPJ {cnpj}</p>
            <div class="doc-aceite">
              <h2>Aceite da proposta</h2>
              <p>Declaro estar de acordo com os termos, escopo e condições comerciais descritos nesta proposta.</p>
              <p>Nome do responsável (cliente): ________________________________________________</p>
              <p>Assinatura: ______________________________ &nbsp; Data: ______ / ______ / {o.data.slice(0, 4)}</p>
            </div>
          </td></tr>
        </tbody>
      </table>
    </div>
  );
}

/** O que cada CNPJ entrega, em linguagem de proposta (a partir do escopo marcado). */
function escopoDoDocumento(def: DefinicaoCalculadora, calc: CalcOrcamento, fat: Faturamento): string[] {
  const rot = (id: string) => def.escopo.find((e) => e.id === id)?.rotulo ?? id;
  if (fat === 'produto') return calc.escopo.includes('fornecimento') ? [rot('fornecimento')] : [];
  return calc.escopo.filter((e) => e !== 'fornecimento').map(rot);
}

