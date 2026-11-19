import { normalizar } from './texto';

// Taxonomia de produtos do módulo Compras: categorias, marcas e sinônimos técnicos.
// Montada a partir dos catálogos WEG/Ozean, das listas de preço WEG, da planilha de controle de
// materiais (Siemens, Schneider, IFM, Phoenix Contact) e das linhas de CFTV, redes e cabeamento.
// Serve à busca "item → fornecedores" (buscaFornecedor.ts) e à tag dos fornecedores.

export interface Categoria {
  id: string;
  nome: string;
  /** Palavras/expressões que, na pesquisa, indicam esta categoria (já com acento ou não; são normalizadas). */
  termos: string[];
  /** Marcas que costumam vender esta categoria. */
  marcas: string[];
}

export const CATEGORIAS: Categoria[] = [
  { id: 'motores', nome: 'Motores elétricos', termos: ['motor', 'motor eletrico', 'motor trifasico', 'motoredutor', 'motofreio', 'w22', 'w50'], marcas: ['WEG'] },
  { id: 'inversores-drives', nome: 'Inversores, soft-starters e servo', termos: ['inversor de frequencia', 'inversor', 'drive', 'soft starter', 'chave de partida suave', 'servo', 'servomotor', 'servoconversor', 'cfw', 'ssw', 'sinamics', 'conversor de frequencia', 'conversor ca cc'], marcas: ['WEG', 'Siemens', 'Schneider'] },
  { id: 'partida-motores', nome: 'Partida e proteção de motores', termos: ['contator', 'minicontator', 'rele termico', 'rele de sobrecarga', 'disjuntor motor', 'guardamotor', 'chave de partida', 'chave estrela triangulo', 'partida direta', 'simocode', 'sirius', 'rele temporizador', 'rele de impulso'], marcas: ['WEG', 'Siemens', 'Schneider'] },
  { id: 'comando-sinalizacao', nome: 'Comando e sinalização 22 mm', termos: ['botoeira', 'botao de comando', 'sinaleiro', 'sinalizador', 'botao de emergencia', 'cogumelo', 'chave seletora', 'torre de sinalizacao', 'bloco de contato', 'bloco luminoso', '22mm', 'harmony'], marcas: ['WEG', 'Schneider', 'Siemens'] },
  { id: 'protecao-circuitos', nome: 'Proteção de circuitos e distribuição', termos: ['disjuntor', 'minidisjuntor', 'disjuntor caixa moldada', 'dr', 'diferencial residual', 'dps', 'protetor de surto', 'seccionadora', 'fusivel', 'quadro de distribuicao', 'barramento', 'disjuntor aberto', 'bipolar', 'tripolar', 'tetrapolar', 'monopolar'], marcas: ['WEG', 'Steck', 'Siemens', 'Schneider'] },
  { id: 'clp-automacao', nome: 'CLP, I/O remoto, IHM e redes industriais', termos: ['clp', 'controlador programavel', 'ihm', 'modulo de entrada', 'modulo de saida', 'modulo digital', 'modulo analogico', 'profinet', 'profibus', 'et 200sp', 'simatic', 'modbus', 'rele inteligente', 'gateway', 'conector profinet', 'olm'], marcas: ['Siemens', 'Schneider', 'WEG', 'Phoenix Contact'] },
  { id: 'sensores', nome: 'Sensores e encoders', termos: ['sensor', 'sensor de proximidade', 'sensor indutivo', 'sensor de pressao', 'sensor fotoeletrico', 'encoder', 'transmissor', 'pressostato', 'fim de curso', 'chave de nivel'], marcas: ['IFM', 'Siemens', 'WEG', 'Leine Linde'] },
  { id: 'fontes-conexoes', nome: 'Fontes, bornes e conexões', termos: ['fonte', 'fonte chaveada', 'borne', 'terminal de conexao', 'conector', 'identificador', 'push in', 'terminal olhal', 'barra de conexao', 'porta fusivel', 'quint'], marcas: ['Phoenix Contact', 'WEG', 'Siemens'] },
  { id: 'seguranca-maquinas', nome: 'Segurança de máquinas (NR12)', termos: ['nr12', 'cortina de luz', 'rele de seguranca', 'chave de seguranca', 'chave de intertravamento', 'comando bimanual', 'calcao', 'pedal de seguranca', 'clp de seguranca', 'sensor magnetico de seguranca', 'chave de emergencia por cabo'], marcas: ['WEG', 'Siemens', 'Schneider'] },
  { id: 'energia-qualidade', nome: 'Energia, capacitores, nobreaks e solar', termos: ['nobreak', 'estabilizador', 'capacitor', 'banco de capacitores', 'fator de potencia', 'fotovoltaico', 'inversor solar', 'modulo fotovoltaico', 'painel solar', 'transformador', 'retificador', 'gerador'], marcas: ['WEG', 'Intelbras'] },
  { id: 'tomadas-plugues', nome: 'Plugues, tomadas e interruptores', termos: ['tomada', 'plugue', 'plug', 'tomada industrial', 'plugue industrial', 'interruptor', 'tomada 3p t', 'prolongador', 'acessorio de instalacao'], marcas: ['Steck', 'WEG'] },
  { id: 'cftv', nome: 'CFTV e videomonitoramento', termos: ['cftv', 'camera', 'camera ip', 'bullet', 'dome', 'ptz', 'nvr', 'dvr', 'gravador de video', 'hd', 'monitor de video', 'camera termica', 'camera wifi', 'fonte para camera', 'balun', 'videomonitoramento', 'analitico de video'], marcas: ['Intelbras', 'Hikvision'] },
  { id: 'controle-acesso-alarmes', nome: 'Controle de acesso, alarmes e portaria', termos: ['controle de acesso', 'leitor de cartao', 'biometria', 'catraca', 'fechadura eletronica', 'fechadura', 'alarme', 'central de alarme', 'sensor de presenca', 'sensor de abertura', 'cerca eletrica', 'interfone', 'video porteiro', 'portao automatico', 'motor de portao', 'sirene', 'ponto eletronico'], marcas: ['Intelbras', 'Hikvision'] },
  { id: 'redes-telecom', nome: 'Redes, wi-fi e telefonia', termos: ['switch', 'switch poe', 'roteador', 'access point', 'ponto de acesso', 'wifi', 'wi fi', 'radio enlace', 'antena', 'telefone ip', 'pabx', 'central telefonica', 'onu', 'olt', 'modem'], marcas: ['Intelbras', 'Hikvision', 'Siemens'] },
  { id: 'cabeamento-estruturado', nome: 'Cabeamento estruturado e fibra óptica', termos: ['cabo de rede', 'cabo utp', 'utp', 'cat5e', 'cat6', 'cat6a', 'cabeamento estruturado', 'fibra optica', 'cabo optico', 'patch cord', 'patch panel', 'rj45', 'keystone', 'dio', 'rack', 'cordao optico', 'conector de fibra', 'extensao optica', 'caixa de emenda'], marcas: ['Furukawa', 'Intelbras'] },
  { id: 'infraestrutura-eletrica', nome: 'Eletrocalhas, eletrodutos e cabos elétricos', termos: ['eletrocalha', 'calha', 'leito para cabos', 'perfilado', 'eletroduto', 'conduite', 'curva', 'tampa de eletrocalha', 'suporte', 'cabo flexivel', 'cabo de potencia', 'fio', 'condutor', 'cabo pp', 'cabo de cobre', 'abracadeira', 'terminal de compressao', 'conector de aterramento', 'haste de aterramento', 'canaleta'], marcas: ['Steck'] },
];

