import type { DefinicaoCalculadora, EntradaDef, LinhaDef, OpcaoDef } from './tipos';

// Calculadora de CFTV, escrita só como definição declarativa (entradas, escopo, variáveis e blocos de custo).
// Nenhum preço, hora ou limite fica aqui: tudo sai das tabelas de parâmetros (Orçamentos › Parâmetros).
// Para criar outra calculadora (elétrica, fibra por ponto, painéis) basta outra definição como esta.

const op = (...v: string[]): OpcaoDef[] => v.map((x) => ({ valor: x, rotulo: x }));
const ops = (p: [string, string][]): OpcaoDef[] => p.map(([valor, rotulo]) => ({ valor, rotulo }));
const E = (e: EntradaDef): EntradaDef => e;

const entradas: EntradaDef[] = [
  // ---- local
  E({ id: 'municipio', rotulo: 'Município da obra', tipo: 'selecao', grupo: 'Local', obrigatoria: true, opcoesParam: { grupo: 'deslocamento_local', outro: 'Outro (informar km e tempo)' } }),
  E({ id: 'uf_manual', rotulo: 'UF da obra', tipo: 'texto', grupo: 'Local', visivelSe: "municipio == 'outro'", obrigatoria: true }),
  E({ id: 'km_manual', rotulo: 'Distância de ida e volta', tipo: 'numero', unidade: 'km', grupo: 'Local', visivelSe: "municipio == 'outro'", obrigatoria: true }),
  E({ id: 'min_manual', rotulo: 'Tempo de ida e volta', tipo: 'numero', unidade: 'min', grupo: 'Local', visivelSe: "municipio == 'outro'", obrigatoria: true }),
  E({ id: 'pedagio_manual', rotulo: 'Pedágio (ida e volta)', tipo: 'numero', unidade: 'R$', grupo: 'Local', visivelSe: "municipio == 'outro'", padrao: 0 }),
  E({ id: 'fora_es', rotulo: 'Obra fora do ES', tipo: 'simnao', grupo: 'Local', ajuda: 'Liga diárias, hospedagem, alimentação e viagem. Calculado pelo município; pode ser mudado.',
    padraoFormula: "(municipio == 'outro' && uf_manual != 'ES') || (municipio != 'outro' && !vazio(municipio) && loc(municipio, 'uf') != 'ES')" }),

  // ---- câmeras
  E({ id: 'qtd_cameras', rotulo: 'Quantidade de câmeras', tipo: 'inteiro', grupo: 'Câmeras', obrigatoria: true, padraoFormula: 'se(pontos_total > 0, pontos_total, nulo)', ajuda: 'Vem dos pontos do orçamento quando já foram lançados.' }),
  E({ id: 'tipo_camera', rotulo: 'Tipo', tipo: 'selecao', grupo: 'Câmeras', obrigatoria: true, opcoes: ops([['ip', 'IP'], ['analogica', 'Analógica (HD)']]) }),
  E({ id: 'formato', rotulo: 'Formato', tipo: 'selecao', grupo: 'Câmeras', obrigatoria: true, opcoes: ops([['dome', 'Dome'], ['bullet', 'Bullet'], ['fisheye', 'Fisheye']]) }),
  E({ id: 'resolucao', rotulo: 'Resolução', tipo: 'selecao', grupo: 'Câmeras', obrigatoria: true, opcoes: ops([['2mp', '2 MP'], ['4mp', '4 MP'], ['8mp', '8 MP (4K)']]) }),
  E({ id: 'audio_qtd', rotulo: 'Câmeras com áudio', tipo: 'inteiro', grupo: 'Câmeras', padraoFormula: 'pontos_audio', ajuda: 'Política de áudio e privacidade (LGPD) é do cliente.' }),
  E({ id: 'audio_tipo', rotulo: 'Áudio', tipo: 'selecao', grupo: 'Câmeras', visivelSe: 'audio_qtd > 0', obrigatoria: true, opcoes: ops([['embutido', 'Microfone embutido'], ['externo', 'Microfone externo']]) }),
  E({ id: 'ambiente', rotulo: 'Ambiente', tipo: 'selecao', grupo: 'Câmeras', escopo: ['instalacao_cameras'], obrigatoria: true, opcoes: ops([['interno', 'Interno'], ['externo', 'Externo']]) }),
  E({ id: 'fixacao', rotulo: 'Fixação', tipo: 'selecao', grupo: 'Câmeras', escopo: ['instalacao_cameras'], obrigatoria: true, opcoes: ops([['laje', 'Laje'], ['forro_gesso', 'Forro de gesso'], ['drywall', 'Drywall']]) }),
  E({ id: 'pe_direito', rotulo: 'Pé-direito', tipo: 'numero', unidade: 'm', grupo: 'Câmeras', escopo: ['instalacao_cameras'], obrigatoria: true, ajuda: 'Acima do limite cadastrado entram plataforma/andaime e NR-35.' }),

  // ---- cabo e rede
  E({ id: 'infra', rotulo: 'Infraestrutura', tipo: 'selecao', grupo: 'Cabo e rede', escopo: ['infra'], obrigatoria: true, opcoes: ops([['nova', 'Nova (eletroduto/canaleta a instalar)'], ['existente', 'Existente (só passar cabo)'], ['desconhecida', 'Desconhecida (contingência maior)']]) }),
  E({ id: 'metragem_ponto', rotulo: 'Metragem média por ponto', tipo: 'numero', unidade: 'm', grupo: 'Cabo e rede', escopo: ['infra'], obrigatoria: true }),
  E({ id: 'passagem', rotulo: 'Tipo de passagem', tipo: 'selecao', grupo: 'Cabo e rede', escopo: ['infra'], visivelSe: "infra != 'existente'", obrigatoria: true,
    opcoes: ops([['eletroduto_aparente', 'Eletroduto aparente'], ['canaleta', 'Canaleta'], ['subterraneo', 'Subterrâneo'], ['forro', 'Por forro']]) }),
  E({ id: 'cabo_cat', rotulo: 'Categoria do cabo', tipo: 'selecao', grupo: 'Cabo e rede', escopo: ['infra'], padrao: 'cat6', opcoes: ops([['cat5e', 'Cat5e'], ['cat6', 'Cat6']]) }),
  E({ id: 'patch_panel', rotulo: 'Patch panel', tipo: 'simnao', grupo: 'Cabo e rede', escopo: ['infra'] }),
  E({ id: 'rack', rotulo: 'Rack', tipo: 'simnao', grupo: 'Cabo e rede', escopo: ['infra'] }),
  E({ id: 'etiquetagem', rotulo: 'Etiquetagem dos pontos', tipo: 'simnao', grupo: 'Cabo e rede', escopo: ['infra'] }),
  E({ id: 'certificacao', rotulo: 'Certificação dos pontos', tipo: 'simnao', grupo: 'Cabo e rede', escopo: ['infra'] }),
  E({ id: 'portas_switch', rotulo: 'Portas do switch PoE', tipo: 'selecao', grupo: 'Cabo e rede', escopo: ['fornecimento'], visivelSe: "tipo_camera == 'ip'", padrao: '16', opcoes: op('8', '16', '24') }),
  E({ id: 'poe_w_switch', rotulo: 'Potência PoE total de cada switch', tipo: 'numero', unidade: 'W', grupo: 'Cabo e rede', escopo: ['fornecimento'], visivelSe: "tipo_camera == 'ip'", padrao: 130, ajuda: 'Do datasheet do switch. Define quantos switches são necessários.' }),
  E({ id: 'watts_camera', rotulo: 'Consumo PoE por câmera', tipo: 'numero', unidade: 'W', grupo: 'Cabo e rede', escopo: ['fornecimento'], visivelSe: "tipo_camera == 'ip'", padraoFormula: "tec('poe_w_camera')" }),

  // ---- gravação
  E({ id: 'dias_gravacao', rotulo: 'Dias de gravação', tipo: 'inteiro', grupo: 'Gravação', escopo: ['fornecimento'], obrigatoria: true }),
  E({ id: 'modo_gravacao', rotulo: 'Gravação', tipo: 'selecao', grupo: 'Gravação', escopo: ['fornecimento'], padrao: 'continua', opcoes: ops([['continua', 'Contínua'], ['movimento', 'Por movimento']]) }),
  E({ id: 'codec', rotulo: 'Codec', tipo: 'selecao', grupo: 'Gravação', escopo: ['fornecimento'], padrao: 'h265', opcoes: ops([['h264', 'H.264'], ['h265', 'H.265']]) }),
  E({ id: 'raid', rotulo: 'RAID', tipo: 'selecao', grupo: 'Gravação', escopo: ['fornecimento'], padrao: 'nenhum', opcoes: ops([['nenhum', 'Sem RAID'], ['raid1', 'RAID 1'], ['raid5', 'RAID 5']]) }),
  E({ id: 'nobreak', rotulo: 'Nobreak', tipo: 'simnao', grupo: 'Gravação', escopo: ['fornecimento'] }),

  // ---- execução
  E({ id: 'horario', rotulo: 'Horário de execução', tipo: 'selecao', grupo: 'Execução', padrao: 'comercial', opcoes: ops([['comercial', 'Comercial'], ['noturno', 'Noturno'], ['fim_semana', 'Fim de semana']]) }),
  E({ id: 'restricao_areas', rotulo: 'Restrições de áreas (acesso limitado)', tipo: 'simnao', grupo: 'Execução' }),
  E({ id: 'integracao_h', rotulo: 'Integração de segurança / permissão de trabalho', tipo: 'numero', unidade: 'h por pessoa', grupo: 'Execução', padrao: 0 }),
  E({ id: 'nr35', rotulo: 'NR-35 (trabalho em altura)', tipo: 'simnao', grupo: 'Execução', escopo: ['instalacao_cameras'], padraoFormula: "pe_direito > tec('pe_direito_max')" }),
  E({ id: 'nr10', rotulo: 'NR-10 (eletricidade)', tipo: 'simnao', grupo: 'Execução' }),
  E({ id: 'equipe', rotulo: 'Pessoas na equipe', tipo: 'inteiro', grupo: 'Execução', padrao: 2 }),
  E({ id: 'visitas_tecnicas', rotulo: 'Visitas técnicas', tipo: 'inteiro', grupo: 'Execução', padrao: 1 }),
  E({ id: 'dias_equipe_manual', rotulo: 'Dias de equipe em campo', tipo: 'inteiro', grupo: 'Execução', ajuda: 'Vazio = calculado pelas horas e pelo tamanho da equipe.' }),
  E({ id: 'garantia_meses', rotulo: 'Garantia', tipo: 'inteiro', unidade: 'meses', grupo: 'Execução', padrao: 12 }),
  E({ id: 'manut_visitas_mes', rotulo: 'Visitas de manutenção por mês', tipo: 'inteiro', grupo: 'Contrato de manutenção', escopo: ['manutencao'], padrao: 1 }),
  E({ id: 'manut_horas_visita', rotulo: 'Horas por visita', tipo: 'numero', unidade: 'h', grupo: 'Contrato de manutenção', escopo: ['manutencao'], padrao: 2 }),
  E({ id: 'sla_horas', rotulo: 'SLA: início do atendimento em até', tipo: 'inteiro', unidade: 'h', grupo: 'Contrato de manutenção', escopo: ['manutencao'], obrigatoria: true }),

  // ---- comercial e fiscal
  E({ id: 'municipio_obra', rotulo: 'Município da obra (local da prestação, ISS)', tipo: 'texto', grupo: 'Comercial e fiscal', ajuda: 'Confirmar com o contador.' }),
  E({ id: 'retencao_iss', rotulo: 'Cliente retém ISS', tipo: 'simnao', grupo: 'Comercial e fiscal' }),
  E({ id: 'retencao_inss', rotulo: 'Cliente retém INSS', tipo: 'simnao', grupo: 'Comercial e fiscal' }),
  E({ id: 'validade_dias', rotulo: 'Validade da proposta', tipo: 'inteiro', unidade: 'dias', grupo: 'Comercial e fiscal', padraoFormula: "com('validade_dias')" }),
];

