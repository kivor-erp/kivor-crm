import { hojeSP } from '../datas';
import { ETAPA_FECHADO, agoraIso, novoId, type Contato, type Empresa, type ItemOrcamento, type Material, type Orcamento, type StatusOrcamento, type Unidade } from '../model';
import { mudarStatus, novoOrcamento } from '../orcamento';
import { normalizar } from '../texto';
import { CFTV } from './cftv';
import { calcular, validarDefinicao } from './motor';
import { criarContexto, resolverFiscal, vigentesEm } from './parametros';
import { precificar } from './preco';
import {
  FATURAMENTOS, ROTULO_CATEGORIA, ROTULO_FATURAMENTO,
  type CalcOrcamento, type CalculadoraSalva, type DefinicaoCalculadora, type Faturamento, type LinhaCalc,
  type Parametro, type PendenciaOrc, type PontoOrc, type ResultadoCompleto, type ResumoPreco, type Valor,
} from './tipos';

// Orquestração: junta pontos + parâmetros + definição da calculadora → resultado (custo, imposto por CNPJ, preço).

export const CALCULADORAS_DO_SISTEMA: DefinicaoCalculadora[] = [CFTV];

export function catalogoCalculadoras(salvas: CalculadoraSalva[]): DefinicaoCalculadora[] {
  const out = [...CALCULADORAS_DO_SISTEMA];
  for (const s of salvas) if (!s.excluidoEm && !out.some((d) => d.id === s.definicao.id) && !validarDefinicao(s.definicao).length) out.push(s.definicao);
  return out;
}

// ---------- pontos (câmeras por local) ----------

export interface ResumoPontos {
  /** pontos que serão instalados (soma das quantidades confirmadas) */
  total: number;
  linhas: number;
  /** linhas com quantidade "?" */
  pendentes: number;
  naoInstalar: number;
  comAudio: number;
  comDetalhe: number;
  semDetalhe: number;
  porDetalhe: [string, number][];
  porGrupo: [string, number][];
}

export const SEM_DETALHE = '(sem detalhe)';

export function resumoPontos(pontos: PontoOrc[]): ResumoPontos {
  const r: ResumoPontos = { total: 0, linhas: pontos.length, pendentes: 0, naoInstalar: 0, comAudio: 0, comDetalhe: 0, semDetalhe: 0, porDetalhe: [], porGrupo: [] };
  const det = new Map<string, number>();
  const grp = new Map<string, number>();
  for (const p of pontos) {
    if (p.situacao === 'pendente') { r.pendentes++; continue; }
    if (p.situacao === 'nao_instalar') { r.naoInstalar++; continue; }
    const q = p.qtd ?? 0;
    r.total += q;
    if (p.audio) r.comAudio += q;
    if (p.detalhe) r.comDetalhe += q; else r.semDetalhe += q;
    det.set(p.detalhe || SEM_DETALHE, (det.get(p.detalhe || SEM_DETALHE) ?? 0) + q);
    grp.set(p.grupo, (grp.get(p.grupo) ?? 0) + q);
  }
  r.porDetalhe = [...det].sort((a, b) => (a[0] === SEM_DETALHE ? 1 : b[0] === SEM_DETALHE ? -1 : a[0].localeCompare(b[0], 'pt-BR')));
  r.porGrupo = [...grp];
  return r;
}

export function extrasDePontos(pontos: PontoOrc[]): Record<string, Valor> {
  const r = resumoPontos(pontos);
  return {
    pontos_total: r.total, pontos_audio: r.comAudio, pontos_pendentes: r.pendentes, pontos_sem_detalhe: r.semDetalhe,
    pontos_com_detalhe: r.comDetalhe, pontos_nao_instalar: r.naoInstalar,
  };
}

