import { diaSP, fmtData, somarDias } from '../datas';
import type { Material } from '../model';
import { arred } from './importacao';
import type { CampanhaMk, GrupoMk, LeadMk, MetricaMk, ProdutoMk } from './modelo';
import { HORARIO_PADRAO, fmtMinutos, fmtPct, fmtReais, gastoNoMes, mesDe, minutosUteis, orcamentoDiario, type Horario } from './painel';

// Alertas de MK10. Os limites estão aqui num lugar só; a Fase 0 usa os valores da especificação.

export const LIMITES_MK = {
  fracaoOrcamento: 0.8, // 80% do orçamento do mês
  fatorDiario: 2, // dia acima do dobro do orçamento diário
  semContato: 75, // R$ gastos sem nenhum contato
  minutosResposta: 15, // lead sem resposta em 15 min de horário comercial
  diasCpc: 7, // CPC acima do teto: olha os últimos 7 dias
};

export type TipoAlerta = 'orcamento' | 'dia-alto' | 'cpc' | 'sem-contato' | 'estoque-zero' | 'lead-sem-resposta' | 'produto-incompleto';
export interface Alerta { tipo: TipoAlerta; grave: boolean; texto: string; tela: string; id: string }

export interface EntradaAlertas {
  campanhas: CampanhaMk[];
  grupos: GrupoMk[];
  metricas: MetricaMk[];
  leads: LeadMk[];
  produtos: ProdutoMk[];
  materiais: Map<string, Material>;
  saldo: Map<string, number>;
  horario?: Horario;
}

export function calcularAlertas(d: EntradaAlertas, agora: Date = new Date()): Alerta[] {
  const out: Alerta[] = [];
  const hoje = diaSP(agora);
  const mes = mesDe(hoje);
  const L = LIMITES_MK;
  const diarias = d.metricas.filter((m) => m.periodo === 'dia' && m.campanhaId);

  for (const c of d.campanhas) {
    if (c.status !== 'Ativa') continue;
    const daCamp = diarias.filter((m) => m.campanhaId === c.id);

    // 1) gasto do mês ≥ 80% do orçamento
    if (c.orcamentoMensal) {
      const gasto = gastoNoMes(daCamp, c.id, mes);
      const f = gasto / c.orcamentoMensal;
      if (f >= L.fracaoOrcamento) {
        out.push({ tipo: 'orcamento', grave: f >= 1, tela: 'mk03', id: c.id,
          texto: `${c.nome}: gastou ${fmtReais(gasto)} de ${fmtReais(c.orcamentoMensal)} no mês (${fmtPct(f)}).` });
      }
      // 2) algum dia do mês acima do dobro do orçamento diário
      const teto = orcamentoDiario(c.orcamentoMensal, mes) * L.fatorDiario;
      const altos = daCamp.filter((m) => mesDe(m.dia) === mes && m.custo > teto).sort((a, b) => b.dia.localeCompare(a.dia));
      if (altos.length) {
        out.push({ tipo: 'dia-alto', grave: false, tela: 'mk03', id: c.id,
          texto: `${c.nome}: ${altos.length} dia(s) acima de ${fmtReais(arred(teto))} (dobro do diário). Último: ${fmtData(altos[0].dia)} com ${fmtReais(altos[0].custo)}.` });
      }
    }

    // 3) CPC acima do teto (lance máximo da campanha; sem ele, o maior lance dos grupos)
    const lances = d.grupos.filter((g) => g.campanhaId === c.id && g.lanceMax).map((g) => g.lanceMax!);
    const tetoCpc = c.lanceMax ?? (lances.length ? Math.max(...lances) : null);
    if (tetoCpc) {
      const desde = somarDias(hoje, -L.diasCpc);
      const caros = daCamp.filter((m) => m.dia > desde && m.cliques > 0 && m.custo / m.cliques > tetoCpc);
      if (caros.length) {
        const pior = caros.reduce((a, b) => (b.custo / b.cliques > a.custo / a.cliques ? b : a));
        out.push({ tipo: 'cpc', grave: false, tela: 'mk03', id: c.id,
          texto: `${c.nome}: CPC de ${fmtReais(arred(pior.custo / pior.cliques))} em ${fmtData(pior.dia)}, acima do teto de ${fmtReais(tetoCpc)}.` });
      }
    }

    // 4) R$ 75 gastos desde o último contato (ou desde o início, se nunca veio contato)
    const leadsCamp = d.leads.filter((l) => l.campanhaId === c.id).map((l) => diaSP(l.dataHora)).sort();
    const ultimoLead = leadsCamp[leadsCamp.length - 1] ?? null;
    const semContato = arred(daCamp.filter((m) => !ultimoLead || m.dia > ultimoLead).reduce((s, m) => s + m.custo, 0));
    if (semContato >= L.semContato) {
      out.push({ tipo: 'sem-contato', grave: true, tela: 'mk09', id: c.id,
        texto: `${c.nome}: ${fmtReais(semContato)} gastos sem nenhum contato${ultimoLead ? ` desde ${fmtData(ultimoLead)}` : ''}.` });
    }
  }

  // 5) estoque zero em produto anunciado  7) produto sem NF confirmada ou sem estado
  for (const p of d.produtos) {
    if (!p.anunciado) continue;
    const nome = (p.materialId && d.materiais.get(p.materialId)?.descricao) || p.sku || '(produto sem nome)';
    if (p.materialId && (d.saldo.get(p.materialId) ?? 0) <= 0) {
      out.push({ tipo: 'estoque-zero', grave: true, tela: 'mk06', id: p.id, texto: `${nome}: anunciado com estoque zero.` });
    }
    const falta = [!p.materialId && 'item do WMS', (!p.nf || !p.nfConfirmada) && 'NF confirmada', !p.estado && 'estado'].filter(Boolean);
    if (falta.length) out.push({ tipo: 'produto-incompleto', grave: false, tela: 'mk06', id: p.id, texto: `${nome}: anunciado sem ${falta.join(', ')}.` });
  }

  // 6) lead sem resposta há mais de 15 min de horário comercial
  for (const l of d.leads) {
    if (l.primeiraRespostaEm) continue;
    const min = minutosUteis(l.dataHora, agora.toISOString(), d.horario ?? HORARIO_PADRAO);
    if (min > L.minutosResposta) {
      out.push({ tipo: 'lead-sem-resposta', grave: true, tela: 'mk09', id: l.id,
        texto: `${l.nome || l.telefone || 'Lead'} (${l.ref || 'sem Ref'}): sem resposta há ${fmtMinutos(min)} de horário comercial.` });
    }
  }
  return out.sort((a, b) => Number(b.grave) - Number(a.grave));
}
