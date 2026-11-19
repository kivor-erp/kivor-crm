import { liveQuery } from 'dexie';
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { TABELAS, definirUnidadeAtiva, lerConfig, tabela, type Dados as Tabelas } from './db';
import { saldos } from './lib/estoque';
import {
  CONFIG_PADRAO, type Configuracoes, type Contato, type Empresa, type Material, type Movimento, type Orcamento, type Recibo, type Registro, type Unidade,
} from './lib/model';
import { resumir, type ResumoEmpresa } from './lib/regras';
import type { AnuncioMk, CampanhaMk, ContaMk, ConversaoMk, GrupoMk, LeadMk, MetricaMk, PalavraMk, ProdutoMk, TermoMk } from './lib/trafego/modelo';
import { daUnidade, semUnidade } from './lib/unidades';

/** Dados do módulo Tráfego Pago, sempre só da unidade escolhida. */
export interface DadosMk {
  contas: ContaMk[]; campanhas: CampanhaMk[]; grupos: GrupoMk[]; palavras: PalavraMk[]; anuncios: AnuncioMk[];
  produtos: ProdutoMk[]; metricas: MetricaMk[]; termos: TermoMk[]; leads: LeadMk[]; conversoes: ConversaoMk[];
}

export interface Dados {
  pronto: boolean;
  empresas: Empresa[]; // sem as excluídas (CRM é comum a todas as unidades)
  contatos: Contato[]; // sem os excluídos
  resumos: Map<string, ResumoEmpresa>;
  config: Configuracoes;
  porId: Map<string, Empresa>;
  /** Orçamentos, materiais, movimentos e saldo: só da unidade escolhida (todos, se não há unidades). */
  orcamentos: Orcamento[];
  materiais: Material[];
  movimentos: Movimento[];
  saldo: Map<string, number>;
  /** Recibos de saída da unidade escolhida. */
  recibos: Recibo[];
  unidades: Unidade[];
  unidade: Unidade | null;
  /** Registros antigos ainda sem unidade (Ajustes permite atribuir). */
  semUnidade: { materiais: number; orcamentos: number };
  mk: DadosMk;
  /**
   * Campanhas de OUTRAS empresas, só para a importação saber que uma campanha de uma conta
   * compartilhada não é desta empresa. Nunca usar em painel ou relatório.
   */
  campanhasDeOutras: { campanha: CampanhaMk; conta: ContaMk; empresa: string }[];
  setUnidade: (id: string) => void;
}

const MK_VAZIO: DadosMk = { contas: [], campanhas: [], grupos: [], palavras: [], anuncios: [], produtos: [], metricas: [], termos: [], leads: [], conversoes: [] };
const vazio: Dados = {
  pronto: false, empresas: [], contatos: [], resumos: new Map(), config: CONFIG_PADRAO, porId: new Map(),
  orcamentos: [], materiais: [], movimentos: [], saldo: new Map(), recibos: [], unidades: [], unidade: null, semUnidade: { materiais: 0, orcamentos: 0 },
  mk: MK_VAZIO, campanhasDeOutras: [], setUnidade: () => {},
};
const Ctx = createContext<Dados>(vazio);
const CHAVE_UNIDADE = 'kivor-unidade'; // escolha por aparelho
/** "Agora" que avança sozinho a cada minuto (para "há X dias" e a tela Hoje virarem à meia-noite). */
export function useAgora(): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

export function DadosProvider({ children }: { children: ComponentChildren }) {
  const [bruto, setBruto] = useState<{ t: Tabelas; config: Configuracoes } | null>(null);
  const [escolhida, setEscolhida] = useState(() => globalThis.localStorage?.getItem(CHAVE_UNIDADE) ?? '');
  const agora = useAgora();
  const dia = agora.toDateString();

  useEffect(() => {
    const sub = liveQuery(async () => {
      const t = {} as Record<(typeof TABELAS)[number], Registro[]>;
      for (const n of TABELAS) t[n] = (await tabela(n).toArray()).filter((r) => !r.excluidoEm);
      return { t: t as unknown as Tabelas, config: await lerConfig() };
    }).subscribe({ next: setBruto, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  }, []);

  const dados = useMemo<Dados>(() => {
    if (!bruto) return vazio;
    const { t } = bruto;
    const ids = new Set(t.empresas.map((e) => e.id));
    const unidades = [...t.unidades].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const unidade = unidades.find((u) => u.id === escolhida) ?? unidades[0] ?? null;
    const ha = unidades.length > 0;
    const uid = unidade?.id ?? null;
    const materiais = daUnidade(t.materiais, uid, ha);
    const idsMat = new Set(materiais.map((m) => m.id));
    const movimentos = ha ? t.movimentos.filter((v) => idsMat.has(v.materialId)) : t.movimentos;
    const mk = <T extends { unidadeId?: string | null }>(l: T[]) => daUnidade(l, uid, true);
    return {
      pronto: true,
      empresas: t.empresas,
      contatos: t.contatos,
      config: bruto.config,
      resumos: resumir(t.contatos.filter((c) => ids.has(c.empresaId))),
      porId: new Map(t.empresas.map((e) => [e.id, e])),
      orcamentos: daUnidade(t.orcamentos, uid, ha),
      materiais,
      movimentos,
      saldo: saldos(movimentos),
      recibos: daUnidade(t.recibos, uid, ha),
      unidades,
      unidade,
      semUnidade: { materiais: ha ? semUnidade(t.materiais).length : 0, orcamentos: ha ? semUnidade(t.orcamentos).length : 0 },
      mk: {
        contas: mk(t.mkContas), campanhas: mk(t.mkCampanhas), grupos: mk(t.mkGrupos), palavras: mk(t.mkPalavras), anuncios: mk(t.mkAnuncios),
        produtos: mk(t.mkProdutos), metricas: mk(t.mkMetricas), termos: mk(t.mkTermos), leads: mk(t.mkLeads), conversoes: mk(t.mkConversoes),
      },
      campanhasDeOutras: (() => {
        const contas = new Map(t.mkContas.map((c) => [c.id, c]));
        const nomes = new Map(unidades.map((x) => [x.id, x.nome]));
        return t.mkCampanhas.filter((c) => c.unidadeId !== uid && nomes.has(c.unidadeId) && contas.has(c.contaId))
          .map((c) => ({ campanha: c, conta: contas.get(c.contaId)!, empresa: nomes.get(c.unidadeId)! }));
      })(),
      setUnidade: (id: string) => { globalThis.localStorage?.setItem(CHAVE_UNIDADE, id); setEscolhida(id); },
    };
    // recalcula também na virada do dia
  }, [bruto, dia, escolhida]);

  useEffect(() => { definirUnidadeAtiva(dados.unidade?.id ?? null); }, [dados.unidade]);

  return <Ctx.Provider value={dados}>{children}</Ctx.Provider>;
}
export function useDados(): Dados {
  return useContext(Ctx);
}

// ---------- Rotas (hash) ----------

export interface Rota { partes: string[]; q: URLSearchParams }

function lerRota(): Rota {
  const [caminho, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { partes: caminho.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(query) };
}

export function useRota(): Rota {
  const ler = lerRota;
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const f = () => { setRota(ler()); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return rota;
}

export function ir(caminho: string): void {
  location.hash = '#/' + caminho;
}

export function voltar(padrao = 'hoje'): void {
  if (history.length > 1) history.back();
  else ir(padrao);
}