const h = (id: string, descricao: string, horas: string, taxa: string, extra: Partial<LinhaDef> = {}): LinhaDef => ({
  id, descricao, categoria: 'mao_obra', unidade: 'h', quantidade: `(${horas}) * fator_horas`, custoUnitario: taxa, ...extra,
});

export const CFTV: DefinicaoCalculadora = {
  id: 'cftv',
  nome: 'CFTV / câmeras de segurança',
  versao: 1,
  descricao: 'Fornecimento e instalação de câmeras, cabeamento, gravador, rede e serviços associados.',
  escopo: [
    { id: 'fornecimento', rotulo: 'Fornecimento de equipamentos pela SOF', ajuda: 'Desmarcado = só mão de obra (cliente fornece os equipamentos).' },
    { id: 'infra', rotulo: 'Infraestrutura / cabeamento' },
    { id: 'instalacao_cameras', rotulo: 'Instalação física das câmeras' },
    { id: 'gravador_instalar', rotulo: 'DVR/NVR: só instalar', exclusivo: 'gravador' },
    { id: 'gravador_config', rotulo: 'DVR/NVR: instalar e configurar', exclusivo: 'gravador' },
    { id: 'rede_vms', rotulo: 'Configuração de rede (IP, VLAN, switch PoE) e VMS' },
    { id: 'acesso_remoto', rotulo: 'Acesso remoto / aplicativo' },
    { id: 'treinamento_doc', rotulo: 'Treinamento e documentação (as-built)' },
    { id: 'manutencao', rotulo: 'Contrato de manutenção com SLA' },
  ],
  entradas,
  variaveis: [
    // local e deslocamento
    { id: 'km_ida_volta', formula: "se(municipio == 'outro', km_manual, loc(municipio, 'km'))", rotulo: 'Distância de ida e volta', exibir: true, unidade: 'km' },
    { id: 'min_ida_volta', formula: "se(municipio == 'outro', min_manual, loc(municipio, 'min'))", rotulo: 'Tempo de ida e volta', exibir: true, unidade: 'min' },
    { id: 'pedagio_viagem', formula: "se(municipio == 'outro', pedagio_manual, loc(municipio, 'pedagio'))" },
    { id: 'custo_km_efetivo', formula: "se(fora_es, dsl('passagem_km'), dsl('custo_km'))" },
    // custo/hora com adicional de horário; horas com acréscimo de restrição de áreas
    { id: 'fator_horario', formula: "1 + se(horario == 'noturno', com('adicional_noturno'), se(horario == 'fim_semana', com('adicional_fim_semana'), 0)) / 100" },
    { id: 'fator_horas', formula: "1 + se(restricao_areas, tec('acrescimo_restricao_areas'), 0) / 100" },
    { id: 'taxa_tec', formula: "mo('tecnico') * fator_horario" },
    { id: 'taxa_aux', formula: "mo('auxiliar') * fator_horario" },
    { id: 'taxa_enc', formula: "mo('encarregado') * fator_horario" },
    // produtividade
    { id: 'prod_camera_chave', formula: "'camera_' + ambiente + '_' + fixacao" },
    { id: 'prod_cabo_chave', formula: "se(infra == 'existente', 'cabo_existente', 'cabo_' + passagem)" },
    { id: 'h_cam', formula: "se(tem('instalacao_cameras'), qtd_cameras * prod(prod_camera_chave), 0)" },
    { id: 'h_cabo', formula: "se(tem('infra'), qtd_cameras * metragem_ponto * prod(prod_cabo_chave), 0)" },
    { id: 'h_aux', formula: "(h_cam + h_cabo) * tec('auxiliar_por_tecnico')" },
    { id: 'h_gravador', formula: "se(tem('gravador_instalar') || tem('gravador_config'), prod('gravador_instalar'), 0)" },
    { id: 'h_cfg_gravador', formula: "se(tem('gravador_config'), prod('config_gravador'), 0)" },
    { id: 'h_rede', formula: "se(tem('rede_vms'), prod('config_rede_fixo') + qtd_cameras * prod('config_ip_por_camera'), 0)" },
    { id: 'h_vms', formula: "se(tem('rede_vms'), prod('config_vms_fixo'), 0)" },
    { id: 'h_remoto', formula: "se(tem('acesso_remoto'), prod('acesso_remoto_fixo'), 0)" },
    { id: 'h_treino', formula: "se(tem('treinamento_doc'), prod('treinamento_fixo') + qtd_cameras * prod('asbuilt_por_camera'), 0)" },
    { id: 'h_infra_extra', formula: "se(tem('infra'), se(certificacao, qtd_cameras * prod('certificacao_por_ponto'), 0) + se(etiquetagem, qtd_cameras * prod('etiquetagem_por_ponto'), 0) + se(rack, prod('montagem_rack'), 0) + se(patch_panel, prod('montagem_patch_panel'), 0), 0)" },
    { id: 'h_apr', formula: "se(nr35, prod('apr_nr35'), 0) + se(nr10, prod('apr_nr10'), 0)" },
    { id: 'h_integracao', formula: 'integracao_h * equipe' },
    { id: 'h_visitas', formula: "visitas_tecnicas * prod('visita_tecnica')" },
    { id: 'h_base', formula: 'h_cam + h_cabo + h_aux + h_gravador + h_cfg_gravador + h_rede + h_vms + h_remoto + h_treino + h_infra_extra + h_apr + h_integracao + h_visitas' },
    { id: 'h_enc', formula: "h_base * tec('encarregado_pct') / 100" },
    { id: 'horas_totais', formula: '(h_base + h_enc) * fator_horas', rotulo: 'Horas de mão de obra', exibir: true, unidade: 'h' },
    { id: 'dias_campo', formula: "se(dias_equipe_manual > 0, dias_equipe_manual, se(horas_totais > 0, max(1, teto(horas_totais / (equipe * tec('horas_dia')))), 0))", rotulo: 'Dias de equipe em campo', exibir: true, unidade: 'dias' },
    { id: 'viagens', formula: 'se(dias_campo > 0, dias_campo + visitas_tecnicas, 0)', rotulo: 'Viagens ao local', exibir: true },
    { id: 'precisa_plataforma', formula: "se(tem('instalacao_cameras'), pe_direito > tec('pe_direito_max'), false)" },
    // equipamentos
    { id: 'chave_camera', formula: "'camera_' + tipo_camera + '_' + formato + '_' + resolucao" },
    { id: 'canais', formula: 'proximoDe(qtd_cameras, 4, 8, 16, 32)', rotulo: 'Canais do gravador', exibir: true },
    { id: 'chave_gravador', formula: "se(tipo_camera == 'ip', 'nvr_', 'dvr_') + canais" },
    { id: 'bitrate', formula: "tec('bitrate_' + resolucao)" },
    // HD em TB = câmeras × Mbps × 0,0108 × dias × fatores (codec, contínua/movimento, RAID)
    { id: 'tb_necessario', formula: "qtd_cameras * bitrate * 0.0108 * dias_gravacao * tec('fator_codec_' + codec) * tec('fator_modo_' + modo_gravacao) * tec('fator_raid_' + raid)", rotulo: 'Armazenamento necessário', exibir: true, unidade: 'TB' },
    { id: 'tb_comprado', formula: "teto(tb_necessario / tec('hd_passo_tb')) * tec('hd_passo_tb')", rotulo: 'HD a fornecer', exibir: true, unidade: 'TB' },
    { id: 'n_switches', formula: "se(tipo_camera == 'ip', max(teto(qtd_cameras / portas_switch), teto(qtd_cameras * watts_camera / poe_w_switch)), 0)", rotulo: 'Switches PoE', exibir: true },
    { id: 'poe_total_w', formula: "se(tipo_camera == 'ip', qtd_cameras * watts_camera, 0)", rotulo: 'Potência PoE total', exibir: true, unidade: 'W' },
    { id: 'cabo_m', formula: "qtd_cameras * metragem_ponto * (1 + tec('perda_cabo_pct') / 100)", rotulo: 'Cabo UTP (com sobra)', exibir: true, unidade: 'm' },
    { id: 'infra_nova', formula: "infra != 'existente'" },
  ],
  blocos: [
    { id: 'equip', rotulo: 'Equipamentos', escopo: ['fornecimento'], linhas: [
      { id: 'cameras', descricao: 'Câmeras', categoria: 'material', unidade: 'un', quantidade: 'qtd_cameras', custoUnitario: 'material(chave_camera)' },
      { id: 'audio_embutido', descricao: 'Adicional de áudio embutido', categoria: 'material', unidade: 'un', quantidade: "se(audio_tipo == 'embutido', audio_qtd, 0)", custoUnitario: "material('camera_adicional_audio')" },
      { id: 'audio_externo', descricao: 'Microfones externos', categoria: 'material', unidade: 'un', quantidade: "se(audio_tipo == 'externo', audio_qtd, 0)", custoUnitario: "material('microfone_externo')" },
      { id: 'gravador', descricao: 'Gravador (DVR/NVR)', categoria: 'material', unidade: 'un', quantidade: '1', custoUnitario: 'material(chave_gravador)' },
      { id: 'hd', descricao: 'HD de vigilância', categoria: 'material', unidade: 'TB', quantidade: 'tb_comprado', custoUnitario: "material('hd_vigilancia_tb')" },
      { id: 'switch_poe', descricao: 'Switch PoE', categoria: 'material', unidade: 'un', quantidade: 'n_switches', custoUnitario: "material('switch_poe_' + portas_switch)" },
      { id: 'fonte', descricao: 'Fontes 12 V', categoria: 'material', unidade: 'un', quantidade: "se(tipo_camera == 'analogica', qtd_cameras, 0)", custoUnitario: "material('fonte_12v')" },
      { id: 'balun', descricao: 'Baluns de vídeo', categoria: 'material', unidade: 'un', quantidade: "se(tipo_camera == 'analogica', qtd_cameras, 0)", custoUnitario: "material('balun_par')" },
      { id: 'nobreak', descricao: 'Nobreak', categoria: 'material', unidade: 'un', quantidade: 'se(nobreak, 1, 0)', custoUnitario: "material('nobreak_1kva')" },
    ] },
    { id: 'infra_mat', rotulo: 'Infraestrutura e cabeamento', escopo: ['infra'], linhas: [
      { id: 'cabo', descricao: 'Cabo UTP', categoria: 'material', unidade: 'm', quantidade: 'cabo_m', custoUnitario: "material('cabo_utp_' + cabo_cat)" },
      { id: 'conectores', descricao: 'Conectores RJ45', categoria: 'material', unidade: 'un', quantidade: 'qtd_cameras * 2', custoUnitario: "material('conector_rj45')" },
      { id: 'passagem', descricao: 'Passagem (eletroduto/canaleta/subterrâneo/forro)', categoria: 'material', unidade: 'm', quantidade: 'qtd_cameras * metragem_ponto', custoUnitario: "material('passagem_' + passagem)", ativoSe: 'infra_nova' },
      { id: 'caixas', descricao: 'Caixas de passagem', categoria: 'material', unidade: 'un', quantidade: 'qtd_cameras', custoUnitario: "material('caixa_passagem')", ativoSe: "infra_nova && passagem != 'forro'" },
      { id: 'rack', descricao: 'Rack', categoria: 'material', unidade: 'un', quantidade: 'se(rack, 1, 0)', custoUnitario: "material('rack_5u')" },
      { id: 'patch', descricao: 'Patch panel', categoria: 'material', unidade: 'un', quantidade: 'se(patch_panel, 1, 0)', custoUnitario: "material('patch_panel_24p')" },
      { id: 'etiquetas', descricao: 'Etiquetas de identificação', categoria: 'material', unidade: 'un', quantidade: 'se(etiquetagem, qtd_cameras, 0)', custoUnitario: "material('etiqueta_ponto')" },
    ] },
    { id: 'mo', rotulo: 'Mão de obra', linhas: [
      h('cameras', 'Instalação física das câmeras', 'h_cam', 'taxa_tec', { prodRef: 'prod_camera_chave', prodUnidades: 'qtd_cameras' }),
      h('cabeamento', 'Cabeamento e passagem de cabos', 'h_cabo', 'taxa_tec', { prodRef: 'prod_cabo_chave', prodUnidades: 'qtd_cameras * metragem_ponto' }),
      h('auxiliar', 'Auxiliar de instalação e cabeamento', 'h_aux', 'taxa_aux'),
      h('gravador', 'Instalação do gravador', 'h_gravador', 'taxa_tec', { prodRef: "'gravador_instalar'", prodUnidades: '1' }),
      h('cfg_gravador', 'Configuração do gravador', 'h_cfg_gravador', 'taxa_tec', { prodRef: "'config_gravador'", prodUnidades: '1' }),
      h('rede', 'Configuração de rede (IP, VLAN, switch PoE)', 'h_rede', 'taxa_tec'),
      h('vms', 'Configuração do VMS', 'h_vms', 'taxa_tec', { prodRef: "'config_vms_fixo'", prodUnidades: '1' }),
      h('remoto', 'Acesso remoto / aplicativo', 'h_remoto', 'taxa_tec', { prodRef: "'acesso_remoto_fixo'", prodUnidades: '1' }),
      h('treino', 'Treinamento e documentação (as-built)', 'h_treino', 'taxa_tec'),
      h('infra_extra', 'Certificação, etiquetagem e montagem do rack/patch panel', 'h_infra_extra', 'taxa_tec'),
      h('apr', 'APR e documentação de segurança (NR-35 / NR-10)', 'h_apr', 'taxa_tec'),
      h('integracao', 'Integração de segurança / permissão de trabalho', 'h_integracao', 'taxa_tec'),
      h('visitas', 'Visitas técnicas', 'h_visitas', 'taxa_tec', { prodRef: "'visita_tecnica'", prodUnidades: 'visitas_tecnicas' }),
      h('coordenacao', 'Coordenação (encarregado)', 'h_enc', 'taxa_enc'),
    ] },
    { id: 'desloc', rotulo: 'Deslocamento', linhas: [
      { id: 'km', descricao: 'Deslocamento da equipe (km rodado ou viagem)', categoria: 'deslocamento', unidade: 'km', quantidade: 'viagens * km_ida_volta', custoUnitario: 'custo_km_efetivo', mobilizacao: true },
      { id: 'horas', descricao: 'Horas de deslocamento da equipe', categoria: 'deslocamento', unidade: 'h', quantidade: 'viagens * min_ida_volta / 60 * equipe', custoUnitario: 'taxa_tec', mobilizacao: true },
      { id: 'pedagio', descricao: 'Pedágio', categoria: 'deslocamento', unidade: 'viagem', quantidade: 'viagens', custoUnitario: 'pedagio_viagem', mobilizacao: true },
      { id: 'diaria', descricao: 'Diárias (fora do ES)', categoria: 'deslocamento', unidade: 'dia', quantidade: 'dias_campo * equipe', custoUnitario: "dsl('diaria')", ativoSe: 'fora_es' },
      { id: 'hospedagem', descricao: 'Hospedagem (fora do ES)', categoria: 'deslocamento', unidade: 'noite', quantidade: 'dias_campo * equipe', custoUnitario: "dsl('hospedagem')", ativoSe: 'fora_es' },
      { id: 'alimentacao', descricao: 'Alimentação (fora do ES)', categoria: 'deslocamento', unidade: 'dia', quantidade: 'dias_campo * equipe', custoUnitario: "dsl('alimentacao')", ativoSe: 'fora_es' },
    ] },
    { id: 'terc', rotulo: 'Terceiros e equipamentos', linhas: [
      { id: 'plataforma', descricao: 'Plataforma/andaime (pé-direito acima do limite)', categoria: 'terceiros', unidade: 'dia', quantidade: 'dias_campo', custoUnitario: "tec('plataforma_dia')", ativoSe: 'precisa_plataforma', mobilizacao: true },
    ] },
    // contrato de manutenção: custo MENSAL, fora do total da obra
    { id: 'manut', rotulo: 'Contrato de manutenção (mensal)', escopo: ['manutencao'], recorrente: true, linhas: [
      { id: 'visitas', descricao: 'Visitas de manutenção (mão de obra)', categoria: 'mao_obra', unidade: 'h', quantidade: 'manut_visitas_mes * manut_horas_visita * equipe', custoUnitario: 'taxa_tec' },
      { id: 'deslocamento', descricao: 'Deslocamento das visitas', categoria: 'deslocamento', unidade: 'km', quantidade: 'manut_visitas_mes * km_ida_volta', custoUnitario: 'custo_km_efetivo' },
    ] },
  ],
  contingenciaExtra: [
    { quando: "infra == 'desconhecida'", pct: "com('contingencia_cabo_desconhecido')", motivo: 'Cabeamento/infraestrutura desconhecida' },
  ],
  pendencias: [
    { id: 'lance', quando: "metragem_ponto > tec('lance_max_m')", critica: true, texto: 'Metragem média por ponto ({metragem_ponto} m) acima do lance máximo de cabo UTP: prever switch intermediário, fibra ou rack remoto.' },
    { id: 'infra_desconhecida', quando: "infra == 'desconhecida'", critica: true, texto: 'Infraestrutura/cabeamento desconhecido: contingência maior aplicada. Definir em visita técnica antes de enviar.' },
    { id: 'fora_es', quando: 'fora_es', critica: true, texto: 'Obra fora do ES: confirmar com o contador o enquadramento fiscal (ISS e ICMS) e o local da prestação; diárias e viagem estão no custo.' },
    { id: 'plataforma', quando: 'precisa_plataforma', critica: false, texto: 'Pé-direito acima do limite: plataforma/andaime e NR-35 entram no custo. Confirmar acesso e liberação.' },
    { id: 'pontos_pendentes', quando: 'pontos_pendentes > 0', critica: true, texto: '{pontos_pendentes} linha(s) de pontos com quantidade pendente: a quantidade final de câmeras pode mudar.' },
    { id: 'mais_32', quando: 'qtd_cameras > 32', critica: false, texto: 'Mais de 32 câmeras: confirmar o gravador e a arquitetura de gravação.' },
    { id: 'audio', quando: 'audio_qtd > 0', critica: false, texto: '{audio_qtd} ponto(s) com áudio: política de áudio e privacidade (LGPD) definida pelo cliente.' },
  ],
  premissas: [
    'Equipamentos e materiais conforme o escopo selecionado; itens não descritos não estão incluídos.',
    'Execução em horário {horario}, com acesso livre às áreas e um responsável do cliente acompanhando.',
    'Garantia de {garantia_meses} meses contra defeitos de instalação; equipamentos conforme o fabricante.',
    'Proposta válida por {validade_dias} dias.',
  ],
};
