import { normalizar } from '../texto';
import type { Leitura } from './canais';
import { idMetrica, idTermo, nova, type CampanhaMk, type ContaMk, type MetricaMk, type TermoMk } from './modelo';

// Núcleo da importação: transforma a leitura normalizada de qualquer canal em registros.
// Campanha desconhecida é criada na hora (com o ID externo, se o relatório trouxer).
// Ids determinísticos: reimportar o mesmo período substitui os números, não duplica.
//
// Conta compartilhada: a mesma conta do Google Ads pode atender mais de uma empresa (CNPJ).
// Ela é cadastrada em cada empresa com o mesmo ID externo, e cada campanha pertence a uma
// empresa só. Na importação, campanha que já é de outra empresa é pulada, e campanha nova
// pode ser desmarcada ("não é desta empresa").

export interface CampanhaIgnorada { nome: string; motivo: string }

export interface PlanoImportacaoMk {
  campanhasNovas: CampanhaMk[];
  metricas: MetricaMk[];
  termos: TermoMk[];
  avisos: string[];
  /** Campanhas do arquivo que não entram nesta empresa (são de outra ou foram desmarcadas). */
  ignoradas: CampanhaIgnorada[];
  /** Dias (ou meses) cobertos, para a pré-visualização. */
  de: string | null;
  ate: string | null;
  substituidas: number;
}

export interface OpcoesImportacaoMk {
  /** Campanhas da mesma conta externa cadastradas em OUTRAS empresas (com o nome da empresa). */
  deOutrasEmpresas?: { campanha: CampanhaMk; empresa: string }[];
  /** Nomes (normalizados) de campanhas novas que o usuário desmarcou. */
  naoImportar?: Set<string>;
}

/** Mesma conta externa (ex.: o mesmo ID do Google Ads) cadastrada em outra empresa. */
export function mesmaContaExterna(a: ContaMk, b: ContaMk): boolean {
  const id = (c: ContaMk) => c.idExterno.replace(/\D/g, '');
  return a.id !== b.id && a.canal === b.canal && !!id(a) && id(a) === id(b);
}

export function planejarImportacaoMk(
  leitura: Leitura, conta: ContaMk, campanhas: CampanhaMk[], mes: string, existentes: Set<string>, opc: OpcoesImportacaoMk = {},
): PlanoImportacaoMk {
  const daConta = campanhas.filter((c) => c.contaId === conta.id && !c.excluidoEm);
  const porIdExt = new Map(daConta.filter((c) => c.idExterno).map((c) => [c.idExterno, c]));
  const porNome = new Map(daConta.map((c) => [normalizar(c.nome), c]));
  const outras = (opc.deOutrasEmpresas ?? []).filter((o) => !o.campanha.excluidoEm);
  const outraPorIdExt = new Map(outras.filter((o) => o.campanha.idExterno).map((o) => [o.campanha.idExterno, o.empresa]));
  const outraPorNome = new Map(outras.map((o) => [normalizar(o.campanha.nome), o.empresa]));
  const naoImportar = opc.naoImportar ?? new Set<string>();
  const p: PlanoImportacaoMk = { campanhasNovas: [], metricas: [], termos: [], avisos: [...leitura.avisos], ignoradas: [], de: null, ate: null, substituidas: 0 };
  const ignorar = (nome: string, motivo: string) => { if (!p.ignoradas.some((i) => i.nome === nome)) p.ignoradas.push({ nome, motivo }); };

  /** id da campanha nesta empresa; null = métrica da conta inteira; undefined = não é desta empresa. */
  const campanhaDe = (nome: string, idExt: string, orcamentoMensal: number | null = null): string | null | undefined => {
    if (!nome && !idExt) return null; // métrica da conta inteira (perfil)
    let c = (idExt && porIdExt.get(idExt)) || porNome.get(normalizar(nome));
    if (c) return c.id;
    const outra = (idExt && outraPorIdExt.get(idExt)) || outraPorNome.get(normalizar(nome));
    if (outra) { ignorar(nome, `é de ${outra}`); return undefined; }
    if (naoImportar.has(normalizar(nome))) { ignorar(nome, 'desmarcada'); return undefined; }
    // campanha nova já nasce com o orçamento do relatório (convertido para mensal), se houver
    c = nova.campanha(conta.unidadeId, conta.id, { nome, idExterno: idExt, orcamentoMensal });
    p.campanhasNovas.push(c);
    porNome.set(normalizar(nome), c);
    if (idExt) porIdExt.set(idExt, c);
    return c.id;
  };

  // métricas: soma linhas do mesmo dia e campanha (ex.: relatório segmentado por dispositivo)
  const metricas = new Map<string, MetricaMk>();
  const inteligentes = new Set<string>();
  for (const m of leitura.metricas) {
    const campanhaId = campanhaDe(m.campanha, m.campanhaIdExterno, m.orcamentoMensal ?? null);
    if (campanhaId === undefined) continue;
    if (/^(inteligente|smart)$/.test(normalizar(m.tipoCampanha))) inteligentes.add(m.campanha);
    const id = idMetrica(conta.id, campanhaId, m.dia, m.periodo);
    const atual = metricas.get(id);
    const { campanha: _c, campanhaIdExterno: _i, dia: _d, periodo: _p, orcamentoMensal: _o, tipoCampanha: _t, ...nums } = m;
    if (!atual) {
      metricas.set(id, nova.metrica(conta.unidadeId, conta.id, campanhaId, m.dia, m.periodo, nums));
    } else {
      for (const k of Object.keys(nums) as (keyof typeof nums)[]) atual[k] = arred(atual[k] + nums[k]);
    }
    if (!p.de || m.dia < p.de) p.de = m.dia;
    if (!p.ate || m.dia > p.ate) p.ate = m.dia;
  }
  p.metricas = [...metricas.values()];
  for (const nome of inteligentes) {
    p.avisos.push(`"${nome}" é uma campanha Inteligente: no Google Ads ela não tem grupos, palavras-chave nem lance máximo editáveis (só temas de palavras-chave). `
      + 'Gasto, cliques e contatos funcionam normalmente no KIVOR.');
  }

  const termos = new Map<string, TermoMk>();
  for (const t of leitura.termos) {
    const campanhaId = campanhaDe(t.campanha, t.campanhaIdExterno);
    if (campanhaId === undefined) continue;
    const id = idTermo(conta.id, campanhaId, mes, normalizar(t.termo), t.correspondencia);
    const atual = termos.get(id);
    if (atual) {
      atual.impressoes += t.impressoes; atual.cliques += t.cliques; atual.custo = arred(atual.custo + t.custo); atual.conversoes += t.conversoes;
    } else {
      const agora = new Date().toISOString();
      termos.set(id, {
        id, unidadeId: conta.unidadeId, criadoEm: agora, atualizadoEm: agora, excluidoEm: null, contaId: conta.id, campanhaId, mes,
        termo: t.termo, correspondencia: t.correspondencia, impressoes: t.impressoes, cliques: t.cliques, custo: t.custo, conversoes: t.conversoes,
      });
    }
  }
  p.termos = [...termos.values()];
  if (p.termos.length) { p.de = `${mes}-01`; p.ate = `${mes}-01`; }
  p.substituidas = [...p.metricas, ...p.termos].filter((r) => existentes.has(r.id)).length;
  return p;
}

export const arred = (n: number) => Math.round(n * 100) / 100;