export interface Marca { nome: string; aliases: string[] }

export const MARCAS: Marca[] = [
  { nome: 'WEG', aliases: ['weg'] },
  { nome: 'Intelbras', aliases: ['intelbras'] },
  { nome: 'Hikvision', aliases: ['hikvision', 'hik'] },
  { nome: 'Steck', aliases: ['steck'] },
  { nome: 'Siemens', aliases: ['siemens'] },
  { nome: 'Schneider', aliases: ['schneider', 'schneider electric'] },
  { nome: 'Phoenix Contact', aliases: ['phoenix contact', 'phoenix'] },
  { nome: 'IFM', aliases: ['ifm'] },
  { nome: 'Leine Linde', aliases: ['leine linde', 'leine', 'linde'] },
  { nome: 'Furukawa', aliases: ['furukawa'] },
  { nome: 'Hikvision', aliases: ['hilook'] },
];

/** Grupos de termos equivalentes (cada grupo: todos significam a mesma coisa na compra). */
export const SINONIMOS: string[][] = [
  ['disjuntor', 'mcb', 'mini disjuntor', 'minidisjuntor', 'dj'],
  ['disjuntor motor', 'guardamotor', 'guarda motor', 'mpw'],
  ['disjuntor caixa moldada', 'dcm', 'disjuntor tripolar caixa moldada'],
  ['contator', 'contatora', 'minicontator'],
  ['rele termico', 'rele de sobrecarga', 'rele sobrecarga'],
  ['inversor de frequencia', 'inversor', 'drive', 'vfd', 'conversor de frequencia'],
  ['soft starter', 'soft-starter', 'chave de partida suave', 'partida suave'],
  ['servo', 'servomotor', 'servoconversor', 'servoacionamento'],
  ['clp', 'plc', 'controlador programavel', 'controlador logico programavel'],
  ['ihm', 'hmi', 'interface homem maquina', 'painel de operacao'],
  ['camera ip', 'camera de rede', 'ip camera'],
  ['camera', 'cftv', 'videomonitoramento'],
  ['nvr', 'gravador de video em rede', 'gravador de video'],
  ['dvr', 'gravador digital', 'gravador de video'],
  ['hd', 'hdd', 'disco rigido'],
  ['cabo de rede', 'cabo utp', 'utp', 'cabo lan', 'cabo ethernet', 'cabeamento estruturado'],
  ['cat6', 'categoria 6'],
  ['cat5e', 'categoria 5e'],
  ['cat6a', 'categoria 6a'],
  ['fibra optica', 'fibra', 'cabo optico'],
  ['patch cord', 'cordao de rede', 'patch cable'],
  ['patch panel', 'painel de conexao'],
  ['rack', 'gabinete de rede'],
  ['rj45', 'conector rj45', 'plug rj45', 'keystone'],
  ['eletrocalha', 'calha metalica', 'leito para cabos'],
  ['eletroduto', 'conduite', 'tubo conduite'],
  ['fonte', 'fonte chaveada', 'fonte de alimentacao', 'fonte 24v'],
  ['borne', 'terminal de conexao', 'bloco terminal'],
  ['botoeira', 'botao de comando', 'botao 22mm', 'pushbutton'],
  ['sinaleiro', 'sinalizador', 'lampada de sinalizacao'],
  ['botao de emergencia', 'cogumelo', 'parada de emergencia'],
  ['seccionadora', 'chave seccionadora', 'interruptor seccionador'],
  ['fusivel', 'fusivel nh', 'nh'],
  ['dr', 'idr', 'diferencial residual', 'interruptor diferencial'],
  ['dps', 'protetor de surto', 'supressor de surto'],
  ['quadro de distribuicao', 'qd', 'qdc', 'quadro eletrico', 'caixa de distribuicao'],
  ['tomada industrial', 'plugue industrial', 'plug industrial'],
  ['nobreak', 'no break', 'ups'],
  ['sensor indutivo', 'sensor de proximidade'],
  ['encoder', 'codificador'],
  ['controle de acesso', 'leitor de cartao', 'biometria', 'catraca'],
  ['alarme', 'central de alarme'],
  ['switch', 'comutador', 'switch poe'],
  ['access point', 'ponto de acesso'],
  ['rele de seguranca', 'rele safety', 'rele nr12'],
  ['cortina de luz', 'light curtain'],
  ['fotovoltaico', 'energia solar', 'placa solar', 'modulo fotovoltaico', 'painel solar'],
  ['motor', 'motor eletrico', 'motor trifasico'],
  ['capacitor', 'banco de capacitores', 'correcao do fator de potencia'],
  ['cabo flexivel', 'cabo de potencia', 'cabo de cobre'],
];

