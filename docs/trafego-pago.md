# Tráfego Pago (MK): Fase 0 e preparação das fases seguintes

## Como está montado

- **Núcleo genérico** (`src/lib/trafego/`): conta do canal, campanha, grupo, palavra-chave/negativa,
  anúncio, produto anunciável, métrica diária normalizada, termo de pesquisa, lead e conversão.
  Painel (`painel.ts`), alertas (`alertas.ts`), importação (`importacao.ts`) e conversões
  (`conversoes.ts`) não sabem de qual canal veio o dado.
- **Adaptadores** (`canais.ts`): um por canal, todos com a mesma interface:
  - `importarRelatorio(arquivo, tipo, mes)`: Fase 0, já implementado para Google Ads e Google Meu Negócio;
  - `buscarMetricas(periodo)`: Fase 2, hoje lança `NaoDisponivel`;
  - `enviarConversoes(lista)`: Fase 3, hoje lança `NaoDisponivel`.
  Canal novo (Meta Ads, TikTok…) = novo adaptador registrado em `CANAIS`. O núcleo não muda.
  O Meta Ads já está registrado como "em breve".
- **Isolamento por empresa**: tudo em MK leva `unidadeId` (empresa do grupo, um CNPJ). O seletor
  "Empresa" aparece em Orçamentos, WMS e Tráfego; nenhum relatório mistura unidades.
- **Armazenamento**: as mesmas tabelas Dexie e o mesmo `crm.json` no OneDrive (arquivo versão 3).
  Termos de pesquisa ficam agregados por mês para o arquivo não crescer demais.

## Transações

| Código | Tela |
|---|---|
| MK01 | Painel: por canal e por campanha, com o recorte "todos os canais" |
| MK02 | Canais e contas (e dados de exemplo fictícios) |
| MK03 | Campanhas e grupos (orçamento mensal, lance máximo, local, horário, ID externo) |
| MK04 | Palavras-chave e negativas, termos de pesquisa importados ("Negativar") |
| MK05 | Textos de anúncio (validador de 30/90 caracteres, código Ref) |
| MK06 | Produtos anunciáveis (ligados ao item do WMS; SKU, nº de peça, estado, NF) |
| MK07 | Importar relatórios CSV |
| MK08 | Google Meu Negócio: métricas mensais e links com Ref |
| MK09 | Leads de tráfego |
| MK10 | Conversões offline (CSV) e alertas |

## Formatos conferidos na documentação oficial (18/11/2026)

- **Conversões offline (CSV)**, support.google.com/google-ads/answer/7014069: linha
  `Parameters:TimeZone=America/Sao_Paulo`, colunas `Google Click ID, Conversion Name, Conversion Time,
  Conversion Value, Conversion Currency`, hora `yyyy-MM-dd HH:mm:ss`. O Google classifica o envio por
  arquivo como recurso legado e recomenda o **Data Manager**, que usa o mesmo modelo. Também aceita
  envio programado a partir de Google Planilhas ou de uma URL HTTPS.
- **Relatório de campanhas do Google Ads**: conferido com uma exportação real
  (Campanhas › Campanhas, segmento Dia, download .csv, novembro de 2026). Formato: 2 linhas de título,
  cabeçalho em português, datas AAAA-MM-DD, números com vírgula, "--" para vazio e várias linhas
  "Total: …" no fim (todas ignoradas). A coluna Orçamento (diário) vira orçamento mensal (× 30,4) nas
  campanhas novas. O teste "layout real do Google Ads" reproduz esse layout com números fictícios.
- **Termos de pesquisa**: ainda não conferido com arquivo real. A campanha atual é do tipo Inteligente,
  que mostra temas de palavras-chave em vez do relatório de termos completo.
- O leitor também aceita cabeçalhos em inglês e o "CSV do Excel" (UTF-16, tabulação).

## Fase 1: página de produto com gclid e Ref (preparado, não implementado)

- `AnuncioMk.ref` e `urlFinal` já existem; a URL final deve levar `?ref=G-FA10`.
- A página de produto lê `gclid` e `ref` da URL e os passa para o link do WhatsApp/formulário.
  O lead em MK09 já tem os campos `gclid`, `ref` e `produtoId`, e o botão "Preencher pelo Ref".
- O GitHub Pages serve páginas estáticas de graça, então não precisa de servidor pago.

## Fase 2: leitura automática (passos para o usuário)

O que a documentação oficial dizia em 18/11/2026:

1. **Google Ads API** (developers.google.com/google-ads/api/docs/api-policy/developer-token e access-levels):
   - o *developer token* foi descontinuado em 09/09/2026; o acesso agora é por **projeto do Google Cloud**
     (dono do cliente OAuth). A conta de administrador (MCC) só é necessária para gerenciar várias contas;
   - ativar a API no projeto dá **acesso de teste** (só contas de teste);
   - para dados reais, peça **Explorer** (2.880 operações/dia, revisão automática) ou **Basic**
     (15.000/dia, exige verificação da marca do projeto) na página da Google Ads API no Cloud Console.
2. **Alternativa sem servidor e sem custo: Google Ads Scripts** (developers.google.com/google-ads/scripts):
   um script roda dentro do próprio Google Ads, programado (de hora em hora a mensal), sem token de
   desenvolvedor, e pode gravar os relatórios numa Google Planilha. É o caminho mais simples para a
   restrição "sem servidor pago". O KIVOR leria essa planilha (novo adaptador de leitura).
3. **API do Perfil da Empresa** (developers.google.com/my-business/content/prereqs):
   - requisitos: perfil **verificado e ativo há mais de 60 dias**, site cadastrado no perfil,
     projeto do Google Cloud e conta de organização;
   - pedido: formulário "Application for Basic API Access"
     (support.google.com/business/contact/api_default), informando o número do projeto e usando um
     e-mail que seja proprietário/gerente do perfil. Aprovado = cota de 300 QPM (0 = ainda não).
4. **Vincular o Perfil da Empresa ao Google Ads** (para os recursos de local): **não confirmado**,
   porque a página de ajuda consultada deu 404. Conferir na Central de Ajuda do Google Ads
   ("recursos de local" / "vincular Perfil da Empresa") antes de seguir.

Credenciais: nenhum token, senha ou chave vai para o repositório. Na Fase 2, as credenciais OAuth ficam
só no navegador de quem entra, ou num cofre do Microsoft 365. Isso será decidido quando o acesso for liberado.

## Fase 3: envio automático de conversões

- Hoje: MK10 gera o CSV, e o usuário envia no Google Ads ou no Data Manager.
- Sem servidor: um envio programado lendo uma Google Planilha ou uma URL HTTPS (aceito pelo Google)
  pode buscar o arquivo que o KIVOR gerar. `enviarConversoes` do adaptador fica para quando houver API.

## Fase 4: pausar ou ativar grupos conforme o estoque

- `GrupoMk.produtoIds` já liga o grupo aos produtos, e o alerta "estoque zero em produto anunciado" já existe.
- A ação será sempre sugerida e confirmada por uma pessoa, nunca automática.

## Fora do escopo agora

Comissão, Meta CAPI, leitor de lista de materiais, API do WhatsApp.
