// Avaliador de fórmulas das calculadoras. Seguro: não usa eval nem Function; só números, textos, lógicos,
// operadores aritméticos/lógicos, variáveis e funções registradas. Número decimal com PONTO (4.5); vírgula separa argumentos.

export type Valor = number | string | boolean | null;
export type Funcoes = Record<string, (...args: Valor[]) => Valor>;

type No =
  | { t: 'lit'; v: Valor }
  | { t: 'id'; nome: string }
  | { t: 'un'; op: '-' | '!'; a: No }
  | { t: 'bin'; op: string; a: No; b: No }
  | { t: 'call'; nome: string; args: No[] };

export interface Compilada { ast: No; ids: string[]; chamadas: string[] }

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ_0-9]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(&&|\|\||==|!=|<=|>=|[-+*/%^()<>!,]))/y;

interface Tok { k: 'num' | 'id' | 'str' | 'op' | 'fim'; v: string }

function tokenizar(src: string): Tok[] {
  const t: Tok[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Caractere inesperado em "${src.slice(pos).trim().slice(0, 12)}"`);
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) t.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) t.push({ k: 'id', v: m[2] });
    else if (m[3] !== undefined) t.push({ k: 'str', v: m[3].slice(1, -1).replace(/\\(.)/g, '$1') });
    else t.push({ k: 'op', v: m[4] });
  }
  t.push({ k: 'fim', v: '' });
  return t;
}

class Parser {
  private i = 0;
  readonly ids = new Set<string>();
  readonly chamadas = new Set<string>();
  constructor(private t: Tok[]) {}
  private p() { return this.t[this.i]; }
  private op(...v: string[]) { const x = this.p(); return x.k === 'op' && v.includes(x.v) ? this.t[this.i++].v : null; }
  analisar(): No {
    const n = this.ou();
    if (this.p().k !== 'fim') throw new Error(`Sobrou "${this.p().v}" no fim da fórmula`);
    return n;
  }
  private ou(): No {
    let a = this.e();
    while (this.op('||')) a = { t: 'bin', op: '||', a, b: this.e() };
    return a;
  }
  private e(): No {
    let a = this.cmp();
    while (this.op('&&')) a = { t: 'bin', op: '&&', a, b: this.cmp() };
    return a;
  }
  private cmp(): No {
    const a = this.soma();
    const o = this.op('==', '!=', '<=', '>=', '<', '>');
    return o ? { t: 'bin', op: o, a, b: this.soma() } : a;
  }
  private soma(): No {
    let a = this.mult();
    for (let o = this.op('+', '-'); o; o = this.op('+', '-')) a = { t: 'bin', op: o, a, b: this.mult() };
    return a;
  }
  private mult(): No {
    let a = this.unario();
    for (let o = this.op('*', '/', '%'); o; o = this.op('*', '/', '%')) a = { t: 'bin', op: o, a, b: this.unario() };
    return a;
  }
  private unario(): No {
    const o = this.op('-', '!');
    if (o) return { t: 'un', op: o as '-' | '!', a: this.unario() };
    return this.pot();
  }
  private pot(): No {
    const a = this.primario();
    return this.op('^') ? { t: 'bin', op: '^', a, b: this.unario() } : a;
  }
  private primario(): No {
    const x = this.p();
    if (x.k === 'num') { this.i++; return { t: 'lit', v: Number(x.v) }; }
    if (x.k === 'str') { this.i++; return { t: 'lit', v: x.v }; }
    if (x.k === 'id') {
      this.i++;
      if (this.op('(')) {
        const args: No[] = [];
        if (!this.op(')')) {
          do args.push(this.ou()); while (this.op(','));
          if (!this.op(')')) throw new Error(`Faltou ")" na chamada de ${x.v}`);
        }
        this.chamadas.add(x.v);
        return { t: 'call', nome: x.v, args };
      }
      if (Object.hasOwn(CONSTANTES, x.v.toLowerCase())) return { t: 'lit', v: CONSTANTES[x.v.toLowerCase()] };
      this.ids.add(x.v);
      return { t: 'id', nome: x.v };
    }
    if (this.op('(')) {
      const n = this.ou();
      if (!this.op(')')) throw new Error('Faltou ")"');
      return n;
    }
    throw new Error(x.k === 'fim' ? 'A fórmula terminou antes da hora' : `Não esperava "${x.v}"`);
  }
}

const CONSTANTES: Record<string, Valor> = { verdadeiro: true, true: true, falso: false, false: false, nulo: null };

const cache = new Map<string, Compilada>();

export function compilar(src: string): Compilada {
  const c = cache.get(src);
  if (c) return c;
  const p = new Parser(tokenizar(src));
  const ast = p.analisar();
  const r = { ast, ids: [...p.ids], chamadas: [...p.chamadas] };
  if (cache.size > 2000) cache.clear();
  cache.set(src, r);
  return r;
}

/** Mensagem de erro de sintaxe, ou null se a fórmula é válida. */
export function erroDeSintaxe(src: string): string | null {
  try { compilar(src); return null; } catch (e) { return (e as Error).message; }
}

// ---------- avaliação ----------

export function num(v: Valor): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`"${v}" não é um número`);
  return n;
}
export function verdade(v: Valor): boolean {
  if (typeof v === 'string') return v !== '' && v.toLowerCase() !== 'nao' && v !== 'false';
  return !!v;
}
const texto = (v: Valor): string => (v === null ? '' : typeof v === 'number' ? String(Math.round(v * 1e9) / 1e9) : String(v));

/** Funções sempre disponíveis. `se` é tratada à parte (avalia só o ramo escolhido). */
export const FUNCOES_BASE: Funcoes = {
  max: (...a) => Math.max(...a.map(num)),
  min: (...a) => Math.min(...a.map(num)),
  abs: (x) => Math.abs(num(x)),
  soma: (...a) => a.reduce<number>((s, x) => s + num(x), 0),
  teto: (x) => Math.ceil(num(x) - 1e-9),
  piso: (x) => Math.floor(num(x) + 1e-9),
  arred: (x, c = 0) => { const f = 10 ** num(c); return Math.round((num(x) + Number.EPSILON) * f) / f; },
  vazio: (x) => x === null || x === '' || x === undefined,
  /** Menor valor da lista que comporta n (ex.: canais do gravador). Acima do maior, arredonda para múltiplo do maior. */
  proximoDe: (n, ...lista) => {
    const l = lista.map(num).sort((a, b) => a - b);
    const x = num(n);
    if (!l.length) throw new Error('proximoDe precisa de uma lista');
    const achou = l.find((v) => v >= x - 1e-9);
    return achou ?? Math.ceil(x / l[l.length - 1]) * l[l.length - 1];
  },
};

function bin(op: string, a: Valor, b: Valor): Valor {
  switch (op) {
    case '+': return typeof a === 'string' || typeof b === 'string' ? texto(a) + texto(b) : num(a) + num(b);
    case '-': return num(a) - num(b);
    case '*': return num(a) * num(b);
    case '/': { const d = num(b); if (d === 0) throw new Error('Divisão por zero'); return num(a) / d; }
    case '%': { const d = num(b); if (d === 0) throw new Error('Divisão por zero'); return num(a) % d; }
    case '^': return num(a) ** num(b);
    case '==': return a === b || texto(a) === texto(b);
    case '!=': return !(a === b || texto(a) === texto(b));
    case '<': return num(a) < num(b);
    case '<=': return num(a) <= num(b);
    case '>': return num(a) > num(b);
    case '>=': return num(a) >= num(b);
  }
  throw new Error(`Operador desconhecido ${op}`);
}

function ev(n: No, vars: Record<string, Valor>, fn: Funcoes): Valor {
  switch (n.t) {
    case 'lit': return n.v;
    case 'id':
      if (!Object.hasOwn(vars, n.nome)) throw new Error(`Variável "${n.nome}" não existe`);
      return vars[n.nome];
    case 'un': { const a = ev(n.a, vars, fn); return n.op === '-' ? -num(a) : !verdade(a); }
    case 'bin':
      if (n.op === '&&') return verdade(ev(n.a, vars, fn)) && verdade(ev(n.b, vars, fn));
      if (n.op === '||') return verdade(ev(n.a, vars, fn)) || verdade(ev(n.b, vars, fn));
      return bin(n.op, ev(n.a, vars, fn), ev(n.b, vars, fn));
    case 'call': {
      if (n.nome === 'se') {
        if (n.args.length !== 3) throw new Error('se(condição, então, senão) leva 3 argumentos');
        return verdade(ev(n.args[0], vars, fn)) ? ev(n.args[1], vars, fn) : ev(n.args[2], vars, fn);
      }
      const f = Object.hasOwn(fn, n.nome) ? fn[n.nome] : Object.hasOwn(FUNCOES_BASE, n.nome) ? FUNCOES_BASE[n.nome] : undefined;
      if (!f) throw new Error(`Função "${n.nome}" não existe`);
      return f(...n.args.map((a) => ev(a, vars, fn)));
    }
  }
}

export function avaliar(src: string, vars: Record<string, Valor>, fn: Funcoes = {}): Valor {
  return ev(compilar(src).ast, vars, fn);
}

/** Interpola {variavel} em textos (pendências, premissas). Variável ausente fica como está. */
export function interpolar(txt: string, vars: Record<string, Valor>): string {
  return txt.replace(/\{([A-Za-z_][A-Za-z_0-9]*)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? texto(vars[k]) : m));
}
