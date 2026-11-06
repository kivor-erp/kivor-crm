import { LoginNecessario } from './auth';
import { BACKUPS_MANTIDOS, PASTA } from './config';
import { validarArquivo, type ArquivoCrm, type Remoto } from './lib/sincronia';

// Microsoft Graph, OneDrive da conta logada. Pasta normal (/SOF_CRM), não approot.
const DRIVE = 'https://graph.microsoft.com/v1.0/me/drive';
const ARQ = `${DRIVE}/root:/${PASTA}/crm.json`;

async function g(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (r.status === 401) throw new LoginNecessario();
  if (r.status === 403) throw new Error('Sem permissão no OneDrive (Files.ReadWrite). Verifique o consentimento no Entra.');
  return r;
}

async function falha(r: Response, o: string): Promise<never> {
  throw new Error(`OneDrive (${o}): ${r.status} ${(await r.text()).slice(0, 200)}`);
}

/** Cria a pasta se não existir (409 = já existe). */
async function garantirPasta(token: string, nome: string, pai: string) {
  const r = await g(token, `${DRIVE}/${pai}/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });
  if (!r.ok && r.status !== 409) await falha(r, `criar pasta ${nome}`);
}

function putJson(token: string, url: string, dados: unknown, eTag: string | null) {
  return g(token, eTag ? url : `${url}?@microsoft.graph.conflictBehavior=fail`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(eTag ? { 'If-Match': eTag } : {}) },
    body: JSON.stringify(dados),
  });
}

export function remotoOneDrive(token: string): Remoto {
  return {
    async baixar() {
      const r = await g(token, ARQ);
      if (r.status === 404) return { dados: null, eTag: null };
      if (!r.ok) await falha(r, 'ler crm.json');
      const meta = await r.json();
      // em app de navegador o /content responde 302 sem CORS; a doc manda usar o downloadUrl
      const c = await fetch(meta['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
      if (!c.ok) await falha(c, 'baixar crm.json');
      return { dados: validarArquivo(await c.json()), eTag: meta.eTag as string };
    },
    async enviar(dados, eTag) {
      if (!eTag) await garantirPasta(token, PASTA, 'root');
      const r = await putJson(token, `${ARQ}:/content`, dados, eTag);
      if (r.status === 412 || r.status === 409 || (eTag && r.status === 404)) return 'conflito';
      if (!r.ok) await falha(r, 'gravar crm.json');
      return 'ok';
    },
  };
}

const RE_BACKUP = /^crm_\d{4}-\d{2}-\d{2}\.json$/;

/** Snapshot do dia em /SOF_CRM/backup/crm_AAAA-MM-DD.json; mantém os últimos 30. */
export async function backupDoDia(token: string, dados: ArquivoCrm, dia: string): Promise<void> {
  const url = `${DRIVE}/root:/${PASTA}/backup/crm_${dia}.json`;
  const r = await g(token, url);
  if (r.ok) return; // outro aparelho já fez o de hoje
  if (r.status !== 404) await falha(r, 'verificar backup');
  await garantirPasta(token, 'backup', `root:/${PASTA}:`);
  const p = await putJson(token, `${url}:/content`, dados, null);
  if (!p.ok && p.status !== 409) await falha(p, 'gravar backup');

  const velhos = (await listarBackups(token)).slice(BACKUPS_MANTIDOS);
  for (const v of velhos) await g(token, `${DRIVE}/items/${v.id}`, { method: 'DELETE' }); // vai para a lixeira do OneDrive
}

export interface ItemBackup { id: string; name: string; dia: string; tamanho: number }

/** Backups diários, do mais novo para o mais antigo. */
export async function listarBackups(token: string): Promise<ItemBackup[]> {
  const l = await g(token, `${DRIVE}/root:/${PASTA}/backup:/children?$select=id,name,size&$top=999`);
  if (l.status === 404) return [];
  if (!l.ok) await falha(l, 'listar backups');
  return ((await l.json()).value as { id: string; name: string; size: number }[])
    .filter((x) => RE_BACKUP.test(x.name))
    .map((x) => ({ id: x.id, name: x.name, dia: x.name.slice(4, 14), tamanho: x.size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function baixarBackup(token: string, id: string): Promise<ArquivoCrm> {
  const r = await g(token, `${DRIVE}/items/${id}`);
  if (!r.ok) await falha(r, 'ler backup');
  const c = await fetch((await r.json())['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
  if (!c.ok) await falha(c, 'baixar backup');
  return validarArquivo(await c.json());
}

/** Cópia do estado atual antes de restaurar (nome fora do padrão diário: não entra na rotação de 30). */
export async function copiaAntesDeRestaurar(token: string, dados: ArquivoCrm): Promise<string> {
  const nome = `antes_de_restaurar_${dados.salvoEm.slice(0, 19).replace(/:/g, '-')}.json`;
  await garantirPasta(token, 'backup', `root:/${PASTA}:`);
  const p = await putJson(token, `${DRIVE}/root:/${PASTA}/backup/${nome}:/content`, dados, null);
  if (!p.ok) await falha(p, 'gravar cópia de segurança');
  return nome;
}
