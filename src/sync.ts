import { useEffect, useState } from 'preact/hooks';
import { LoginNecessario, token } from './auth';
import { db } from './db';
import { fmtHora, hojeSP } from './lib/datas';
import { agoraIso } from './lib/model';
import { contarPendentes, sincronizarCom } from './lib/sincronia';
import { backupDoDia, remotoOneDrive } from './onedrive';

// Quando sincronizar: ao abrir, ~3 s após cada alteração, a cada 60 s,
// ao voltar a ficar online e ao voltar para o app.

export interface EstadoSync {
  tipo: 'inicio' | 'sincronizando' | 'salvo' | 'offline' | 'erro' | 'login';
  pendentes: number;
  em?: string; // última gravação bem-sucedida
  msg?: string;
}

let estado: EstadoSync = { tipo: 'inicio', pendentes: 0 };
const ouvintes = new Set<(e: EstadoSync) => void>();

function setEstado(e: Partial<EstadoSync>) {
  estado = { ...estado, ...e };
  if (e.tipo && e.tipo !== 'erro') estado.msg = e.msg;
  ouvintes.forEach((f) => f(estado));
}

export function useSync(): EstadoSync {
  const [e, setE] = useState(estado);
  useEffect(() => { ouvintes.add(setE); setE(estado); return () => void ouvintes.delete(setE); }, []);
  return e;
}

export function textoEstado(e: EstadoSync): string {
  switch (e.tipo) {
    case 'inicio': return '';
    case 'sincronizando': return 'Sincronizando…';
    case 'salvo': return e.pendentes ? `${e.pendentes} alterações a enviar` : `Salvo no OneDrive às ${fmtHora(e.em!)}`;
    case 'offline': return e.pendentes ? `Offline: ${e.pendentes} alterações pendentes` : 'Offline: tudo salvo';
    case 'erro': return 'Erro: toque para tentar de novo';
    case 'login': return 'Sessão expirada: toque para entrar';
  }
}

async function backupSeNecessario(t: string, dados: Parameters<typeof backupDoDia>[1]) {
  const dia = hojeSP();
  if ((await db.meta.get('ultimoBackup'))?.valor === dia) return;
  try {
    await backupDoDia(t, dados, dia);
    await db.meta.put({ chave: 'ultimoBackup', valor: dia });
  } catch (e) {
    if (e instanceof LoginNecessario) throw e;
    console.warn('Backup diário falhou; tenta de novo na próxima sincronização.', e); // não bloqueia o salvamento
  }
}

async function umaVez() {
  const pendentes = await contarPendentes();
  if (!navigator.onLine) return setEstado({ tipo: 'offline', pendentes });
  setEstado({ tipo: 'sincronizando', pendentes });
  try {
    const t = await token();
    const dados = await sincronizarCom(remotoOneDrive(t));
    await backupSeNecessario(t, dados);
    setEstado({ tipo: 'salvo', em: agoraIso(), pendentes: await contarPendentes() });
  } catch (e) {
    const pendentes = await contarPendentes();
    if (e instanceof LoginNecessario) setEstado({ tipo: 'login', pendentes });
    else if (!navigator.onLine || e instanceof TypeError) setEstado({ tipo: 'offline', pendentes }); // fetch sem rede
    else { console.error(e); setEstado({ tipo: 'erro', pendentes, msg: (e as Error).message }); }
  }
}

let rodando: Promise<void> | null = null;
let deNovo = false;

/** Sincroniza agora. Se já estiver rodando, roda mais uma vez ao terminar. */
export function sincronizar(): Promise<void> {
  if (rodando) { deNovo = true; return rodando; }
  rodando = (async () => {
    do { deNovo = false; await umaVez(); } while (deNovo && estado.tipo === 'salvo');
  })().finally(() => { rodando = null; });
  return rodando;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let iniciado = false;

export function iniciarSync(): void {
  if (iniciado) return;
  iniciado = true;
  addEventListener('crm-alterado', async () => {
    setEstado({ pendentes: await contarPendentes() });
    clearTimeout(timer);
    timer = setTimeout(sincronizar, 3000);
  });
  addEventListener('online', () => void sincronizar());
  addEventListener('offline', async () => setEstado({ tipo: 'offline', pendentes: await contarPendentes() }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void sincronizar(); });
  setInterval(() => { if (document.visibilityState === 'visible') void sincronizar(); }, 60_000);
  void sincronizar();
}
