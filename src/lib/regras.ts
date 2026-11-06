import { diasDesde, diffDias, hojeSP } from './datas';
import { ETAPA_FECHADO, ETAPA_PERDIDO, type Contato, type Empresa, type Etapa, type Resultado } from './model';

/** Etapa que cada resultado indica. */
const ETAPA_DO_RESULTADO: Record<Resultado, Etapa> = {
  'Sem resposta': 2,
  'Número errado / não é da empresa': 2,
  'Falei com quem não decide (pedi o responsável)': 3,
  'Falei com o decisor': 3,
  'Pediu retorno em data': 3,
  'Visita agendada': 5,
  'Proposta solicitada': 6,
  'Sem interesse agora': ETAPA_PERDIDO,
  'Fechado': ETAPA_FECHADO,
};

/**
 * Sugere a etapa após um contato. Nunca regride: se a etapa indicada for
 * menor que a atual, mantém a atual. "Perdido" não é sugerido para quem já
 * fechou contrato, e uma empresa perdida só sai de "Perdido" manualmente.
 */
export function sugerirEtapa(atual: Etapa, resultado: Resultado): Etapa {
  const indicada = ETAPA_DO_RESULTADO[resultado];
  if (atual === ETAPA_PERDIDO) return atual;
  if (indicada === ETAPA_PERDIDO) return atual === ETAPA_FECHADO ? atual : ETAPA_PERDIDO;
  if (atual === ETAPA_FECHADO) return atual;
  return indicada > atual ? indicada : atual;
}

export interface CamposEtapa {
  valorFechado: number | null;
  dataFechamento: string | null;
  motivoPerda: string;
}

/** Retorna mensagem de erro, ou null se a etapa pode ser gravada. */
export function validarEtapa(etapa: Etapa, c: CamposEtapa): string | null {
  if (etapa === ETAPA_FECHADO) {
    if (!c.dataFechamento) return 'Contrato fechado exige a data de fechamento.';
    if (c.valorFechado === null || !(c.valorFechado > 0)) return 'Contrato fechado exige o valor do contrato.';
  }
  if (etapa === ETAPA_PERDIDO && !c.motivoPerda.trim()) return 'Perdido/suspenso exige o motivo.';
  return null;
}

/** Ordem de "melhor resultado" (maior = melhor). */
const PESO_RESULTADO: Record<Resultado, number> = {
  'Número errado / não é da empresa': 0,
  'Sem resposta': 1,
  'Sem interesse agora': 2,
  'Falei com quem não decide (pedi o responsável)': 3,
  'Pediu retorno em data': 4,
  'Falei com o decisor': 5,
  'Visita agendada': 6,
  'Proposta solicitada': 7,
  'Fechado': 8,
};

export function melhorResultado(contatos: Contato[]): Resultado | null {
  let melhor: Resultado | null = null;
  for (const c of contatos) if (melhor === null || PESO_RESULTADO[c.resultado] > PESO_RESULTADO[melhor]) melhor = c.resultado;
  return melhor;
}

export interface ResumoEmpresa {
  contatos: Contato[]; // mais recente primeiro
  ultimo: Contato | null;
  diasUltimo: number | null;
  melhor: Resultado | null;
  /** Follow-up pendente: a próxima ação do contato mais recente. */
  followUp: { data: string; acao: string; contato: Contato } | null;
}

export function ordenarContatos(contatos: Contato[]): Contato[] {
  return [...contatos].sort((a, b) => (a.dataHora < b.dataHora ? 1 : a.dataHora > b.dataHora ? -1 : 0));
}

