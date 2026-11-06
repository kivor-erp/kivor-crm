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

const ABAS = [
  { rota: 'hoje', rotulo: 'Hoje', ic: '📅' },
  { rota: 'empresas', rotulo: 'Empresas', ic: '🏭' },
  { rota: 'painel', rotulo: 'Painel', ic: '📊' },
  { rota: 'config', rotulo: 'Ajustes', ic: '⚙️' },
];

function Abas({ atual }: { atual: string }) {
  const d = useDados();
  const agora = useAgora();
  const ag = montarAgenda(d.empresas, d.resumos, agora);
  const pend = ag.vencidos.length + ag.hoje.length;
  return (
    <nav class="abas">
      {ABAS.map((a) => (
        <a key={a.rota} href={`#/${a.rota}`} class={atual === a.rota ? 'ativa' : ''}>
          <span class="ic">{a.ic}</span>
          <span>{a.rotulo}{a.rota === 'hoje' && pend > 0 && <span class="contador">{pend}</span>}</span>
        </a>
      ))}
    </nav>
  );
}

function Telas() {
  const rota = useRota();
  const [tela = 'hoje', arg] = rota.partes;

  // telas de detalhe: têm cabeçalho próprio com "voltar" e sem abas
  if (tela === 'empresa' && arg) return <Ficha id={arg} />;
  if (tela === 'registrar' && arg) return <Registrar empresaId={arg} contatoId={rota.q.get('contato')} />;
  if (tela === 'config' && arg === 'importar') return <Importar />;
  if (tela === 'config' && arg === 'restaurar') return <Restaurar />;

  const aba = ABAS.find((a) => a.rota === tela) ?? ABAS[0];
  return (
    <>
      <Topo titulo={aba.rota === 'hoje' ? 'CRM SOF · Hoje' : aba.rotulo} />
      <Abas atual={aba.rota} />
      <main>
        {aba.rota === 'hoje' && <Hoje />}
        {aba.rota === 'empresas' && <Empresas rota={rota} />}
        {aba.rota === 'painel' && <Painel />}
        {aba.rota === 'config' && <Config />}
      </main>
    </>
  );
}

function Login({ erro }: { erro: string }) {
  return (
    <div class="tela-login">
      <img class="logo" src="./icone.svg" alt="" />
      <h1>CRM SOF</h1>
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
    return <><Topo titulo="CRM SOF" /><main><div class="cartao vazio">Baixando seus dados do OneDrive…</div></main></>;
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
