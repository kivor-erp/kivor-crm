import { useEffect, useState } from 'preact/hooks';
import { Topo } from '../componentes';
import { conta, entrar, LoginNecessario, sair, token } from '../auth';
import { TABELAS, aplicarImportacao, aplicarRestauracao, db, lerTudo, limparLocal, salvarConfig, type NomeTabela } from '../db';

const ROTULO_TABELA: Record<NomeTabela, string> = {
  empresas: 'Empresas', contatos: 'Contatos', orcamentos: 'Orçamentos', materiais: 'Materiais', movimentos: 'Movimentações',
};
import { fmtData } from '../lib/datas';
import { nomeEmpresa } from '../lib/model';
import { planejarRestauracao, type PlanoRestauracao } from '../lib/restaurar';
import { contarPendentes } from '../lib/sincronia';
import { baixarBackup, copiaAntesDeRestaurar, listarBackups, type ItemBackup } from '../onedrive';
import type { LeituraPlanilha, PlanoImportacao } from '../lib/importar';
import { ir, useDados, voltar } from '../store';
import { sincronizar, textoEstado, useSync } from '../sync';

async function exportar(tipo: 'excel' | 'json') {
  const { exportarExcel, exportarJson } = await import('../lib/exportar'); // SheetJS só carrega aqui
  const t = await lerTudo();
  (tipo === 'excel' ? exportarExcel : exportarJson)(t);
}

export function Config() {
  const d = useDados();
  const [verde, setVerde] = useState(String(d.config.limiteVerde));
  const [amarelo, setAmarelo] = useState(String(d.config.limiteAmarelo));
  const [msg, setMsg] = useState('');
  useEffect(() => { setVerde(String(d.config.limiteVerde)); setAmarelo(String(d.config.limiteAmarelo)); }, [d.config]);

  async function salvarLimites() {
    const v = Number(verde), a = Number(amarelo);
    if (!(v >= 0) || !(a > v)) return setMsg('O limite amarelo precisa ser maior que o verde.');
    await salvarConfig({ ...d.config, limiteVerde: Math.round(v), limiteAmarelo: Math.round(a) });
    setMsg('Limites salvos.');
  }

  return (
    <>
      <h2>Planilha</h2>
      <div class="cartao">
        <p style="margin-top:0">{d.empresas.length} empresas no CRM · {d.contatos.length} contatos registrados.</p>
        <button class="primario grande" onClick={() => ir('config/importar')}>Importar planilha (.xlsx)</button>
      </div>

      <h2>Exportar e backup</h2>
      <div class="cartao">
        <div class="fila">
          <button onClick={() => void exportar('excel')}>Exportar Excel</button>
          <button onClick={() => void exportar('json')}>Exportar JSON</button>
        </div>
        <button style="margin-top:8px;width:100%" onClick={() => ir('config/restaurar')}>Restaurar de um backup…</button>
      </div>

      <h2>Cores do "último contato"</h2>
      <div class="cartao">
        <div class="grade2">
          <div><label>Verde até (dias)</label><input type="number" min="0" value={verde} onInput={(e) => setVerde(e.currentTarget.value)} /></div>
          <div><label>Amarelo até (dias)</label><input type="number" min="1" value={amarelo} onInput={(e) => setAmarelo(e.currentTarget.value)} /></div>
        </div>
        <p class="peq">Acima disso fica vermelho. Cinza = nunca contatada.</p>
        {msg && <div class={msg.includes('salvos') ? 'sucesso' : 'erro'}>{msg}</div>}
        <button onClick={salvarLimites}>Salvar limites</button>
      </div>

      <h2>Conta e OneDrive</h2>
      <Conta />
    </>
  );
}

