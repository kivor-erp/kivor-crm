import { diaSP, diffDias, fmtHora, somarDias } from '../datas';
import { ETAPA_FECHADO, type Empresa, type Orcamento } from '../model';
import { totalOrcamento } from '../orcamento';
import { arred } from './importacao';
import type { CampanhaMk, ContaMk, IdCanal, LeadMk, MetricaMk } from './modelo';

// Cálculos do painel MK01. Funções puras (testadas em tests/trafego.test.ts).

export const mesDe = (dia: string) => dia.slice(0, 7);

export function diasNoMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Gasto contra orçamento: fração (0,8 = 80%). null se não há orçamento definido. */
export function fracaoOrcamento(gasto: number, orcamentoMensal: number | null): number | null {
  return orcamentoMensal && orcamentoMensal > 0 ? gasto / orcamentoMensal : null;
}

/** Custo por contato. null quando não houve contato (não é zero nem infinito). */
export function custoPorContato(gasto: number, contatos: number): number | null {
  return contatos > 0 ? arred(gasto / contatos) : null;
}

/** Orçamento diário de referência = mensal ÷ dias do mês. */
export function orcamentoDiario(orcamentoMensal: number, mes: string): number {
  return orcamentoMensal / diasNoMes(mes);
}

export function gastoNoMes(metricas: MetricaMk[], campanhaId: string, mes: string): number {
  return arred(metricas.filter((m) => m.campanhaId === campanhaId && mesDe(m.dia) === mes).reduce((s, m) => s + m.custo, 0));
}

/**
 * Venda ligada ao lead, lida da oportunidade no CRM: orçamento aprovado (valor total)
 * ou, sem orçamento, empresa em "Contrato fechado" (valor fechado). null = sem venda.
 */
export function vendaDoLead(l: LeadMk, orcamentos: Map<string, Orcamento>, empresas: Map<string, Empresa>): { chave: string; valor: number } | null {
  const o = l.orcamentoId ? orcamentos.get(l.orcamentoId) : undefined;
  if (o && !o.excluidoEm && o.status === 'Aprovado') return { chave: `o:${o.id}`, valor: totalOrcamento(o) };
  const e = l.empresaId ? empresas.get(l.empresaId) : undefined;
  if (e && !e.excluidoEm && e.etapa === ETAPA_FECHADO && e.valorFechado) return { chave: `e:${e.id}`, valor: e.valorFechado };
  return null;
}

export interface LinhaPainel {
  chave: string;
  canal: IdCanal;
  contaId: string | null;
  campanhaId: string | null;
  rotulo: string;
  orcamento: number | null;
  gasto: number;
  fracao: number | null;
  impressoes: number;
  cliques: number;
  /** Ações registradas pelo canal (ligações, rotas, cliques no site, mensagens). */
  acoes: number;
  contatos: number; // leads registrados em MK09
  custoPorContato: number | null;
  vendas: number;
  valorVendido: number;
}

export interface EntradaPainel {
  contas: ContaMk[];
  campanhas: CampanhaMk[];
  metricas: MetricaMk[];
  leads: LeadMk[];
  orcamentos: Map<string, Orcamento>;
  empresas: Map<string, Empresa>;
}

