import { diaSP, hojeSP, somarDias } from './datas';
import { ETAPA_FECHADO, ETAPAS, type Contato, type Empresa, type Resultado } from './model';

// Painel. Atividade = o que eu fiz (contatos, empresas contatadas).
// Resultado = o que o mercado respondeu (conversas, propostas, contratos).
// Mensagem enviada nunca conta como resultado: contrato só com etapa "Contrato fechado" + data.

export interface Periodo { ini: string; fim: string } // AAAA-MM-DD, inclusivo

/** Semana de segunda a domingo (fuso de São Paulo) e a anterior. */
export function semanas(agora: Date = new Date()): { atual: Periodo; anterior: Periodo } {
  const hoje = hojeSP(agora);
  const dow = new Date(`${hoje}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const seg = somarDias(hoje, -((dow + 6) % 7));
  return {
    atual: { ini: seg, fim: somarDias(seg, 6) },
    anterior: { ini: somarDias(seg, -7), fim: somarDias(seg, -1) },
  };
}

const dentro = (dia: string | null | undefined, p: Periodo) => !!dia && dia >= p.ini && dia <= p.fim;

const SEM_RESPOSTA = new Set<Resultado>(['Sem resposta', 'Número errado / não é da empresa']);
export const respondeu = (c: Contato) => !SEM_RESPOSTA.has(c.resultado);

export interface Metricas {
  // atividade
  contatos: number;
  empresasContatadas: number;
  // resultado
  respostas: number;
  decisor: number;
  visitas: number;
  propostas: number;
  contratos: number;
  valorContratos: number;
}

/** Primeira vez que a empresa chegou a "Proposta enviada" ou além (sem contar "Perdido"). */
function diaProposta(e: Empresa): string | null {
  const datas = (e.historicoEtapas ?? []).filter((h) => h.etapa >= 7 && h.etapa <= ETAPA_FECHADO).map((h) => diaSP(h.em));
  return datas.length ? datas.sort()[0] : null;
}

export function contatosDoPeriodo(empresas: Empresa[], contatos: Contato[], p: Periodo): Contato[] {
  const ativas = new Set(empresas.filter((e) => !e.excluidoEm).map((e) => e.id));
  return contatos.filter((c) => !c.excluidoEm && ativas.has(c.empresaId) && dentro(diaSP(c.dataHora), p));
}

export function metricas(empresas: Empresa[], contatos: Contato[], p: Periodo): Metricas {
  const cs = contatosDoPeriodo(empresas, contatos, p);
  const ativas = empresas.filter((e) => !e.excluidoEm);
  const fechadas = ativas.filter((e) => e.etapa === ETAPA_FECHADO && dentro(e.dataFechamento, p));
  return {
    contatos: cs.length,
    empresasContatadas: new Set(cs.map((c) => c.empresaId)).size,
    respostas: cs.filter(respondeu).length,
    decisor: cs.filter((c) => c.resultado === 'Falei com o decisor').length,
    visitas: cs.filter((c) => c.resultado === 'Visita agendada').length,
    propostas: ativas.filter((e) => dentro(diaProposta(e), p)).length,
    contratos: fechadas.length,
    valorContratos: fechadas.reduce((s, e) => s + (e.valorFechado ?? 0), 0),
  };
}

/** Quantas empresas em cada etapa (1..10), agora. */
export function funil(empresas: Empresa[]): number[] {
  const n = ETAPAS.map(() => 0);
  for (const e of empresas) if (!e.excluidoEm) n[e.etapa - 1]++;
  return n;
}

/** Soma do valor estimado das empresas com proposta na mesa (enviada ou em negociação). */
export function valorEmPropostas(empresas: Empresa[]): number {
  return empresas.filter((e) => !e.excluidoEm && (e.etapa === 7 || e.etapa === 8)).reduce((s, e) => s + (e.valorEstimado ?? 0), 0);
}

export interface LinhaGrupo { grupo: string; contatos: [number, number]; respostas: [number, number] } // [atual, anterior]

/** Comparativo por canal ou por segmento entre dois períodos. */
export function porGrupo(empresas: Empresa[], contatos: Contato[], atual: Periodo, anterior: Periodo, por: 'canal' | 'segmento'): LinhaGrupo[] {
  const seg = new Map(empresas.map((e) => [e.id, e.segmento || '(sem segmento)']));
  const linhas = new Map<string, LinhaGrupo>();
  ([atual, anterior] as const).forEach((p, i) => {
    for (const c of contatosDoPeriodo(empresas, contatos, p)) {
      const g = por === 'canal' ? c.canal : seg.get(c.empresaId)!;
      const l = linhas.get(g) ?? { grupo: g, contatos: [0, 0], respostas: [0, 0] };
      l.contatos[i]++;
      if (respondeu(c)) l.respostas[i]++;
      linhas.set(g, l);
    }
  });
  return [...linhas.values()].sort((a, b) => b.contatos[0] - a.contatos[0] || b.contatos[1] - a.contatos[1]);
}