/** CSV `grupo;local;qtd;detalhe;audio;obs`. qtd: número, "?" (pendente) ou "N/A" (não instalar). */
export function pontosDeCsv(csv: string): { pontos: PontoOrc[]; erros: string[] } {
  const pontos: PontoOrc[] = [];
  const erros: string[] = [];
  csv.split(/\r?\n/).forEach((linha, i) => {
    if (!linha.trim()) return;
    const c = linha.split(';').map((x) => x.trim());
    if (i === 0 && normalizar(c[0]) === 'grupo') return;
    if (c.length < 3) { erros.push(`Linha ${i + 1}: faltam colunas.`); return; }
    const [grupo, local, q, detalhe = '', audio = '', obs = ''] = c;
    let qtd: number | null = null;
    let situacao: PontoOrc['situacao'] = 'ok';
    if (q === '?') situacao = 'pendente';
    else if (q.toUpperCase() === 'N/A') situacao = 'nao_instalar';
    else if (/^\d+$/.test(q)) qtd = Number(q);
    else { erros.push(`Linha ${i + 1}: quantidade "${q}" não entendida.`); return; }
    pontos.push({ id: `p${String(pontos.length + 1).padStart(3, '0')}`, grupo, local, qtd, situacao, detalhe, audio: ['sim', 's', 'x'].includes(normalizar(audio)), obs });
  });
  return { pontos, erros };
}

// ---------- cálculo ----------

export interface EntradaExecucao {
  def: DefinicaoCalculadora;
  calc: CalcOrcamento;
  params: Parametro[];
  unidades: Unidade[];
  materiaisWms: Material[];
  data?: string;
}

function resumoVazio(): ResumoPreco {
  return { grupos: [], custoDireto: 0, custoTotal: 0, total: null, entradaSugerida: null, entradaComposicao: '', alertas: [] };
}

export function executarCalculo(a: EntradaExecucao): ResultadoCompleto {
  const data = a.data ?? hojeSP();
  const { def, calc } = a;
  const ctx = criarContexto(a.params, data, a.materiaisWms, extrasDePontos(calc.pontos));
  const motor = calcular(def, calc.entradas, calc.escopo, ctx, calc.faturadoPorLinha);
  const fiscal = resolverFiscal(a.params, a.unidades, data);
  const bloqueios: string[] = [];

  const com = new Map(vigentesEm(a.params, 'comercial', data).map((p) => [p.chave, p]));
  const comNum = (k: string): number | null => {
    const v = com.get(k)?.valores.valor;
    if (v === null || v === undefined || v === '') { bloqueios.push(`Parâmetro comercial "${k}" não preenchido.`); return null; }
    if (com.get(k)?.exemplo) ctx.exemplos.add(`Comerciais › ${k}`);
    return Number(v);
  };

  if (!calc.escopo.length) bloqueios.push('Selecione o escopo (o que a SOF vai fazer).');
  if (motor.faltando.length) {
    const nome = (id: string) => def.entradas.find((e) => e.id === id)?.rotulo ?? id;
    bloqueios.push(`Faltam dados da calculadora: ${motor.faltando.map(nome).join(', ')}.`);
  }
  for (const e of motor.erros) bloqueios.push(e);

  const margemMin = comNum('margem_minima'), margemAlvo = comNum('margem_alvo'), margemMax = comNum('margem_maxima');
  const contBase = comNum('contingencia'), entradaRef = comNum('entrada_pct');
  const contExtra = motor.contingenciaExtra.reduce((s, c) => s + c.pct, 0);
  const contingenciaPct = calc.contingenciaPct ?? ((contBase ?? 0) + contExtra);

  let pontual = resumoVazio();
  let recorrente: ResumoPreco | null = null;
  const parametrosCompletos = [margemMin, margemAlvo, margemMax, contBase, entradaRef].every((x) => x !== null);
  if (!bloqueios.length && parametrosCompletos && motor.linhas.length) {
    const base = {
      contingenciaPct, margemPct: calc.margemPct ?? margemAlvo!, margemMinimaPct: margemMin!, margemMaximaPct: margemMax!,
      imposto: { produto: fiscal.produto.aliquota, servico: fiscal.servico.aliquota }, entradaPctReferencia: entradaRef!,
      precoManual: calc.precoManual, nivel: calc.nivelPreco,
    };
    const unica = motor.linhas.filter((l) => !l.recorrente);
    const mensal = motor.linhas.filter((l) => l.recorrente);
    const p = precificar(unica, base);
    pontual = p.resumo;
    motor.linhas = [...p.linhas, ...mensal];
    if (mensal.length) {
      // contrato mensal: mesma conta, sem contingência de obra nem preço manual
      const r = precificar(mensal, { ...base, precoManual: undefined });
      recorrente = r.resumo;
      motor.linhas = [...p.linhas, ...r.linhas];
    }
    for (const fat of FATURAMENTOS) {
      if (!fiscal[fat].ok && motor.linhas.some((l) => l.faturadoPor === fat)) bloqueios.push(`${ROTULO_FATURAMENTO[fat]}: ${fiscal[fat].motivo}`);
    }
  }
  motor.exemplos = [...ctx.exemplos];
  return { em: agoraIso(), calculadoraId: def.id, calculadoraVersao: def.versao, motor, contingenciaPct, pontual, recorrente, bloqueios, fiscal };
}

