// Datas sempre exibidas em dd/mm/aaaa no fuso America/Sao_Paulo.
export const TZ = 'America/Sao_Paulo';

const fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtPartes = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Dia (AAAA-MM-DD) em São Paulo para um instante. */
export function diaSP(d: Date | string): string {
  const data = typeof d === 'string' ? new Date(d) : d;
  return fmtYmd.format(data);
}

export function hojeSP(agora: Date = new Date()): string {
  return diaSP(agora);
}

function ymdParaUtc(ymd: string): number {
  const [a, m, d] = ymd.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

export function somarDias(ymd: string, n: number): string {
  return new Date(ymdParaUtc(ymd) + n * 86400000).toISOString().slice(0, 10);
}

/** Quantos dias de calendário de `de` até `ate` (positivo se `ate` é depois). */
export function diffDias(de: string, ate: string): number {
  return Math.round((ymdParaUtc(ate) - ymdParaUtc(de)) / 86400000);
}

/** Dias de calendário (em São Paulo) desde um instante ISO até agora. */
export function diasDesde(iso: string, agora: Date = new Date()): number {
  return diffDias(diaSP(iso), diaSP(agora));
}

export function textoHaDias(dias: number): string {
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

/** 'AAAA-MM-DD' ou ISO → 'dd/mm/aaaa'. */
export function fmtData(v: string | null | undefined): string {
  if (!v) return '';
  const ymd = RE_YMD.test(v) ? v : diaSP(v);
  const [a, m, d] = ymd.split('-');
  return `${d}/${m}/${a}`;
}

function partesSP(ms: number) {
  const p: Record<string, string> = {};
  for (const x of fmtPartes.formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}

export function fmtHora(iso: string): string {
  const p = partesSP(new Date(iso).getTime());
  return `${p.hour}:${p.minute}`;
}

export function fmtDataHora(iso: string): string {
  return `${fmtData(iso)} ${fmtHora(iso)}`;
}

/** ISO → valor para <input type="datetime-local"> no horário de São Paulo. */
export function isoParaInputLocal(iso: string): string {
  const p = partesSP(new Date(iso).getTime());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function offsetSP(ms: number): number {
  const p = partesSP(ms);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

/** Valor de <input type="datetime-local"> (hora de São Paulo) → ISO UTC. */
export function inputLocalParaIso(v: string): string {
  const [data, hora = '00:00'] = v.split('T');
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const parede = Date.UTC(a, m - 1, d, h, mi);
  let ms = parede - offsetSP(parede);
  ms = parede - offsetSP(ms); // reajuste caso o palpite tenha cruzado mudança de fuso
  return new Date(ms).toISOString();
}

export type Cor = 'verde' | 'amarelo' | 'vermelho' | 'cinza';

export function corUltimoContato(dias: number | null, limites: { limiteVerde: number; limiteAmarelo: number }): Cor {
  if (dias === null) return 'cinza';
  if (dias <= limites.limiteVerde) return 'verde';
  if (dias <= limites.limiteAmarelo) return 'amarelo';
  return 'vermelho';
}