/** Agrupa contatos ativos por empresa e calcula os indicadores de cada uma. */
export function resumir(contatos: Contato[], agora: Date = new Date()): Map<string, ResumoEmpresa> {
  const porEmpresa = new Map<string, Contato[]>();
  for (const c of contatos) {
    if (c.excluidoEm) continue;
    const l = porEmpresa.get(c.empresaId);
    if (l) l.push(c); else porEmpresa.set(c.empresaId, [c]);
  }
  const res = new Map<string, ResumoEmpresa>();
  for (const [id, lista] of porEmpresa) {
    const ord = ordenarContatos(lista);
    const ultimo = ord[0];
    res.set(id, {
      contatos: ord,
      ultimo,
      diasUltimo: diasDesde(ultimo.dataHora, agora),
      melhor: melhorResultado(ord),
      followUp: ultimo.proximaAcaoData ? { data: ultimo.proximaAcaoData, acao: ultimo.proximaAcao, contato: ultimo } : null,
    });
  }
  return res;
}

export const RESUMO_VAZIO: ResumoEmpresa = { contatos: [], ultimo: null, diasUltimo: null, melhor: null, followUp: null };

export interface ItemAgenda {
  empresa: Empresa;
  resumo: ResumoEmpresa;
  data: string;
  /** dias até o follow-up: negativo = atrasado */
  dias: number;
}

export interface Agenda {
  vencidos: ItemAgenda[];
  hoje: ItemAgenda[];
  proximos: ItemAgenda[];
}

/** Monta a tela "Hoje": vencidos, de hoje e dos próximos 7 dias. */
export function montarAgenda(empresas: Empresa[], resumos: Map<string, ResumoEmpresa>, agora: Date = new Date()): Agenda {
  const hoje = hojeSP(agora);
  const ag: Agenda = { vencidos: [], hoje: [], proximos: [] };
  for (const e of empresas) {
    if (e.excluidoEm) continue;
    const r = resumos.get(e.id);
    if (!r?.followUp) continue;
    const dias = diffDias(hoje, r.followUp.data);
    const item = { empresa: e, resumo: r, data: r.followUp.data, dias };
    if (dias < 0) ag.vencidos.push(item);
    else if (dias === 0) ag.hoje.push(item);
    else if (dias <= 7) ag.proximos.push(item);
  }
  const porData = (a: ItemAgenda, b: ItemAgenda) => a.dias - b.dias || (b.empresa.pontuacao ?? 0) - (a.empresa.pontuacao ?? 0);
  ag.vencidos.sort(porData); ag.hoje.sort(porData); ag.proximos.sort(porData);
  return ag;
}

export function followUpVencido(r: ResumoEmpresa | undefined, agora: Date = new Date()): boolean {
  return !!r?.followUp && diffDias(hojeSP(agora), r.followUp.data) < 0;
}

// ---------- Telefones e links ----------

/** Separa "(27) 3328-1015; (27) 8116-1653" em números individuais. */
export function separarTelefones(t: string): string[] {
  return t.split(/[;/,]| ou /).map((s) => s.trim()).filter((s) => s.replace(/\D/g, '').length >= 8);
}

/**
 * Número completo para discar (DDD + número), só dígitos. Os telefones da Receita
 * vêm com 8 dígitos; celulares (iniciados em 6–9) recebem o 9 na frente.
 * O número gravado não é alterado; isto vale só para o link.
 */
export function numeroParaDiscar(t: string): string {
  let d = t.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  return d;
}

export function linkTel(t: string): string {
  return `tel:+55${numeroParaDiscar(t)}`;
}

export function linkWhatsApp(t: string): string {
  return `https://wa.me/55${numeroParaDiscar(t)}`;
}

export function linkMapsDe(e: Pick<Empresa, 'linkMaps' | 'endereco' | 'razaoSocial'>): string {
  if (e.linkMaps) return e.linkMaps;
  const q = e.endereco || e.razaoSocial;
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
}

export function fmtMoeda(v: number | null): string {
  if (v === null || Number.isNaN(v)) return '';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

/** Lê "R$ 12.500,00", "12500" ou "12.500" → número. */
export function lerMoeda(s: string): number | null {
  const limpo = s.replace(/[^\d,.-]/g, '');
  if (!limpo) return null;
  const n = Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(/\.(?=\d{3}(\D|$))/g, ''));
  return Number.isFinite(n) ? n : null;
}

