import { PLANO_PREVENTIVA_ELETRICA } from './blocoPreventiva';
import { hojeSP } from './datas';
import {
  ETAPA_FECHADO, ETAPA_PERDIDO, agoraIso, nomeEmpresa, novoId,
  type Empresa, type ItemOrcamento, type Orcamento, type Secao, type StatusOrcamento,
} from './model';

// Regras do módulo de Orçamentos. O modelo padrão segue a estrutura das propostas
// comerciais da SOF (PC-AAAA-CLnnn): objetivo, escopo, metodologia, cronograma,
// investimento, responsabilidades e aceite.

export const totalItem = (i: ItemOrcamento) => Math.round(i.quantidade * i.valorUnitario * 100) / 100;
export const totalOrcamento = (o: Pick<Orcamento, 'itens'>) =>
  Math.round(o.itens.reduce((s, i) => s + totalItem(i), 0) * 100) / 100;

// ---------- valor por extenso ----------

const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n: number): string {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes = [CEM[c]];
  if (r < 20) partes.push(UNID[r]);
  else partes.push([DEZ[Math.floor(r / 10)], UNID[r % 10]].filter(Boolean).join(' e '));
  return partes.filter(Boolean).join(' e ');
}

function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero';
  const escalas: [number, string, string][] = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil'], [1, '', '']];
  const grupos: { v: number; txt: string }[] = [];
  let resto = n;
  for (const [base, sing, plur] of escalas) {
    const g = Math.floor(resto / base);
    resto %= base;
    if (!g) continue;
    const nome = base === 1 ? '' : g === 1 ? sing : plur;
    const num = base === 1e3 && g === 1 ? '' : ate999(g); // "mil", não "um mil"
    grupos.push({ v: g, txt: [num, nome].filter(Boolean).join(' ') });
  }
  // o último grupo leva "e" quando é < 100 ou centena redonda ("mil e vinte", "treze mil e oitocentos")
  return grupos.map((g, i) => (i > 0 && i === grupos.length - 1 && (g.v < 100 || g.v % 100 === 0) ? 'e ' : '') + g.txt).join(' ');
}