// ---------- itens do documento (por CNPJ) ----------

const R2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Itens de venda do resultado: material linha a linha; serviços agrupados por categoria. Cada item leva o CNPJ que fatura. */
export function itensDoResultado(linhas: LinhaCalc[]): ItemOrcamento[] {
  const itens: ItemOrcamento[] = [];
  for (const fat of FATURAMENTOS) {
    const doGrupo = linhas.filter((l) => l.faturadoPor === fat && !l.recorrente && l.venda !== undefined);
    if (fat === 'produto') {
      for (const l of doGrupo) {
        const unit = R2(l.venda! / l.quantidade);
        if (R2(unit * l.quantidade) === l.venda) itens.push({ descricao: l.descricao, unidade: l.unidade, quantidade: l.quantidade, valorUnitario: unit, faturadoPor: fat });
        else itens.push({ descricao: `${l.descricao} (${l.quantidade.toLocaleString('pt-BR')} ${l.unidade})`, unidade: 'vb', quantidade: 1, valorUnitario: l.venda!, faturadoPor: fat });
      }
    } else {
      for (const cat of ['mao_obra', 'deslocamento', 'terceiros'] as const) {
        const v = R2(doGrupo.filter((l) => l.categoria === cat).reduce((s, l) => s + l.venda!, 0));
        if (v > 0) itens.push({ descricao: cat === 'mao_obra' ? 'Mão de obra especializada (instalação, cabeamento e configuração)' : cat === 'deslocamento' ? 'Mobilização e deslocamento da equipe' : 'Plataforma/andaime e equipamentos de acesso', unidade: 'vb', quantidade: 1, valorUnitario: v, faturadoPor: fat });
      }
    }
  }
  return itens;
}

// ---------- pendências e status ----------

export function pendenciasCriticasAbertas(calc: CalcOrcamento | undefined): PendenciaOrc[] {
  return (calc?.pendencias ?? []).filter((p) => p.critica && !p.resolvida);
}

/** Pendências sugeridas pela calculadora que ainda não estão no checklist. */
export function sugestoesNovas(calc: CalcOrcamento, resultado: ResultadoCompleto | undefined): PendenciaOrc[] {
  const ja = new Set(calc.pendencias.map((p) => p.id));
  return (resultado?.motor.pendencias ?? []).filter((p) => !ja.has(`calc:${p.id}`))
    .map((p) => ({ id: `calc:${p.id}`, texto: p.texto, critica: p.critica, resolvida: false, resposta: '', origem: 'calculadora' as const }));
}

export interface Transicao { ok: boolean; bloqueios: string[]; avisos: string[] }

export function podeMudarStatus(o: Orcamento, para: StatusOrcamento): Transicao {
  const t: Transicao = { ok: true, bloqueios: [], avisos: [] };
  const de = o.status;
  const permitidas: Record<StatusOrcamento, StatusOrcamento[]> = {
    Rascunho: ['Aguardando dados', 'Enviado', 'Perdido'],
    'Aguardando dados': ['Rascunho', 'Enviado', 'Perdido'],
    Enviado: ['Aprovado', 'Perdido', 'Rascunho'],
    Aprovado: [],
    Perdido: ['Rascunho'],
  };
  if (de === para) return t;
  if (!permitidas[de]?.includes(para)) t.bloqueios.push(`Não dá para passar de "${de}" para "${para}".`);
  if (para === 'Enviado' && o.calc) {
    const abertas = pendenciasCriticasAbertas(o.calc);
    if (abertas.length) t.bloqueios.push(`${abertas.length} pendência(s) crítica(s) em aberto: ${abertas.map((p) => p.texto.slice(0, 60)).join(' · ')}`);
    const r = o.calc.resultado;
    if (!r) t.bloqueios.push('O orçamento ainda não foi calculado.');
    else {
      if (r.bloqueios.length) t.bloqueios.push(`O cálculo está bloqueado: ${r.bloqueios[0]}`);
      if (r.pontual.total === null && !r.bloqueios.length) t.bloqueios.push('Sem preço calculado.');
      for (const g of r.pontual.grupos) if (g.abaixoDaMinima) t.avisos.push(`${ROTULO_FATURAMENTO[g.faturadoPor]}: margem abaixo da mínima.`);
    }
  }
  t.ok = !t.bloqueios.length;
  return t;
}

