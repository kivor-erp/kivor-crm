import { BotoesAcao, SeloEtapa } from '../componentes';
import { fmtData } from '../lib/datas';
import { nomeEmpresa, RESULTADO_CURTO } from '../lib/model';
import { montarAgenda, type ItemAgenda } from '../lib/regras';
import { ir, useAgora, useDados } from '../store';

function quando(dias: number): string {
  if (dias < -1) return `atrasado ${-dias} dias`;
  if (dias === -1) return 'era para ontem';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}

function Item({ it }: { it: ItemAgenda }) {
  const e = it.empresa;
  const fu = it.resumo.followUp!;
  return (
    <li class="cartao">
      <a class="linha-empresa" href={`#/empresa/${e.id}`}>
        <div class="nome">{nomeEmpresa(e)}</div>
        <div class="sub">{[e.bairro, e.segmento].filter(Boolean).join(' · ')}</div>
        <div class="meta">
          <span class={`dias ${it.dias < 0 ? 'vermelho' : it.dias === 0 ? 'amarelo' : 'verde'}`}>
            {fmtData(it.data)} · {quando(it.dias)}
          </span>
          <SeloEtapa etapa={e.etapa} />
        </div>
        {fu.acao && <div style="margin-top:6px">➜ {fu.acao}</div>}
        <div class="peq">Último: {fu.contato.canal} · {RESULTADO_CURTO[fu.contato.resultado]}{fu.contato.pessoa ? ` · ${fu.contato.pessoa}` : ''}</div>
      </a>
      <BotoesAcao e={e} />
    </li>
  );
}

function Grupo({ titulo, itens }: { titulo: string; itens: ItemAgenda[] }) {
  if (!itens.length) return null;
  return (
    <>
      <h2>{titulo} ({itens.length})</h2>
      <ul class="lista">{itens.map((it) => <Item key={it.empresa.id} it={it} />)}</ul>
    </>
  );
}

export function Hoje() {
  const d = useDados();
  const agora = useAgora();
  if (!d.pronto) return null;

  if (!d.empresas.length) {
    return (
      <div class="cartao vazio">
        <p>Nenhuma empresa ainda.</p>
        <button class="primario grande" onClick={() => ir('config/importar')}>Importar planilha</button>
      </div>
    );
  }

  const ag = montarAgenda(d.empresas, d.resumos, agora);
  const total = ag.vencidos.length + ag.hoje.length + ag.proximos.length;
  const nunca = d.empresas.filter((e) => !d.resumos.has(e.id)).length;

  return (
    <>
      <Grupo titulo="Atrasados" itens={ag.vencidos} />
      <Grupo titulo="Hoje" itens={ag.hoje} />
      <Grupo titulo="Próximos 7 dias" itens={ag.proximos} />
      {total === 0 && (
        <div class="cartao vazio">
          <p>Nenhum follow-up para os próximos 7 dias.</p>
          {nunca > 0 && <p class="peq">{nunca} empresas ainda não foram contatadas.</p>}
          <button class="primario" onClick={() => ir('empresas?f=top,nunca')}>Ver Top 50 nunca contatadas</button>
        </div>
      )}
    </>
  );
}
