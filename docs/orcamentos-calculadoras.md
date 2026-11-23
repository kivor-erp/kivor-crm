# Orçamentos com calculadora (OR01–OR04)

Módulo **Orçamentos** do KIVOR. Nenhum preço, hora, alíquota ou limite fica no código: tudo vem de tabelas editáveis.
Nenhum dado de cliente fica no repositório (a carga de uma oportunidade é um arquivo JSON importado pela tela).

## Telas

| Código | Tela | Para quê |
|---|---|---|
| OR01 | Orçamentos | Lista (propostas simples e com calculadora), "+ Orçamento com calculadora", importar oportunidade + orçamento (JSON). |
| OR02 | Calculadoras | Calculadoras do sistema (CFTV) e as cadastradas por JSON; exportar/importar definição. |
| OR03 | Parâmetros | Mão de obra, materiais, deslocamento, produtividade, fiscal por CNPJ, comerciais. Valores de exemplo marcados "valor de exemplo — substituir". |
| OR04 | Real × estimado | Depois da obra: horas e custos reais × estimado; sugere a produtividade corrigida. |

## Parâmetros (tabela `parametros`)

Cada linha: `grupo`, `chave`, `valores`, `vigenteDe`, `vigenteAte`, `exemplo`. O valor em vigor numa data é a linha de maior
`vigenteDe` já iniciada. Editar com **nova vigência** guarda o valor antigo; **corrigir** troca a linha.
Orçamentos já salvos guardam o resultado calculado (não mudam quando a tabela muda).

- **Fiscal por CNPJ**: regime, nota (NF-e/NFS-e), Anexo, RBT12, retenções. Alíquota efetiva =
  `(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12`, com a tabela de faixas do Simples (também editável, com vigência).
  **Sem RBT12 ou Anexo o cálculo fiscal é bloqueado** e o preço daquele CNPJ não sai.
- **WMS**: se um material do catálogo tiver "Modelo no WMS" igual ao de um item do estoque com custo de compra, esse custo vale.
- Todo resultado fiscal mostra: "Estimativa — validar com o contador (Anexo, retenções, ISS/local da prestação)".

## Motor e definição declarativa

`src/lib/calc/formula.ts` (avaliador seguro, sem `eval`), `motor.ts` (lê a definição e gera linhas de custo), `preco.ts`
(preço por CNPJ), `parametros.ts` (tabelas, vigência, Simples), `orcamentoCalc.ts` (orquestração, status, versões, carga).

Preço = `custo direto × (1 + contingência) ÷ (1 − imposto efetivo − margem)` (divisor, não soma). Mostra mínimo, recomendado
e máximo; alerta se a margem adotada ficar abaixo da mínima. Entrada sugerida = materiais + mobilização (valores de venda).

Uma calculadora é um JSON: `escopo` (o que liga cada bloco), `entradas`, `variaveis` (fórmulas, avaliadas sob demanda),
`blocos` com `linhas` (`categoria`, `quantidade`, `custoUnitario`, `ativoSe`), `pendencias`, `contingenciaExtra`, `premissas`.
Funções de parâmetro: `mo('funcao')`, `prod('chave')`, `material('codigo')`, `dsl('item')`, `loc('local','km')`,
`tec('regra')`, `com('regra')`, `param('grupo','chave','campo')`, `tem('item_de_escopo')`. Dados do orçamento: `pontos_total`,
`pontos_audio`, `pontos_pendentes`… O exemplo completo é `src/lib/calc/cftv.ts`; OR02 › Exportar JSON baixa a definição.

## Orçamento

Status: Rascunho, Aguardando dados, Enviado, Aprovado, Perdido. **Pendência crítica em aberto bloqueia "Enviado"**
(e também a falta de cálculo salvo ou o fiscal bloqueado). Enviado/Aprovado/Perdido movem a oportunidade no CRM.
Cada linha tem "faturado por" (Loja/NF-e ou SOF Montagens/NFS-e); o PDF é gerado **por CNPJ**, com o cabeçalho e só os
itens daquele CNPJ. "Nova versão" copia o orçamento (v2) e a aba Versões compara duas versões.

## Importar uma oportunidade (JSON)

OR01 › "Importar oportunidade + orçamento (JSON)". Formato `versao: 1` com `empresa`, `contato` e `orcamento` (com `calc`).
Ids fixos tornam a importação repetível sem duplicar. Os arquivos de clientes ficam fora do repositório (`dados/`).
