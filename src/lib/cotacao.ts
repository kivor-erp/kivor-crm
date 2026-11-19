import { EMISSOR } from '../config';
import { novoItemCompra, novoPedidoCompra } from './compras';
import type { Fornecedor, PedidoCompra } from './model';
import { soDigitos } from './texto';

// Gerador de pedido de cotação (RFQ) em nome da SOF: texto pronto para WhatsApp ou e-mail.

export interface ItemCotacao {
  descricao: string;
  /** null = deixar o espaço em branco para o comprador preencher. */
  quantidade: number | null;
  unidade: string;
  /** Especificação técnica (tensão, corrente, norma, cor…). */
  especificacao: string;
  /** Marca/modelo de referência (opcional). */
  referencia?: string;
}

export interface Emissor {
  nome: string; cnpj: string; telefone: string; email: string; cidade: string; responsavel?: string; cargo?: string;
}

export type Canal = 'whatsapp' | 'email';

export interface OpcoesCotacao {
  itens: ItemCotacao[];
  canal: Canal;
  fornecedor?: Pick<Fornecedor, 'nome'> & { contato?: string };
  emissor?: Emissor;
  /** Local de entrega para o frete CIF/FOB. Padrão: cidade do emissor. */
  destino?: string;
  /** Data limite para a resposta, "AAAA-MM-DD" (opcional). */
  responderAte?: string | null;
  /** Para testes; padrão: agora. */
  agora?: Date;
  /** Observação livre da obra/cliente (opcional). */
  observacao?: string;
}

export const itemCotacaoVazio = (p: Partial<ItemCotacao> = {}): ItemCotacao => ({ descricao: '', quantidade: null, unidade: 'un', especificacao: '', referencia: '', ...p });

/** "Bom dia" / "Boa tarde" / "Boa noite" pelo horário de Brasília. */
export function saudacao(agora = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(agora)) % 24;
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

const fmtQtd = (q: number | null, un: string) => (q && q > 0 ? `${q.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${un}`.trim() : `____ ${un}`.trim());
const fmtDataBr = (iso: string) => iso.split('-').reverse().join('/');

function linhasItem(i: ItemCotacao, n: number, negrito: (s: string) => string): string[] {
  const l = [`${negrito(`${n}.`)} ${i.descricao.trim()}`, `   Quantidade: ${fmtQtd(i.quantidade, i.unidade || 'un')}`];
  l.push(`   Especificação técnica: ${i.especificacao.trim() || '________________'}`);
  if (i.referencia?.trim()) l.push(`   Marca/modelo de referência: ${i.referencia.trim()}`);
  return l;
}

export function gerarCotacao(o: OpcoesCotacao): { assunto: string; texto: string } {
  const em = o.emissor ?? EMISSOR;
  const wa = o.canal === 'whatsapp';
  const neg = (s: string) => (wa ? `*${s}*` : s);
  const itens = o.itens.filter((i) => i.descricao.trim());
  const destino = (o.destino || em.cidade || 'Espírito Santo').trim();
  const sau = saudacao(o.agora);
  const quem = em.responsavel ? `${em.responsavel}, da ${neg(em.nome)}` : neg(em.nome);

  const abertura = o.canal === 'email'
    ? [`${o.fornecedor?.contato ? `${sau}, ${o.fornecedor.contato}.` : `${sau}, prezados.`}`, '', `Somos a ${em.nome} (CNPJ ${em.cnpj}), de ${em.cidade}, e gostaríamos de receber cotação dos itens abaixo.`]
    : [`${sau}${o.fornecedor?.contato ? `, ${o.fornecedor.contato}` : ''}! Tudo bem?`, `Aqui é ${quem} (CNPJ ${em.cnpj}), ${em.cidade}.`, '', 'Poderia nos enviar cotação dos itens abaixo?'];

  const corpoItens = itens.flatMap((i, k) => [...linhasItem(i, k + 1, neg), '']);

  const pedido = [
    'Na proposta, por favor informe:',
    '• Preço unitário e total, com ICMS, IPI e ST (substituição tributária) destacados, se houver;',
    `• Prazo de entrega e frete para ${destino} (CIF ou FOB; se FOB, o valor estimado do frete);`,
    '• Condição de pagamento (à vista, boleto/prazo, cartão);',
    '• Validade da proposta;',
    '• Disponibilidade (pronta entrega ou prazo de fábrica).',
  ];
  const prazo = o.responderAte ? [`Se possível, retorne até ${fmtDataBr(o.responderAte)}.`] : [];
  const obs = o.observacao?.trim() ? ['', `Observação: ${o.observacao.trim()}`] : [];

  const contato = [em.telefone, em.email].filter(Boolean).join(' · ');
  const fecho = o.canal === 'email'
    ? ['', 'Atenciosamente,', em.responsavel ?? em.nome, [em.cargo, em.nome].filter(Boolean).join(' · '), contato]
    : ['', 'Agradecemos desde já!'];

  const texto = [...abertura, '', ...corpoItens, ...pedido, ...prazo, ...obs, ...fecho].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const assunto = `Solicitação de cotação – ${em.nome} – ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`;
  return { assunto, texto };
}

// ---------- links de envio ----------

/** Número no formato internacional para o wa.me ("27 99577-7707" → "5527995777707"); '' se não parecer um celular/fixo BR. */
export function telefoneWhatsApp(f: Pick<Fornecedor, 'whatsapp' | 'telefone'>): string {
  const d = soDigitos(f.whatsapp || f.telefone).replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return '';
}

export function linkWhatsApp(f: Pick<Fornecedor, 'whatsapp' | 'telefone'>, texto: string): string {
  const n = telefoneWhatsApp(f);
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`; // sem número, o WhatsApp deixa escolher o contato
}

export const emailCotacao = (f: Pick<Fornecedor, 'emailCotacao' | 'email'>): string => (f.emailCotacao || f.email || '').trim();

export function linkEmail(f: Pick<Fornecedor, 'emailCotacao' | 'email'>, assunto: string, corpo: string): string {
  return `mailto:${emailCotacao(f)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}

/** Pedido de compra "Em cotação" para registrar a cotação enviada a um fornecedor. */
export function pedidoDeCotacao(numero: string, itens: ItemCotacao[], f: Fornecedor, observacao = ''): PedidoCompra {
  return novoPedidoCompra(numero, {
    status: 'Em cotação',
    fornecedor: f.nome,
    fornecedorCnpj: f.cnpj,
    fornecedorContato: [f.whatsapp || f.telefone, emailCotacao(f)].filter(Boolean).join(' · '),
    observacao: observacao || 'Cotação enviada pelo módulo de cotação.',
    itens: itens.filter((i) => i.descricao.trim()).map((i) => novoItemCompra({
      descricao: [i.descricao.trim(), i.especificacao.trim()].filter(Boolean).join(' – '), unidade: i.unidade || 'un', quantidade: i.quantidade && i.quantidade > 0 ? i.quantidade : 1,
    })),
  });
}
