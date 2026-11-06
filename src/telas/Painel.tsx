import { fmtData } from '../lib/datas';
import { funil, metricas, porGrupo, semanas, valorEmPropostas, type LinhaGrupo, type Metricas } from '../lib/metricas';
import { ETAPAS } from '../lib/model';
import { fmtMoeda } from '../lib/regras';
import { useAgora, useDados } from '../store';

function Numero({ rotulo, atual, anterior, moeda }: { rotulo: string; atual: number; anterior: number; moeda?: boolean }) {
  const d = atual - anterior;
  const fmt = (v: number) => (moeda ? fmtMoeda(v) : String(v));
  return (
    <div class="cartao num">
      <b>{fmt(atual)}</b>
      <span>{rotulo}</span>
      <span class={`delta ${d > 0 ? 'sobe' : d < 0 ? 'desce' : ''}`}>
        {d === 0 ? '= ' : d > 0 ? '▲ ' : '▼ '}semana passada: {fmt(anterior)}
      </span>
    </div>
  );
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: LinhaGrupo[] }) {
  return (
    <>
      <h2>{titulo}</h2>
      <div class="cartao" style="overflow-x:auto">
        {linhas.length === 0 ? <div class="peq">Nenhum contato nestas duas semanas.</div> : (
          <table class="tabela">
            <thead><tr><th></th><th>Contatos</th><th>Respostas</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.grupo}>
                  <td>{l.grupo}</td>
                  <td>{l.contatos[0]} <span class="peq">({l.contatos[1]})</span></td>
                  <td>{l.respostas[0]} <span class="peq">({l.respostas[1]})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div class="peq" style="margin-top:6px">Esta semana (semana passada).</div>
      </div>
    </>
  );
}

export function Painel() {
  const d = useDados();
  const agora = useAgora();
  if (!d.pronto) return null;
  const s = semanas(agora);
  const a: Metricas = metricas(d.empresas, d.contatos, s.atual);
  const p: Metricas = metricas(d.empresas, d.contatos, s.anterior);
  const f = funil(d.empresas);
  const maxF = Math.max(1, ...f);

  return (
    <>
      <p class="peq" style="margin:0">Semana de {fmtData(s.atual.ini)} a {fmtData(s.atual.fim)}, comparada com a anterior.</p>

      <h2>Atividade (o que eu fiz)</h2>
      <div class="grade-num">
        <Numero rotulo="contatos feitos" atual={a.contatos} anterior={p.contatos} />
        <Numero rotulo="empresas contatadas" atual={a.empresasContatadas} anterior={p.empresasContatadas} />
      </div>

      <h2>Resultado (o que voltou)</h2>
      <div class="grade-num">
        <Numero rotulo="respostas" atual={a.respostas} anterior={p.respostas} />
        <Numero rotulo="conversas com decisor" atual={a.decisor} anterior={p.decisor} />
        <Numero rotulo="visitas agendadas" atual={a.visitas} anterior={p.visitas} />
        <Numero rotulo="propostas enviadas" atual={a.propostas} anterior={p.propostas} />
        <Numero rotulo="contratos fechados" atual={a.contratos} anterior={p.contratos} />
        <Numero rotulo="valor fechado" atual={a.valorContratos} anterior={p.valorContratos} moeda />
      </div>
      <div class="cartao">
        <b>{fmtMoeda(valorEmPropostas(d.empresas)) || 'R$ 0'}</b> estimados em propostas abertas (etapas 7 e 8).
      </div>

      <h2>Funil agora</h2>
      <div class="cartao">
        {ETAPAS.map((nome, i) => (
          <a key={nome} class="barra" href={`#/empresas?etapa=${i + 1}`}>
            <span class="rot">{i + 1}. {nome}</span>
            <span class="trilho"><span style={`width:${(f[i] / maxF) * 100}%`} /></span>
            <span class="qtd">{f[i]}</span>
          </a>
        ))}
      </div>

      <Tabela titulo="Por canal" linhas={porGrupo(d.empresas, d.contatos, s.atual, s.anterior, 'canal')} />
      <Tabela titulo="Por segmento" linhas={porGrupo(d.empresas, d.contatos, s.atual, s.anterior, 'segmento')} />
      <p class="peq">"Propostas enviadas" conta empresas que chegaram à etapa 7 ou além na semana; mudanças de etapa passaram a ser registradas a partir desta versão.</p>
    </>
  );
}