/** Linhas por campanha (e por conta, para métricas sem campanha, como o perfil) no mês. */
export function linhasPainel(d: EntradaPainel, mes: string, canal: IdCanal | null): LinhaPainel[] {
  const contas = new Map(d.contas.map((c) => [c.id, c]));
  const campanhas = new Map(d.campanhas.map((c) => [c.id, c]));
  const linhas = new Map<string, LinhaPainel>();
  const linha = (contaId: string | null, campanhaId: string | null, canalL: IdCanal): LinhaPainel => {
    const chave = campanhaId ? `c:${campanhaId}` : contaId ? `k:${contaId}` : `s:${canalL}`;
    let l = linhas.get(chave);
    if (!l) {
      const camp = campanhaId ? campanhas.get(campanhaId) : undefined;
      const conta = contaId ? contas.get(contaId) : undefined;
      l = {
        chave, canal: canalL, contaId, campanhaId,
        rotulo: camp ? camp.nome : conta ? `${conta.nome} (conta)` : 'Sem origem identificada',
        orcamento: camp?.orcamentoMensal ?? null, gasto: 0, fracao: null, impressoes: 0, cliques: 0, acoes: 0, contatos: 0,
        custoPorContato: null, vendas: 0, valorVendido: 0,
      };
      linhas.set(chave, l);
    }
    return l;
  };
  const canalDaConta = (id: string | null) => (id ? contas.get(id)?.canal : undefined);

  for (const c of d.campanhas) {
    const cn = canalDaConta(c.contaId);
    if (cn && (!canal || cn === canal) && c.status === 'Ativa') linha(c.contaId, c.id, cn); // campanha ativa sem gasto também aparece
  }
  for (const m of d.metricas) {
    if (mesDe(m.dia) !== mes) continue;
    const cn = canalDaConta(m.contaId);
    if (!cn || (canal && cn !== canal)) continue;
    const l = linha(m.contaId, m.campanhaId, cn);
    l.gasto += m.custo; l.impressoes += m.impressoes; l.cliques += m.cliques;
    l.acoes += m.ligacoes + m.rotas + m.cliquesSite + m.mensagens;
  }
  const vendasContadas = new Set<string>(); // a mesma oportunidade com 2 leads conta uma vez só
  for (const ld of d.leads) {
    if (mesDe(diaSP(ld.dataHora)) !== mes || (canal && ld.canal !== canal)) continue;
    const l = linha(ld.contaId, ld.campanhaId, ld.canal);
    l.contatos++;
    const v = vendaDoLead(ld, d.orcamentos, d.empresas);
    if (v && !vendasContadas.has(v.chave)) { vendasContadas.add(v.chave); l.vendas++; l.valorVendido += v.valor; }
  }
  for (const l of linhas.values()) {
    l.gasto = arred(l.gasto);
    l.fracao = fracaoOrcamento(l.gasto, l.orcamento);
    l.custoPorContato = custoPorContato(l.gasto, l.contatos);
  }
  return [...linhas.values()].sort((a, b) => b.gasto - a.gasto || b.contatos - a.contatos || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/** Soma de várias linhas (total do canal ou de todos os canais). */
export function totalizar(linhas: LinhaPainel[], rotulo: string): LinhaPainel {
  const t: LinhaPainel = {
    chave: `t:${rotulo}`, canal: linhas[0]?.canal ?? 'google_ads', contaId: null, campanhaId: null, rotulo,
    orcamento: null, gasto: 0, fracao: null, impressoes: 0, cliques: 0, acoes: 0, contatos: 0, custoPorContato: null, vendas: 0, valorVendido: 0,
  };
  let orc = 0, temOrc = false;
  for (const l of linhas) {
    t.gasto += l.gasto; t.impressoes += l.impressoes; t.cliques += l.cliques; t.acoes += l.acoes; t.contatos += l.contatos;
    t.vendas += l.vendas; t.valorVendido += l.valorVendido;
    if (l.orcamento) { orc += l.orcamento; temOrc = true; }
  }
  t.gasto = arred(t.gasto);
  t.orcamento = temOrc ? orc : null;
  t.fracao = fracaoOrcamento(t.gasto, t.orcamento);
  t.custoPorContato = custoPorContato(t.gasto, t.contatos);
  return t;
}

// ---------- horário comercial e tempo de resposta ----------

/** Janela por dia da semana (0 = domingo), em minutos desde 00:00. null = fechado. */
export type Horario = Record<number, [number, number] | null>;
export const HORARIO_PADRAO: Horario = { 0: null, 1: [480, 1080], 2: [480, 1080], 3: [480, 1080], 4: [480, 1080], 5: [480, 1080], 6: [480, 720] };

function parede(iso: string) {
  const [h, m] = fmtHora(iso).split(':').map(Number);
  return { dia: diaSP(iso), min: h * 60 + m };
}

const diaDaSemana = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** Minutos em horário comercial (fuso de São Paulo) entre dois instantes. */
export function minutosUteis(deIso: string, ateIso: string, horario: Horario = HORARIO_PADRAO): number {
  if (ateIso <= deIso) return 0;
  const a = parede(deIso), b = parede(ateIso);
  if (diffDias(a.dia, b.dia) > 62) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let d = a.dia; d <= b.dia; d = somarDias(d, 1)) {
    const j = horario[diaDaSemana(d)];
    if (!j) continue;
    const ini = d === a.dia ? Math.max(j[0], a.min) : j[0];
    const fim = d === b.dia ? Math.min(j[1], b.min) : j[1];
    if (fim > ini) total += fim - ini;
  }
  return total;
}

/** Tempo até a primeira resposta, em minutos úteis. null se ainda não respondido. */
export function tempoResposta(l: LeadMk, horario: Horario = HORARIO_PADRAO): number | null {
  return l.primeiraRespostaEm ? minutosUteis(l.dataHora, l.primeiraRespostaEm, horario) : null;
}

/** 12 → "12 min"; 130 → "2 h 10 min". */
export function fmtMinutos(min: number): string {
  if (!Number.isFinite(min)) return 'mais de 2 meses';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtPct(f: number | null): string {
  return f === null ? '—' : `${Math.round(f * 100)}%`;
}

export function fmtReais(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
