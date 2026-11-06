import { useEffect, useState } from 'preact/hooks';
import { entrar, iniciarAuth } from './auth';
import { Topo } from './componentes';
import { iniciarSync, useSync } from './sync';
import { montarAgenda } from './lib/regras';
import { DadosProvider, useAgora, useDados, useRota } from './store';
import { Config, Importar, Restaurar } from './telas/Config';
import { Empresas } from './telas/Empresas';
import { Ficha } from './telas/Ficha';
import { Hoje } from './telas/Hoje';
import { Painel } from './telas/Painel';
import { Registrar } from './telas/Registrar';

// Módulos da família Kivor. Itens vazios = módulo ainda não construído.
const MODULOS = [
  { id: 'crm', nome: 'CRM', ic: '🤝', itens: [
    { rota: 'hoje', rotulo: 'Hoje' },
    { rota: 'empresas', rotulo: 'Empresas' },
    { rota: 'painel', rotulo: 'Painel' },
  ] },
  { id: 'orcamentos', nome: 'Orçamentos', ic: '🧾', itens: [] },
  { id: 'wms', nome: 'WMS', ic: '📦', itens: [] },
];
const AJUSTES = { id: 'config', nome: 'Ajustes', ic: '⚙️' };
// telas de detalhe pertencem ao CRM
const MODULO_DA_TELA: Record<string, string> = { empresa: 'crm', registrar: 'crm', config: 'config' };

function moduloDe(tela: string): string {
  return MODULOS.find((m) => m.id === tela || m.itens.some((i) => i.rota === tela))?.id ?? MODULO_DA_TELA[tela] ?? 'crm';
}

function Lateral({ atual }: { atual: string }) {
  const d = useDados();
  const agora = useAgora();
  const pend = (() => { const ag = montarAgenda(d.empresas, d.resumos, agora); return ag.vencidos.length + ag.hoje.length; })();
  const link = (m: { id: string; nome: string; ic: string }, href: string) => (
    <a key={m.id} href={href} class={atual === m.id ? 'ativo' : ''} title={m.nome}>
      <span class="ic">{m.ic}</span>
      <span class="nome">{m.nome}</span>
      {m.id === 'crm' && pend > 0 && <span class="contador">{pend}</span>}
    </a>
  );
  return (
    <nav class="lateral">
      <div class="logo-k"><img src="./icone.svg" alt="" /><span class="nome">KIVOR</span></div>
      {MODULOS.map((m) => link(m, `#/${m.itens[0]?.rota ?? m.id}`))}
      <div class="espaco" />
      {link(AJUSTES, '#/config')}
    </nav>
  );
}

function BarraItens({ modulo, atual }: { modulo: (typeof MODULOS)[number]; atual: string }) {
  if (!modulo.itens.length) return null;
  return (
    <nav class="abas">
      {modulo.itens.map((i) => <a key={i.rota} href={`#/${i.rota}`} class={atual === i.rota ? 'ativa' : ''}>{i.rotulo}</a>)}
    </nav>
  );
}

function EmBreve({ nome }: { nome: string }) {
  return <div class="cartao vazio"><p style="font-size:1.1rem"><b>{nome}</b></p><p>Módulo em construção.</p></div>;
}

function Tela({ tela, arg }: { tela: string; arg?: string }) {
  const rota = useRota();
  // telas de detalhe: cabeçalho próprio com "voltar"
  if (tela === 'empresa' && arg) return <Ficha id={arg} />;
  if (tela === 'registrar' && arg) return <Registrar empresaId={arg} contatoId={rota.q.get('contato')} />;
  if (tela === 'config' && arg === 'importar') return <Importar />;
  if (tela === 'config' && arg === 'restaurar') return <Restaurar />;

  if (tela === 'config') return <><Topo titulo="Ajustes" /><main><Config /></main></>;
  const modulo = MODULOS.find((m) => m.id === moduloDe(tela))!;
  const item = modulo.itens.find((i) => i.rota === tela) ?? modulo.itens[0];
  return (
    <>
      <Topo titulo={item ? `${modulo.nome} · ${item.rotulo}` : modulo.nome} />
      <BarraItens modulo={modulo} atual={item?.rota ?? ''} />
      <main>
        {!item && <EmBreve nome={modulo.nome} />}
        {item?.rota === 'hoje' && <Hoje />}
        {item?.rota === 'empresas' && <Empresas rota={rota} />}
        {item?.rota === 'painel' && <Painel />}
      </main>
    </>
  );
}

function Telas() {
  const rota = useRota();
  const [tela = 'hoje', arg] = rota.partes;
  return (
    <div class="layout">
      <Lateral atual={moduloDe(tela)} />
      <div class="conteudo"><Tela tela={tela} arg={arg} /></div>
    </div>
  );
}

function Login({ erro }: { erro: string }) {
  return (
    <div class="tela-login">
      <img class="logo" src="./icone.svg" alt="" />
      <h1>KIVOR-CRM</h1>
      <p style="margin:2px 0 0;color:var(--suave)">SOF TECNOELETRO</p>
      <p class="peq">Entre com a sua conta Microsoft da Voltrum. Os dados ficam no OneDrive, na pasta SOF_CRM.</p>
      {erro && <div class="erro">{erro}</div>}
      <button class="primario grande" onClick={() => void entrar()}>Entrar com a conta Microsoft</button>
    </div>
  );
}

/** Primeiro uso num aparelho novo: enquanto baixa o crm.json, não mostra "nenhuma empresa". */
function Conteudo() {
  const d = useDados();
  const s = useSync();
  if (d.pronto && !d.empresas.length && (s.tipo === 'inicio' || s.tipo === 'sincronizando')) {
    return <><Topo titulo="KIVOR-CRM" /><main><div class="cartao vazio">Baixando seus dados do OneDrive…</div></main></>;
  }
  return <Telas />;
}

export function App() {
  const [auth, setAuth] = useState<{ ok: boolean; erro: string } | null>(null);
  useEffect(() => {
    iniciarAuth()
      .then((c) => { setAuth({ ok: !!c, erro: '' }); if (c) iniciarSync(); })
      .catch((e) => setAuth({ ok: false, erro: `Falha no login: ${(e as Error).message}` }));
  }, []);
  if (!auth) return null;
  if (!auth.ok) return <Login erro={auth.erro} />;
  return <DadosProvider><Conteudo /></DadosProvider>;
}
