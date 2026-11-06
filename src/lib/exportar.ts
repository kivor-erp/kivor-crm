import * as XLSX from 'xlsx';
import { fmtData, fmtDataHora, hojeSP } from './datas';
import { nomeEmpresa, nomeEtapa, type Contato, type Empresa } from './model';
import { resumir } from './regras';
import type { ArquivoCrm } from './sincronia';

// Exportação gerada no navegador; o arquivo vai direto para a pasta de downloads.

function baixar(nome: string, dados: BlobPart, tipo: string) {
  const url = URL.createObjectURL(new Blob([dados], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** JSON completo (inclui excluídos), no mesmo formato do crm.json: serve de backup manual. */
export function exportarJson(empresas: Empresa[], contatos: Contato[]) {
  const arq: ArquivoCrm = { versao: 1, salvoEm: new Date().toISOString(), empresas, contatos };
  baixar(`crm_sof_${hojeSP()}.json`, JSON.stringify(arq, null, 1), 'application/json');
}

/** Planilha legível: empresas e contatos ativos. */
export function planilhaExcel(empresas: Empresa[], contatos: Contato[]): XLSX.WorkBook {
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
  return wb;
}

export function exportarExcel(empresas: Empresa[], contatos: Contato[]) {
  const buf = XLSX.write(planilhaExcel(empresas, contatos), { type: 'array', bookType: 'xlsx' });
  baixar(`crm_sof_${hojeSP()}.xlsx`, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
