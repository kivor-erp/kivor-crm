import * as XLSX from 'xlsx';
import { fmtData, fmtDataHora, hojeSP } from './datas';
import { nomeEmpresa, nomeEtapa } from './model';
import { saldos } from './estoque';
import { totalOrcamento } from './orcamento';
import { resumir } from './regras';
import type { Dados } from '../db';
import type { ArquivoCrm } from './sincronia';

// Exportação gerada no navegador; o arquivo vai direto para a pasta de downloads.

function baixar(nome: string, dados: BlobPart, tipo: string) {
  const url = URL.createObjectURL(new Blob([dados], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** JSON completo (inclui excluídos), no mesmo formato do crm.json: serve de backup manual. */
export function exportarJson(d: Dados) {
  const arq: ArquivoCrm = { versao: 2, salvoEm: new Date().toISOString(), ...d };
  baixar(`crm_sof_${hojeSP()}.json`, JSON.stringify(arq, null, 1), 'application/json');
}

/** Planilha legível: só registros ativos. */
export function planilhaExcel(d: Pick<Dados, 'empresas' | 'contatos'> & Partial<Dados>): XLSX.WorkBook {
  const { empresas, contatos } = d;
  const ativas = empresas.filter((e) => !e.excluidoEm);
  const ids = new Set(ativas.map((e) => e.id));
  const cs = contatos.filter((c) => !c.excluidoEm && ids.has(c.empresaId));
  const res = resumir(cs);
  const nome = new Map(ativas.map((e) => [e.id, nomeEmpresa(e)]));

  const linhasE = ativas.map((e) => {
    const r = res.get(e.id);
    return {
      'Empresa': nomeEmpresa(e), 'Razão social': e.razaoSocial, 'CNPJ': e.cnpj, 'Segmento': e.segmento, 'Bairro': e.bairro,
      'Etapa': `${e.etapa}. ${nomeEtapa(e.etapa)}`, 'Classe': e.classe, 'Pontuação': e.pontuacao, 'Top 50': e.topRanking,
      'Último contato': r?.ultimo ? fmtData(r.ultimo.dataHora) : '', 'Dias desde o último': r?.diasUltimo ?? '',
      'Contatos': r?.contatos.length ?? 0, 'Melhor resultado': r?.melhor ?? '',
      'Próxima ação': r?.followUp?.acao ?? '', 'Data próxima ação': fmtData(r?.followUp?.data),
      'Valor estimado': e.valorEstimado, 'Valor fechado': e.valorFechado, 'Data fechamento': fmtData(e.dataFechamento),
      'Motivo da perda': e.motivoPerda, 'Telefone': e.telefone, 'E-mail': e.email, 'Endereço': e.endereco,
      'Alertas': e.alertas, 'Notas': e.notas, 'Origem': e.origem,
    };
  });
  const linhasC = [...cs].sort((a, b) => b.dataHora.localeCompare(a.dataHora)).map((c) => ({
    'Data/hora': fmtDataHora(c.dataHora), 'Empresa': nome.get(c.empresaId) ?? '', 'Canal': c.canal, 'Resultado': c.resultado,
    'Pessoa': c.pessoa, 'Cargo': c.cargo, 'Resumo': c.resumo, 'Próxima ação': c.proximaAcao, 'Data próxima ação': fmtData(c.proximaAcaoData),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasE), 'Empresas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasC), 'Contatos');

  const ativo = (r: { excluidoEm: string | null }) => !r.excluidoEm;
  const orcs = (d.orcamentos ?? []).filter(ativo);
  if (orcs.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orcs.map((o) => ({
      'Número': o.numero, 'Revisão': o.revisao, 'Data': fmtData(o.data), 'Cliente': o.cliente, 'Título': [o.titulo, o.subtitulo].filter(Boolean).join(' – '),
      'Status': o.status, 'Valor total': totalOrcamento(o), 'Enviado em': fmtData(o.enviadoEm), 'Decidido em': fmtData(o.decididoEm), 'Motivo da recusa': o.motivoRecusa,
    }))), 'Orçamentos');
  }
  const mats = (d.materiais ?? []).filter(ativo);
  if (mats.length) {
    const movs = (d.movimentos ?? []).filter(ativo);
    const saldo = saldos(movs);
    const nomeMat = new Map(mats.map((m) => [m.id, m.descricao]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mats.map((m) => ({
      'Descrição': m.descricao, 'Fabricante': m.fabricante, 'Modelo': m.modelo, 'Unidade': m.unidade, 'Local': m.local,
      'Saldo': saldo.get(m.id) ?? 0, 'Estoque mínimo': m.estoqueMinimo, 'Preço de venda': m.precoVenda, 'Observações': m.observacoes,
    }))), 'Estoque');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...movs].sort((a, b) => b.data.localeCompare(a.data)).map((v) => ({
      'Data/hora': fmtDataHora(v.data), 'Material': nomeMat.get(v.materialId) ?? '', 'Tipo': v.tipo, 'Quantidade': v.quantidade,
      'Destino/origem': v.destino, 'Observação': v.observacao,
    }))), 'Movimentações');
  }
  return wb;
}

export function exportarExcel(d: Dados) {
  const buf = XLSX.write(planilhaExcel(d), { type: 'array', bookType: 'xlsx' });
  baixar(`crm_sof_${hojeSP()}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
