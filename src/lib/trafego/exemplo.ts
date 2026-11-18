import { diaSP, inputLocalParaIso, somarDias } from '../datas';
import type { Material } from '../model';
import { mesDe } from './painel';
import { nova, type AnuncioMk, type CampanhaMk, type ContaMk, type GrupoMk, type LeadMk, type MetricaMk, type PalavraMk, type ProdutoMk } from './modelo';

// Dados de EXEMPLO (fictícios) para conhecer o módulo. Todos levam ficticio: true e o
// prefixo "[FICTÍCIO]" no nome; MK02 tem o botão que remove todos de uma vez.

export const PREFIXO_FICTICIO = '[FICTÍCIO] ';

export interface Exemplo {
  contas: ContaMk[]; campanhas: CampanhaMk[]; grupos: GrupoMk[]; palavras: PalavraMk[]; anuncios: AnuncioMk[];
  produtos: ProdutoMk[]; metricas: MetricaMk[]; leads: LeadMk[];
}

export function gerarExemplo(unidadeId: string, materiais: Material[], agora: Date = new Date()): Exemplo {
  const F = { ficticio: true };
  const P = PREFIXO_FICTICIO;
  const hoje = diaSP(agora);
  const ads = nova.conta(unidadeId, { ...F, canal: 'google_ads', nome: `${P}Google Ads`, idExterno: '000-000-0000' });
  const gmb = nova.conta(unidadeId, {
    ...F, canal: 'google_business', nome: `${P}Perfil no Google`,
    linksRef: [{ rotulo: 'Site do perfil', url: 'https://exemplo.invalid/?ref=GMB-PERFIL', ref: 'GMB-PERFIL' }],
  });
  const camp = nova.campanha(unidadeId, ads.id, { ...F, nome: `${P}Disjuntores e contatores`, idExterno: '1111111111', orcamentoMensal: 900, lanceMax: 3.5, local: 'Serra e Vitória/ES (raio 30 km)', horario: 'Seg–sex 7h–19h' });
  const camp2 = nova.campanha(unidadeId, ads.id, { ...F, nome: `${P}Inversores de frequência`, idExterno: '2222222222', orcamentoMensal: 600, lanceMax: 4 });
  const grupo = nova.grupo(unidadeId, camp.id, { ...F, nome: `${P}Disjuntor motor`, lanceMax: 3 });
  const mat = materiais[0];
  const produto = nova.produto(unidadeId, { ...F, materialId: mat?.id ?? null, sku: 'FICT-001', numeroPeca: mat?.modelo || 'FICT-PN-001', estado: 'Novo', nf: '', nfConfirmada: false, preco: 189.9 });
  grupo.produtoIds = [produto.id];
  const palavras = [
    nova.palavra(unidadeId, camp.id, { ...F, grupoId: grupo.id, texto: 'disjuntor motor', correspondencia: 'Frase' }),
    nova.palavra(unidadeId, camp.id, { ...F, grupoId: grupo.id, texto: 'disjuntor motor serra es', correspondencia: 'Exata' }),
    nova.palavra(unidadeId, camp.id, { ...F, texto: 'grátis', correspondencia: 'Ampla', negativa: true }),
    nova.palavra(unidadeId, camp.id, { ...F, texto: 'curso', correspondencia: 'Ampla', negativa: true }),
  ];
  const anuncio = nova.anuncio(unidadeId, camp.id, {
    ...F, grupoId: grupo.id, nome: `${P}Anúncio disjuntor`, ref: 'G-FA10', produtoId: produto.id, urlFinal: 'https://exemplo.invalid/disjuntor?ref=G-FA10',
    titulos: ['Disjuntor Motor Pronta Entrega', 'Retire Hoje na Serra/ES', 'Peça com Nota Fiscal'],
    descricoes: [
      'Disjuntor motor novo, com NF. Atendimento rápido pelo WhatsApp. Peça já o seu orçamento.',
      'Peças elétricas com nota fiscal. Retire na Serra/ES ou receba no seu endereço.',
    ],
  });

  const metricas: MetricaMk[] = [];
  for (let i = 13; i >= 0; i--) {
    const dia = somarDias(hoje, -i);
    const cliques = 4 + ((i * 7) % 9);
    metricas.push(nova.metrica(unidadeId, ads.id, camp.id, dia, 'dia', { ...F, impressoes: cliques * 23, cliques, custo: Math.round(cliques * 2.4 * 100) / 100, ligacoes: i % 4 === 0 ? 1 : 0 }));
    metricas.push(nova.metrica(unidadeId, ads.id, camp2.id, dia, 'dia', { ...F, impressoes: 40, cliques: 3, custo: i === 2 ? 70 : 9.5 }));
  }
  const mes = mesDe(hoje);
  metricas.push(nova.metrica(unidadeId, gmb.id, null, `${mes}-01`, 'mes', { ...F, visBusca: 820, visMaps: 410, ligacoes: 14, rotas: 9, cliquesSite: 22, mensagens: 6 }));

  const quando = (diasAtras: number, hora: string) => inputLocalParaIso(`${somarDias(hoje, -diasAtras)}T${hora}`);
  const leads = [
    nova.lead(unidadeId, { ...F, canal: 'google_ads', contaId: ads.id, campanhaId: camp.id, ref: 'G-FA10', gclid: 'EXEMPLO-GCLID-NAO-ENVIAR', produtoId: produto.id, nome: `${P}Cliente A`, dataHora: quando(5, '09:12'), primeiraRespostaEm: quando(5, '09:20') }),
    nova.lead(unidadeId, { ...F, canal: 'google_business', contaId: gmb.id, ref: 'GMB-PERFIL', nome: `${P}Cliente B`, dataHora: quando(3, '14:00'), primeiraRespostaEm: quando(3, '14:40') }),
    nova.lead(unidadeId, { ...F, canal: 'google_ads', contaId: ads.id, campanhaId: camp.id, ref: 'G-FA10', nome: `${P}Cliente C`, dataHora: quando(1, '10:00') }),
  ];
  return { contas: [ads, gmb], campanhas: [camp, camp2], grupos: [grupo], palavras, anuncios: [anuncio], produtos: [produto], metricas, leads };
}