/** Aplica o status do orçamento com calculadora. `Aguardando dados` e `Rascunho` não mexem no CRM. */
export function aplicarStatusObra(o: Orcamento, para: StatusOrcamento, empresa: Empresa | undefined, motivo = ''): { orcamento: Orcamento; empresa?: Empresa } {
  const r = mudarStatus(o, para, empresa, motivo);
  if (para === 'Enviado' && o.calc?.resultado?.pontual.total != null) {
    // o valor da oportunidade é o total confirmado do cálculo
    const total = o.calc.resultado.pontual.total;
    if (r.empresa && r.empresa.etapa < ETAPA_FECHADO) r.empresa = { ...r.empresa, valorEstimado: total };
  }
  return r;
}

// ---------- criação e comparação ----------

export function calcVazio(calculadoraId: string, p: Partial<CalcOrcamento> = {}): CalcOrcamento {
  return {
    calculadoraId, escopo: [], entradas: {}, pontos: [], pendencias: [], premissas: [],
    contato: { nome: '', cargo: '', email: '', telefone: '', copia: [] }, origem: '', faturadoPorLinha: {},
    margemPct: null, contingenciaPct: null, nivelPreco: 'recomendado', precoManual: {}, ...p,
  };
}

export function novoOrcamentoCalc(numero: string, empresa: Empresa | undefined, def: DefinicaoCalculadora): Orcamento {
  const o = novoOrcamento(numero, empresa, 'servicos');
  return {
    ...o, subtitulo: def.nome, secoes: [], itens: [], pagamento: '', impostos: '', validadeDias: 15,
    calc: calcVazio(def.id, { premissas: [] }),
  };
}

export interface DiferencaVersao { campo: string; a: string; b: string }

const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

/** O que mudou da versão `a` para a `b` (mesmo número de proposta): escopo, entradas, pontos, pendências, itens e totais. */
export function compararVersoes(a: Orcamento, b: Orcamento): DiferencaVersao[] {
  const d: DiferencaVersao[] = [];
  const add = (campo: string, x: string, y: string) => { if (x !== y) d.push({ campo, a: x, b: y }); };
  add('Status', a.status, b.status);
  const ca = a.calc, cb = b.calc;
  add('Escopo', (ca?.escopo ?? []).slice().sort().join(', ') || '—', (cb?.escopo ?? []).slice().sort().join(', ') || '—');
  const chaves = new Set([...Object.keys(ca?.entradas ?? {}), ...Object.keys(cb?.entradas ?? {})]);
  for (const k of [...chaves].sort()) add(`Entrada: ${k}`, String(ca?.entradas[k] ?? '—'), String(cb?.entradas[k] ?? '—'));
  add('Pontos (total)', String(resumoPontos(ca?.pontos ?? []).total), String(resumoPontos(cb?.pontos ?? []).total));
  add('Pendências críticas em aberto', String(pendenciasCriticasAbertas(ca).length), String(pendenciasCriticasAbertas(cb).length));
  const ra = ca?.resultado, rb = cb?.resultado;
  for (const fat of FATURAMENTOS) {
    const ga = ra?.pontual.grupos.find((g) => g.faturadoPor === fat), gb = rb?.pontual.grupos.find((g) => g.faturadoPor === fat);
    const r = ROTULO_FATURAMENTO[fat];
    add(`${r}: custo total`, brl(ga?.custoTotal), brl(gb?.custoTotal));
    add(`${r}: preço`, brl(ga?.adotado), brl(gb?.adotado));
    add(`${r}: margem`, pct(ga?.margemAdotada), pct(gb?.margemAdotada));
    add(`${r}: imposto`, ga?.impostoPct == null ? '—' : `${ga.impostoPct.toFixed(2)}%`, gb?.impostoPct == null ? '—' : `${gb.impostoPct.toFixed(2)}%`);
  }
  add('Total', brl(ra?.pontual.total), brl(rb?.pontual.total));
  add('Entrada sugerida', brl(ra?.pontual.entradaSugerida), brl(rb?.pontual.entradaSugerida));
  const itens = (o: Orcamento) => new Map(o.itens.map((i) => [`${i.faturadoPor ?? ''}|${i.descricao}`, i]));
  const ia = itens(a), ib = itens(b);
  for (const k of new Set([...ia.keys(), ...ib.keys()])) {
    const x = ia.get(k), y = ib.get(k);
    const f = (i: ItemOrcamento | undefined) => (i ? `${i.quantidade.toLocaleString('pt-BR')} ${i.unidade} × ${brl(i.valorUnitario)}` : '—');
    add(`Item: ${k.split('|')[1]}`, f(x), f(y));
  }
  return d;
}