export function Importar() {
  const d = useDados();
  const [leitura, setLeitura] = useState<LeituraPlanilha | null>(null);
  const [plano, setPlano] = useState<PlanoImportacao | null>(null);
  const [nomeArq, setNomeArq] = useState('');
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState<PlanoImportacao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function escolher(f: File | undefined) {
    setErro(''); setPlano(null); setFeito(null); setLeitura(null);
    if (!f) return;
    setNomeArq(f.name);
    setOcupado(true);
    try {
      const { lerArquivo, planejarImportacao } = await import('../lib/importar'); // SheetJS só é baixado aqui
      const l = lerArquivo(await f.arrayBuffer());
      if (!l.abasLidas.length) throw new Error('Nenhuma aba com as colunas "Razão social" e "CNPJ" foi encontrada.');
      setLeitura(l);
      // compara com o banco inteiro (inclui excluídas, para não recriá-las)
      setPlano(planejarImportacao(await db.empresas.toArray(), l));
    } catch (e) {
      setErro(`Não consegui ler a planilha: ${(e as Error).message}`);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!plano || !leitura) return;
    setOcupado(true);
    // recalcula na hora de gravar, caso algo tenha mudado desde a pré-visualização
    const { planejarImportacao } = await import('../lib/importar');
    const p = planejarImportacao(await db.empresas.toArray(), leitura);
    await aplicarImportacao([...p.novas, ...p.atualizadas]);
    setFeito(p); setPlano(null); setOcupado(false);
  }

  const ignoradasTotal = (p: PlanoImportacao) => p.semMudanca + p.ignoradas.length;

  return (
    <>
      <Topo titulo="Importar planilha" voltar={() => voltar('config')} />
      <main>
        <div class="cartao">
          <p style="margin-top:0">Escolha o arquivo <b>Empresas_Serra_SOFTecnoeletro.xlsx</b>. Ele é lido só neste navegador.</p>
          <p class="peq">Importar de novo atualiza apenas os dados cadastrais (nome, telefone, endereço, pontuação…).
            Contatos, etapa, valores e notas nunca são apagados. Empresas são cruzadas pelo CNPJ.</p>
          <input type="file" accept=".xlsx,.xlsm,.xls" disabled={ocupado} onChange={(e) => {
            const inp = e.currentTarget;
            void escolher(inp.files?.[0]).finally(() => { inp.value = ''; }); // permite escolher o mesmo arquivo de novo
          }} />
        </div>
        {ocupado && <div class="cartao">Lendo…</div>}
        {erro && <div class="erro">{erro}</div>}

        {plano && leitura && (
          <div class="cartao">
            <h3>Pré-visualização — {nomeArq}</h3>
            <p class="peq">Abas lidas: {leitura.abasLidas.join(', ')}{leitura.rankingEncontrado ? ' + Ranking Top 50' : ' (aba de ranking não encontrada)'}</p>
            <div class="resumo-num">
              <div><b>{plano.novas.length}</b>novas</div>
              <div><b>{plano.atualizadas.length}</b>atualizadas</div>
              <div><b>{ignoradasTotal(plano)}</b>ignoradas</div>
            </div>
            <Ignoradas p={plano} />
            <button class="primario grande" style="margin-top:12px" disabled={ocupado || (!plano.novas.length && !plano.atualizadas.length)} onClick={confirmar}>
              {plano.novas.length || plano.atualizadas.length ? 'Confirmar importação' : 'Nada para importar'}
            </button>
          </div>
        )}

        {feito && (
          <div class="sucesso">
            Importação concluída: {feito.novas.length} novas, {feito.atualizadas.length} atualizadas, {ignoradasTotal(feito)} ignoradas.
            <div style="margin-top:8px"><button class="primario" onClick={() => ir('empresas')}>Ver empresas ({d.empresas.length})</button></div>
          </div>
        )}
      </main>
    </>
  );
}

function Ignoradas({ p }: { p: PlanoImportacao }) {
  if (!p.semMudanca && !p.ignoradas.length) return null;
  return (
    <details>
      <summary>Ver ignoradas</summary>
      <ul class="peq">
        {p.semMudanca > 0 && <li>{p.semMudanca} já estavam iguais no CRM</li>}
        {p.ignoradas.map((i) => <li key={`${i.aba}-${i.linha}`}>{i.aba}, linha {i.linha}{i.nome ? ` (${i.nome})` : ''}: {i.motivo}</li>)}
      </ul>
    </details>
  );
}

function Conta() {
  const s = useSync();
  const [aviso, setAviso] = useState('');
  async function sairDaConta() {
    await sincronizar();
    const n = await contarPendentes();
    if (n) return setAviso(`Há ${n} alterações que ainda não chegaram ao OneDrive. Conecte-se à internet e espere aparecer "Salvo no OneDrive" antes de sair.`);
    if (!confirm('Sair da conta? Os dados deste aparelho serão apagados (continuam no OneDrive).')) return;
    await limparLocal();
    await sair();
  }
  return (
    <div class="cartao">
      <p style="margin-top:0">Conectado como <b>{conta()?.username}</b></p>
      <p class="peq">Dados em OneDrive › SOF_CRM › crm.json. Backup diário em SOF_CRM › backup (últimos 30 dias).</p>
      <p>{textoEstado(s) || '—'}</p>
      {s.tipo === 'erro' && s.msg && <div class="erro">{s.msg}</div>}
      {aviso && <div class="erro">{aviso}</div>}
      <div class="fila">
        <button onClick={() => void sincronizar()}>Sincronizar agora</button>
        <button class="perigo" onClick={sairDaConta}>Sair da conta</button>
      </div>
    </div>
  );
}