// ---------- texto → termos comparáveis ----------

const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'em', 'e', 'a', 'o', 'as', 'os', 'ou', 'um', 'uma', 'por', 'no', 'na', 'un', 'pc', 'pca', 'kit', 'tipo']);

/** Normaliza medidas e categorias coladas: "cat 6" → "cat6", "32 A" → "32a", "22 mm" → "22mm". */
export function prepararTexto(s: unknown): string {
  return normalizar(s)
    .replace(/[-_/]+/g, ' ')
    .replace(/\bcat(?:egoria)?\s*(5e|6a|6|5|7)\b/g, 'cat$1')
    .replace(/(\d+(?:[.,]\d+)?)\s*(a|amp|mm|kv|kw|cv|hp|vcc|vca|vdc|vac|v|hz)\b/g, '$1$2')
    .replace(/[^a-z0-9., ]+/g, ' ')
    .replace(/(?<![0-9]),|,(?![0-9])|\.(?![0-9])/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Singular aproximado (disjuntores→disjuntor, botoeiras→botoeira, conexões→conexao). */
export function radical(p: string): string {
  if (p.length <= 3 || /\d/.test(p)) return p;
  if (p.endsWith('oes')) return `${p.slice(0, -3)}ao`;
  if (p.length > 4 && /([rzl]|ch|sh|x)es$/.test(p)) return p.slice(0, -2);
  if (p.endsWith('s') && !p.endsWith('ss')) return p.slice(0, -1);
  return p;
}

/** Palavras úteis (radicais) de um texto, sem preposições. */
export function termosDe(s: unknown): string[] {
  return prepararTexto(s).split(' ').filter((p) => p && !PARADAS.has(p)).map(radical);
}

function frase(s: string): string {
  return termosDe(s).join(' ');
}

/** O texto (já em radicais, separado por espaço) contém a expressão como palavras inteiras seguidas. */
export function contem(textoRadicais: string, expressao: string): boolean {
  return expressao !== '' && ` ${textoRadicais} `.includes(` ${frase(expressao)} `);
}

// ---------- análise da pesquisa ----------

export interface AnaliseConsulta {
  /** Palavras da pesquisa (radicais), sem preposições. */
  termos: string[];
  /** Expressões equivalentes acrescentadas pelos sinônimos. */
  sinonimos: string[];
  categorias: { id: string; nome: string; pontos: number }[];
  marcas: string[];
  /** Especificações reconhecidas: "32a", "tripolar", "cat6", "22mm", "24vcc"… */
  atributos: string[];
}

const ATRIBUTO = /^(\d+(?:[.,]\d+)?(?:a|mm|kv|kw|cv|hp|vcc|vca|vdc|vac|v|hz)|cat(?:5e|6a|6|5|7)|monopolar|bipolar|tripolar|tetrapolar|ip\d{2}|\d+p)$/;

export function analisarConsulta(consulta: string): AnaliseConsulta {
  const termos = termosDe(consulta);
  const texto = termos.join(' ');
  const sinonimos = new Set<string>();
  for (const grupo of SINONIMOS) {
    if (grupo.some((g) => contem(texto, g))) for (const g of grupo) sinonimos.add(frase(g));
  }
  const ampliado = `${texto} ${[...sinonimos].join(' ')}`;
  const categorias = CATEGORIAS
    .map((c) => ({ id: c.id, nome: c.nome, pontos: c.termos.filter((t) => contem(ampliado, t)).length }))
    .filter((c) => c.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);
  const marcas = [...new Set(MARCAS.filter((m) => m.aliases.some((a) => contem(texto, a))).map((m) => m.nome))];
  const atributos = termos.filter((t) => ATRIBUTO.test(t));
  return { termos, sinonimos: [...sinonimos], categorias, marcas, atributos };
}

export const nomeCategoria = (id: string): string => CATEGORIAS.find((c) => c.id === id)?.nome ?? id;

/** Nomes de marca do cadastro ("WEG; Siemens, Intelbras") normalizados para a lista oficial. */
export function marcasDoTexto(s: string): string[] {
  const t = termosDe(s).join(' ');
  return MARCAS.filter((m) => m.aliases.some((a) => contem(t, a))).map((m) => m.nome).filter((n, i, v) => v.indexOf(n) === i);
}