/** 13800 → "treze mil e oitocentos reais"; 1234.5 → "mil, duzentos e trinta e quatro reais e cinquenta centavos". */
export function porExtenso(valor: number): string {
  const centavosTot = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTot / 100), cent = centavosTot % 100;
  const partes: string[] = [];
  if (reais) {
    const txt = inteiroPorExtenso(reais);
    const de = reais % 1e6 === 0 ? ' de' : ''; // "um milhão de reais"
    partes.push(`${txt}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cent) partes.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero real';
}

// ---------- numeração ----------

const RE_NUM = /^PC-(\d{4})-CL(\d+)$/;

/** Próximo número no padrão da SOF: PC-AAAA-CLnnn (sequência por ano). */
export function proximoNumero(orcamentos: Pick<Orcamento, 'numero'>[], ano = hojeSP().slice(0, 4)): string {
  let max = 0;
  for (const o of orcamentos) {
    const m = RE_NUM.exec(o.numero.trim());
    if (m && m[1] === ano) max = Math.max(max, Number(m[2]));
  }
  return `PC-${ano}-CL${String(max + 1).padStart(3, '0')}`;
}

// ---------- modelo padrão e blocos prontos ----------

const SECOES_PADRAO: Secao[] = [
  { titulo: 'Objetivo', texto: 'A presente proposta tem como objetivo estabelecer as condições técnicas e comerciais para a prestação dos serviços descritos abaixo.' },
  { titulo: 'Escopo dos serviços', texto: 'Os serviços serão executados por profissionais qualificados, utilizando equipamentos e ferramentas adequados para a execução das atividades, conforme as necessidades.' },
  { titulo: 'Metodologia e entregáveis', texto: [
    '- Planejamento operacional: alinhamento de horários para que as atividades em campo não interfiram na operação da contratante.',
    '- Segurança do trabalho: execução seguindo rigorosamente as normas NR-10 (Segurança em Eletricidade) e NR-35 (Trabalho em Altura), com uso de EPIs adequados.',
    '- Relatório técnico: emissão de relatório com as anomalias encontradas, registros fotográficos e recomendações de ações corretivas.',
    '- Responsabilidade técnica: emissão de ART (Anotação de Responsabilidade Técnica) junto ao CREA.',
  ].join('\n') },
  { titulo: 'Cronograma de execução', texto: '- Periodicidade: a combinar com a contratante\n- Relatório técnico: emitido após a conclusão dos serviços em campo, em prazo alinhado com a contratante' },
  { titulo: 'Responsabilidades da contratada', texto: [
    '- executar os serviços com profissionais qualificados, utilizando equipamentos e ferramentas adequados às atividades;',
    '- cumprir as normas NR-10 e NR-35 e utilizar os EPIs adequados;',
    '- alinhar com a contratante os horários dos serviços, de modo a não interferir na operação;',
    '- emitir o relatório técnico e a ART junto ao CREA;',
    '- comunicar à contratante as anomalias de severidade crítica identificadas durante a execução dos serviços.',
  ].join('\n') },
  { titulo: 'Responsabilidades da contratante', texto: [
    '- facilitar o livre acesso às subestações, salas elétricas e demais áreas do serviço;',
    '- disponibilizar um responsável local para acompanhar a equipe;',
    '- informar previamente as normas internas de acesso e segurança;',
    '- analisar e aprovar previamente os serviços corretivos antes de sua execução;',
    '- efetuar o pagamento nas condições estabelecidas nesta proposta.',
  ].join('\n') },
];

/** Blocos para inserir no escopo, tirados dos documentos de referência da SOF. */
export const BLOCOS: Secao[] = [
  { titulo: 'Manutenção elétrica preditiva', texto: [
    '- Inspeção termográfica: mapeamento infravermelho de painéis de distribuição (QGBT, QDF, QDL), no-breaks (UPS), motores elétricos e caixas de passagem.',
    '- Análise de grandezas elétricas e qualidade de energia: monitoramento temporário para detecção de oscilações, harmônicas e desequilíbrios de fases.',
    '- Inspeção do SPDA (para-raios) e aterramento: ensaios de resistência de aterramento e continuidade dos condutores.',
  ].join('\n') },
  { titulo: 'Manutenção elétrica corretiva', texto: '- Mão de obra especializada para a correção das anomalias identificadas nas inspeções, mediante aprovação prévia da contratante. Materiais não fazem parte do fornecimento de mão de obra.' },
  { titulo: 'Plano de manutenção preventiva elétrica', texto: PLANO_PREVENTIVA_ELETRICA },
  { titulo: 'Inspeção de painéis elétricos (checklist NR-10)', texto: [
    'Cada painel será inspecionado e registrado em checklist (Conforme / Não conforme / Não se aplica), verificando:',
    '- identificação do painel, dos cabos, disjuntores e chaves;',
    '- proteção das partes vivas contra contatos acidentais;',
    '- iluminação, ventilação e grau de proteção (IP) adequado ao ambiente;',
    '- aterramento (barra de terra e aterramento da porta);',
    '- bloqueio (trava, cadeado e cartão de aviso) de disjuntores, chaves e porta;',
    '- corrosão, limpeza interna e objetos guardados dentro do painel;',
    '- diagramas unifilares e porta-documentos na porta;',
    '- eletrocalhas com tampa, sem excesso de cabos e sem cabos por cima;',
    '- fiação exposta, emendas malfeitas e sinais de aquecimento de componentes;',
    '- existência de DR nos circuitos exigidos e indicação de "ligado/desligado" nos dispositivos de manobra.',
  ].join('\n') },
  { titulo: 'Atendimento corretivo (prazos)', texto: [
    '- Crítico (parada da operação ou risco à segurança): início do atendimento em até __ horas.',
    '- Urgente (degradação da operação): início do atendimento em até __ horas.',
    '- Rotina (falhas sem impacto na operação): início do atendimento em até __ horas.',
  ].join('\n') },
];

export function novoOrcamento(numero: string, empresa?: Empresa): Orcamento {
  const agora = agoraIso();
  return {
    id: novoId(), numero, revisao: 0, data: hojeSP(), empresaId: empresa?.id ?? null,
    cliente: empresa ? nomeEmpresa(empresa) : '', local: empresa ? [nomeEmpresa(empresa), empresa.bairro].filter(Boolean).join(' – ') : '',
    aosCuidados: '', email: empresa?.email ?? '', titulo: 'Proposta comercial', subtitulo: empresa?.servicoEntrada ?? '', referencia: '',
    secoes: SECOES_PADRAO.map((s) => ({ ...s })),
    itens: [{ descricao: '', unidade: 'vb', quantidade: 1, valorUnitario: 0 }],
    pagamento: '10 dias após a entrega e aprovação do relatório técnico',
    impostos: 'Todos os impostos e encargos fiscais locais estão incluídos no valor proposto',
    validadeDias: 45, status: 'Rascunho', enviadoEm: null, decididoEm: null, motivoRecusa: '',
    criadoEm: agora, atualizadoEm: agora, excluidoEm: null,
  };
}

/** Cópia para nova revisão (mesmo número, rev+1) ou novo orçamento (outro número). */
export function copiar(o: Orcamento, numero?: string): Orcamento {
  const agora = agoraIso();
  return {
    ...structuredClone(o), id: novoId(), numero: numero ?? o.numero, revisao: numero ? 0 : o.revisao + 1, data: hojeSP(),
    status: 'Rascunho', enviadoEm: null, decididoEm: null, motivoRecusa: '', criadoEm: agora, atualizadoEm: agora,
  };
}

/**
 * Muda o status e devolve a empresa do CRM ajustada (ou undefined se nada muda):
 * enviado → etapa "Proposta enviada" (se estava antes) e valor estimado;
 * aprovado → "Contrato fechado" com o valor e a data; recusado → "Perdido/suspenso" com o motivo.
 * Nunca regride: empresa já fechada não vira perdida.
 */
export function mudarStatus(o: Orcamento, status: StatusOrcamento, empresa: Empresa | undefined, motivo = ''): { orcamento: Orcamento; empresa?: Empresa } {
  const hoje = hojeSP();
  const total = totalOrcamento(o);
  const orcamento: Orcamento = {
    ...o, status,
    enviadoEm: status === 'Enviado' ? (o.enviadoEm ?? hoje) : o.enviadoEm,
    decididoEm: status === 'Aprovado' || status === 'Recusado' ? hoje : null,
    motivoRecusa: status === 'Recusado' ? motivo : '',
  };
  if (!empresa) return { orcamento };
  const ref = `${o.numero} rev. ${String(o.revisao).padStart(2, '0')}`;
  if (status === 'Enviado' && empresa.etapa < 7) return { orcamento, empresa: { ...empresa, etapa: 7, valorEstimado: total } };
  if (status === 'Enviado' && empresa.etapa < ETAPA_FECHADO) return { orcamento, empresa: { ...empresa, valorEstimado: total } };
  if (status === 'Aprovado' && empresa.etapa !== ETAPA_FECHADO) {
    return { orcamento, empresa: { ...empresa, etapa: ETAPA_FECHADO, valorFechado: total, dataFechamento: hoje } };
  }
  if (status === 'Recusado' && empresa.etapa < ETAPA_FECHADO) {
    return { orcamento, empresa: { ...empresa, etapa: ETAPA_PERDIDO, motivoPerda: `Orçamento ${ref} recusado${motivo ? `: ${motivo}` : ''}` } };
  }
  return { orcamento };
}

/** Texto da seção → blocos para exibir/imprimir. */
export function blocosTexto(texto: string): ({ tipo: 'p' | 'sub'; txt: string } | { tipo: 'lista'; itens: string[] })[] {
  const out: ({ tipo: 'p' | 'sub'; txt: string } | { tipo: 'lista'; itens: string[] })[] = [];
  for (const linha of texto.split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (linha.startsWith('- ')) {
      const ult = out[out.length - 1];
      if (ult?.tipo === 'lista') ult.itens.push(linha.slice(2)); else out.push({ tipo: 'lista', itens: [linha.slice(2)] });
    } else if (linha.startsWith('## ')) out.push({ tipo: 'sub', txt: linha.slice(3) });
    else out.push({ tipo: 'p', txt: linha });
  }
  return out;
}