export function Restaurar() {
  const d = useDados();
  const [lista, setLista] = useState<ItemBackup[] | null>(null);
  const [escolhido, setEscolhido] = useState<ItemBackup | null>(null);
  const [plano, setPlano] = useState<PlanoRestauracao | null>(null);
  const [erro, setErro] = useState<{ texto: string; login?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState('');
  const [feito, setFeito] = useState('');

  const falhou = (e: unknown) => setErro(e instanceof LoginNecessario
    ? { texto: 'Sua sessão expirou.', login: true }
    : { texto: e instanceof TypeError ? 'Sem internet: a restauração precisa do OneDrive.' : (e as Error).message });

  useEffect(() => {
    (async () => {
      try {
        setOcupado('Sincronizando antes de listar…');
        await sincronizar(); // a comparação é feita com o estado mais recente
        setLista(await listarBackups(await token()));
      } catch (e) { falhou(e); } finally { setOcupado(''); }
    })();
  }, []);

  async function escolher(b: ItemBackup) {
    setEscolhido(b); setPlano(null); setErro(null);
    try {
      setOcupado('Baixando o backup…');
      setPlano(planejarRestauracao(await lerTudo(), await baixarBackup(await token(), b.id)));
    } catch (e) { falhou(e); } finally { setOcupado(''); }
  }

  async function restaurar() {
    if (!plano || !escolhido) return;
    if (!confirm(`Restaurar o backup de ${fmtData(escolhido.dia)}? Os dados atuais serão substituídos em todos os aparelhos.`)) return;
    try {
      setOcupado('Guardando uma cópia do estado atual…');
      const atual = await lerTudo();
      const copia = await copiaAntesDeRestaurar(await token(), { versao: 2, salvoEm: new Date().toISOString(), ...atual });
      setOcupado('Restaurando…');
      await aplicarRestauracao(plano.dados);
      await sincronizar();
      setFeito(`Backup de ${fmtData(escolhido.dia)} restaurado. O estado anterior foi guardado em SOF_CRM › backup › ${copia}.`);
      setPlano(null);
    } catch (e) { falhou(e); } finally { setOcupado(''); }
  }

  const Linha = ({ rot, dif }: { rot: string; dif: PlanoRestauracao['dif']['empresas'] }) => (
    <tr><td>{rot}</td><td>{dif.ativosAgora}</td><td>{dif.ativosBackup}</td><td>{dif.somem}</td><td>{dif.voltam}</td><td>{dif.mudam}</td></tr>
  );

  return (
    <>
      <Topo titulo="Restaurar backup" voltar={() => voltar('config')} />
      <main>
        {ocupado && <div class="cartao">{ocupado}</div>}
        {erro && <div class="erro">{erro.texto} {erro.login && <button onClick={() => void entrar()}>Entrar</button>}</div>}
        {feito && <div class="sucesso">{feito}</div>}
        {lista && !feito && (
          <div class="cartao">
            <p style="margin-top:0">Backups diários em OneDrive › SOF_CRM › backup:</p>
            {lista.length === 0 && <p class="peq">Nenhum backup ainda. O primeiro é feito na primeira sincronização do dia.</p>}
            <div class="chips">
              {lista.map((b) => (
                <button key={b.id} class={`chip peq ${escolhido?.id === b.id ? 'sel' : ''}`} onClick={() => escolher(b)}>
                  {fmtData(b.dia)} <span style="opacity:.7">· {Math.max(1, Math.round(b.tamanho / 1024))} KB</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {plano && escolhido && (
          <div class="cartao">
            <h3>O que muda se restaurar {fmtData(escolhido.dia)}</h3>
            <div style="overflow-x:auto">
              <table class="tabela">
                <thead><tr><th></th><th>Hoje</th><th>No backup</th><th>Somem</th><th>Voltam</th><th>Mudam</th></tr></thead>
                <tbody>
                  {TABELAS.map((n) => <Linha key={n} rot={ROTULO_TABELA[n]} dif={plano.dif[n]} />)}
                </tbody>
              </table>
            </div>
            {plano.contatosPerdidos.length > 0 && (
              <details open={plano.contatosPerdidos.length <= 10}>
                <summary>Contatos que deixarão de aparecer ({plano.contatosPerdidos.length})</summary>
                <ul class="peq">
                  {plano.contatosPerdidos.map((c) => {
                    const e = d.porId.get(c.empresaId);
                    return <li key={c.id}>{fmtData(c.dataHora)} · {e ? nomeEmpresa(e) : '?'} · {c.canal} · {c.resultado}</li>;
                  })}
                </ul>
              </details>
            )}
            <p class="peq">Nada é apagado de vez: o que sumir fica marcado como excluído, e o estado atual é salvo numa cópia no OneDrive antes de restaurar.</p>
            <button class="primario grande perigo-fundo" disabled={!!ocupado} onClick={restaurar}>Restaurar este backup</button>
          </div>
        )}
      </main>
    </>
  );
}