// ---------- carga (importar oportunidade + orçamento por JSON) ----------

export interface CargaObra {
  versao: 1;
  empresa: Partial<Empresa> & { nomeFantasia: string };
  contato?: Partial<Contato>;
  orcamento: Partial<Orcamento> & { calc: Partial<CalcOrcamento> & { calculadoraId: string } };
}

export function lerCargaObra(texto: string): { carga?: CargaObra; erro?: string } {
  let j: unknown;
  try { j = JSON.parse(texto); } catch { return { erro: 'O arquivo não é um JSON válido.' }; }
  const c = j as Partial<CargaObra>;
  if (!c || c.versao !== 1 || !c.empresa?.nomeFantasia || !c.orcamento?.calc?.calculadoraId) return { erro: 'Arquivo fora do formato de oportunidade + orçamento (versao 1).' };
  return { carga: c as CargaObra };
}

export interface PlanoObra {
  empresa: Empresa;
  empresaNova: boolean;
  contato: Contato | null;
  orcamento: Orcamento | null;
  avisos: string[];
}

export function planejarCargaObra(c: CargaObra, existentes: { empresas: Empresa[]; contatos: Contato[]; orcamentos: Orcamento[] }, numero: string): PlanoObra {
  const agora = agoraIso();
  const avisos: string[] = [];
  const alvo = normalizar(c.empresa.nomeFantasia);
  const jaTem = existentes.empresas.find((e) => (c.empresa.id && e.id === c.empresa.id) || (c.empresa.cnpj && e.cnpj === c.empresa.cnpj) || normalizar(`${e.nomeFantasia} ${e.razaoSocial}`).includes(alvo));
  let empresa: Empresa;
  if (jaTem) { empresa = jaTem; avisos.push(`A empresa "${jaTem.nomeFantasia || jaTem.razaoSocial}" já existe no CRM: usada como está (nada foi alterado nela).`); }
  else {
    empresa = {
      id: novoId(), cnpj: '', razaoSocial: '', segmento: '', bairro: '', endereco: '', telefone: '', email: '', site: '', linkMaps: '', perfilDecisor: '',
      classe: '', pontuacao: null, alertas: '', servicoEntrada: '', topRanking: null, porQueVisitar: '', origem: 'manual', etapa: 6, valorEstimado: null,
      valorFechado: null, dataFechamento: null, motivoPerda: '', notas: '', historicoEtapas: [{ etapa: 6, em: agora }],
      criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...c.empresa,
    } as Empresa;
  }
  let contato: Contato | null = null;
  if (c.contato) {
    const id = c.contato.id ?? novoId();
    if (existentes.contatos.some((x) => x.id === id)) avisos.push('O contato desta carga já estava registrado: não foi duplicado.');
    else contato = { id, empresaId: empresa.id, dataHora: agora, canal: 'E-mail', pessoa: '', cargo: '', resultado: 'Proposta solicitada', resumo: '', proximaAcao: '', proximaAcaoData: null, criadoEm: agora, atualizadoEm: agora, excluidoEm: null, ...c.contato } as Contato;
  }
  let orcamento: Orcamento | null = null;
  const oid = c.orcamento.id ?? novoId();
  if (existentes.orcamentos.some((x) => x.id === oid)) avisos.push('O orçamento desta carga já existe: não foi importado de novo (suas edições ficam como estão).');
  else {
    const base = novoOrcamentoCalc(numero, empresa, { ...CFTV, id: c.orcamento.calc.calculadoraId });
    orcamento = {
      ...base, ...c.orcamento, id: oid, empresaId: empresa.id, numero: c.orcamento.numero ?? numero,
      calc: calcVazio(c.orcamento.calc.calculadoraId, c.orcamento.calc),
      criadoEm: agora, atualizadoEm: agora, excluidoEm: null,
    } as Orcamento;
  }
  return { empresa, empresaNova: !jaTem, contato, orcamento, avisos };
}
