import { diaSP, fmtHora, inputLocalParaIso } from '../datas';
import type { Empresa, Orcamento } from '../model';
import { gerarCsv } from './csv';
import type { ConversaoMk, LeadMk } from './modelo';
import { vendaDoLead } from './painel';

// Fila de conversões offline (MK10). Formato do arquivo de importação de conversões de
// clique do Google Ads (support.google.com/google-ads/answer/7014069, conferido em 18/11/2026):
// linha "Parameters:TimeZone=…", cabeçalho Google Click ID, Conversion Name, Conversion Time,
// Conversion Value, Conversion Currency; hora "yyyy-MM-dd HH:mm:ss". Valor com ponto decimal.
// O Google chama esse envio por arquivo de recurso legado e recomenda o Data Manager, que
// aceita o mesmo modelo.

export const FUSO_CONVERSOES = 'America/Sao_Paulo';
export const NOME_CONVERSAO_PADRAO = 'Venda KIVOR';

/** Leads com gclid e venda ligada que ainda não têm conversão na fila. */
export function candidatosConversao(
  leads: LeadMk[], conversoes: ConversaoMk[], orcamentos: Map<string, Orcamento>, empresas: Map<string, Empresa>,
): { lead: LeadMk; valor: number; quando: string }[] {
  const ja = new Set(conversoes.filter((c) => !c.excluidoEm).map((c) => c.leadId));
  const out: { lead: LeadMk; valor: number; quando: string }[] = [];
  for (const l of leads) {
    if (!l.gclid.trim() || ja.has(l.id)) continue;
    const v = vendaDoLead(l, orcamentos, empresas);
    if (!v) continue;
    const o = l.orcamentoId ? orcamentos.get(l.orcamentoId) : undefined;
    const e = l.empresaId ? empresas.get(l.empresaId) : undefined;
    // momento da venda: decisão do orçamento, data de fechamento (12:00) ou agora
    const quando = (v.chave.startsWith('o:') && o?.decididoEm)
      || (e?.dataFechamento ? inputLocalParaIso(`${e.dataFechamento}T12:00`) : null)
      || new Date().toISOString();
    out.push({ lead: l, valor: v.valor, quando: quando < l.dataHora ? l.dataHora : quando });
  }
  return out;
}

export function novaConversao(lead: LeadMk, valor: number, quando: string, nome = NOME_CONVERSAO_PADRAO): ConversaoMk {
  const agora = new Date().toISOString();
  return {
    id: crypto.randomUUID(), unidadeId: lead.unidadeId, criadoEm: agora, atualizadoEm: agora, excluidoEm: null,
    leadId: lead.id, gclid: lead.gclid.trim(), nomeConversao: nome, dataHora: quando, valor, moeda: 'BRL', exportadaEm: null,
  };
}

/** ISO → "yyyy-MM-dd HH:mm:ss" no horário de São Paulo. */
export function horaConversao(iso: string): string {
  return `${diaSP(iso)} ${fmtHora(iso)}:00`;
}

export function csvConversoes(lista: ConversaoMk[]): string {
  return `Parameters:TimeZone=${FUSO_CONVERSOES}\r\n` + gerarCsv([
    ['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency'],
    ...lista.map((c) => [c.gclid, c.nomeConversao, horaConversao(c.dataHora), c.valor.toFixed(2), c.moeda]),
  ]);
}
