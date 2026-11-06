import { entrar } from './auth';
import { corUltimoContato, textoHaDias } from './lib/datas';
import { nomeEtapa, type Configuracoes, type Empresa } from './lib/model';
import { linkMapsDe, linkTel, linkWhatsApp, separarTelefones, type ResumoEmpresa } from './lib/regras';
import { ir } from './store';
import { sincronizar, textoEstado, useSync } from './sync';

export function SeloDias({ resumo, config }: { resumo: ResumoEmpresa | undefined; config: Configuracoes }) {
  const dias = resumo?.diasUltimo ?? null;
  const cor = corUltimoContato(dias, config);
  return <span class={`dias ${cor}`}>{dias === null ? 'nunca contatada' : `último contato ${textoHaDias(dias)}`}</span>;
}

export function SeloEtapa({ etapa }: { etapa: number }) {
  return <span class="selo etapa">{etapa}. {nomeEtapa(etapa)}</span>;
}

export function SeloClasse({ e }: { e: Empresa }) {
  if (!e.classe) return null;
  return <span class={`selo classe-${e.classe}`} title={e.pontuacao !== null ? `Pontuação ${e.pontuacao}` : undefined}>
    {e.classe}{e.pontuacao !== null ? ` · ${e.pontuacao}` : ''}
  </span>;
}

/** Botões de ação rápida: ligar, WhatsApp, e-mail, Maps e "Registrar". */
export function BotoesAcao({ e, telefone, semRegistrar }: { e: Empresa; telefone?: string; semRegistrar?: boolean }) {
  const tel = telefone ?? separarTelefones(e.telefone)[0];
  const maps = linkMapsDe(e);
  return (
    <div class="acoes">
      {tel && <a class="botao" href={linkTel(tel)}><span class="ic">📞</span>Ligar</a>}
      {tel && <a class="botao" href={linkWhatsApp(tel)} target="_blank" rel="noopener"><span class="ic">💬</span>WhatsApp</a>}
      {e.email && <a class="botao" href={`mailto:${e.email}`}><span class="ic">✉️</span>E-mail</a>}
      {maps && <a class="botao" href={maps} target="_blank" rel="noopener"><span class="ic">📍</span>Maps</a>}
      {!semRegistrar && <button class="registrar" onClick={() => ir(`registrar/${e.id}`)}><span class="ic">✚</span>Registrar</button>}
    </div>
  );
}

/** Estado da sincronização; tocar tenta de novo (ou pede login, se a sessão expirou). */
function EstadoSync() {
  const e = useSync();
  const txt = textoEstado(e);
  if (!txt) return null;
  return (
    <button class={`estado-sync ${e.tipo}`} title={e.msg} onClick={() => (e.tipo === 'login' ? entrar() : sincronizar())}>
      {txt}
    </button>
  );
}

export function Topo({ titulo, voltar }: { titulo: string; voltar?: () => void }) {
  return (
    <header class="topo">
      {voltar ? <button onClick={voltar} aria-label="Voltar">←</button> : <span class="marca" />}
      <h1>{titulo}</h1>
      <EstadoSync />
    </header>
  );
}
