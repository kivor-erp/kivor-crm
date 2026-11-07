import { liveQuery } from 'dexie';
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { db, lerConfig } from './db';
import { saldos } from './lib/estoque';
import { CONFIG_PADRAO, type Configuracoes, type Contato, type Empresa, type Material, type Movimento, type Orcamento } from './lib/model';
import { resumir, type ResumoEmpresa } from './lib/regras';

export interface Dados {
  pronto: boolean;
  empresas: Empresa[]; // sem as excluídas
  contatos: Contato[]; // sem os excluídos
  resumos: Map<string, ResumoEmpresa>;
  config: Configuracoes;
  porId: Map<string, Empresa>;
  orcamentos: Orcamento[];
  materiais: Material[];
  movimentos: Movimento[];
  saldo: Map<string, number>;
}

const vazio: Dados = {
  pronto: false, empresas: [], contatos: [], resumos: new Map(), config: CONFIG_PADRAO, porId: new Map(),
  orcamentos: [], materiais: [], movimentos: [], saldo: new Map(),
};
const Ctx = createContext<Dados>(vazio);

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
  const [bruto, setBruto] = useState<Omit<Dados, 'pronto' | 'resumos' | 'porId' | 'saldo'> | null>(null);
  const agora = useAgora();
  const dia = agora.toDateString();

  useEffect(() => {
    const sub = liveQuery(async () => {
      const empresas = await db.empresas.toArray();
      const contatos = await db.contatos.toArray();
      const orcamentos = await db.orcamentos.toArray();
      const materiais = await db.materiais.toArray();
      const movimentos = await db.movimentos.toArray();
      const config = await lerConfig();
      const ativo = (r: { excluidoEm: string | null }) => !r.excluidoEm;
      return {
        empresas: empresas.filter(ativo),
        contatos: contatos.filter(ativo),
        orcamentos: orcamentos.filter(ativo),
        materiais: materiais.filter(ativo),
        movimentos: movimentos.filter(ativo),
        config,
      };
    }).subscribe({ next: setBruto, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
  }, []);

  const dados = useMemo<Dados>(() => {
    if (!bruto) return vazio;
    const ids = new Set(bruto.empresas.map((e) => e.id));
    return {
      pronto: true,
      ...bruto,
      resumos: resumir(bruto.contatos.filter((c) => ids.has(c.empresaId))),
      porId: new Map(bruto.empresas.map((e) => [e.id, e])),
      saldo: saldos(bruto.movimentos),
    };
    // recalcula também na virada do dia
  }, [bruto, dia]);

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
