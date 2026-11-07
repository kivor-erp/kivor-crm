# KIVOR-CRM

Módulo de CRM da família **Kivor** (KIVOR-ERP é o sistema central). CRM de prospecção da SOF TECNOELETRO (Serra/ES). Registra quais empresas foram contatadas, por qual canal,
quando, e o que se conseguiu. Os dados ficam no **OneDrive da conta Voltrum**, então qualquer computador ou celular
continua de onde parou, basta entrar com a conta Microsoft da Voltrum.

- App estático (PWA): Preact + TypeScript + Vite. Sem servidor próprio.
- Local primeiro: tudo é gravado na hora no navegador (IndexedDB) e sincronizado com o OneDrive.
- Dados: `OneDrive › SOF_CRM › crm.json`; backups diários em `SOF_CRM › backup › crm_AAAA-MM-DD.json` (últimos 30).
- **Nenhum dado de empresa fica no código, no repositório ou na hospedagem.** A planilha é importada pelo app, no navegador.
- Sem telemetria, sem analytics, sem scripts ou fontes de CDN.

---

## 1. Usar no dia a dia

**No PC:** abra o atalho **KIVOR-CRM** (na pasta do projeto ou na Área de Trabalho). Ele abre o app numa janela própria,
como um programa instalado. Alternativa: no Edge, abra o endereço do app → menu **⋯ › Aplicativos › Instalar este site
como aplicativo**; isso cria o atalho no Menu Iniciar e na Área de Trabalho.

**No celular:** abra o endereço no Chrome (Android) ou Safari (iPhone) → **Adicionar à tela inicial**.

**Primeiro uso num aparelho novo:** entrar com a conta Voltrum → o app baixa o `crm.json` → tudo aparece.

**Sem internet:** o app abre e funciona normalmente. O topo mostra "Offline: N alterações pendentes"; quando a internet
volta, envia tudo sozinho. Se a sessão expirar, nada se perde: aparece "Sessão expirada: toque para entrar".

Sincroniza ao abrir, ~3 s depois de cada alteração, a cada 60 s e ao voltar a ficar online. Se dois aparelhos gravarem
ao mesmo tempo, o app junta registro por registro (vence a edição mais recente). Nada é apagado de vez: excluir só marca
como excluído.

### Atalho na pasta

```powershell
powershell -ExecutionPolicy Bypass -File criar-atalho.ps1 -AreaDeTrabalho
```

**PC de outra empresa (ex.: notebook da Prestige):** use `criar-atalho.ps1 -Separado`. Cria `KIVOR-CRM (navegador).lnk`,
que abre o Edge com um perfil só do KIVOR-CRM (`%LOCALAPPDATA%\KIVOR-CRM\Edge`): não usa a conta do Windows e a conta da
Voltrum fica só nesse perfil.

Cria `KIVOR-CRM.lnk` na pasta do projeto (e na Área de Trabalho com `-AreaDeTrabalho`). Ele roda
`msedge.exe --app=<endereço>`: janela própria, sem abas nem barra de endereço.

---

### Módulos (barra lateral)

- **CRM**: Hoje (follow-ups), Empresas, Painel semanal.
- **Orçamentos**: propostas no padrão da SOF (PC-AAAA-CLnnn, revisões, itens com valor por extenso, blocos prontos de
  escopo: preditiva, corretiva, plano preventivo elétrico, checklist NR-10, prazos de atendimento). **Imprimir / PDF** gera a
  proposta com cabeçalho e rodapé da SOF. Marcar como *Enviado*, *Aprovado* ou *Recusado* atualiza a etapa da empresa no CRM.
  Dados do emissor (nome, CNPJ, telefone, quem assina) ficam em `src/config.ts` (`EMISSOR`).
- **WMS**: estoque de materiais. O saldo é sempre a soma das movimentações (entrada, saída, inventário), então dois
  aparelhos nunca perdem lançamentos. **Importar** lê a planilha de controle de materiais (colunas Descrição/Fabricante/
  Modelo/Quant.): linhas do mesmo modelo são somadas e reimportar não duplica (vira ajuste de inventário).

## 2. Rodar no computador (desenvolvimento)

Pré-requisito: Node.js. Neste PC ele está instalado **sem admin** em `%LOCALAPPDATA%\Programs\nodejs`
(zip oficial do nodejs.org, já no PATH do usuário; abra um terminal novo).

```bash
npm install
npm run dev      # http://localhost:5173  (http://localhost:5173/?semlogin abre sem login, só para testes de tela)
npm test         # testes (Vitest)
npm run build    # gera dist/
```

---

## 3. Configurar o Microsoft Entra (Azure)

Já feito para a Voltrum (app **CRM SOF** no Entra; pode ser renomeado para KIVOR-CRM sem efeito no ID). Os IDs ficam em `src/config.ts` (não são segredos). Para refazer:

1. https://entra.microsoft.com → **Entra ID** (ou **Identidade › Aplicativos**) → **Registros de aplicativo** → **+ Novo registro**.
2. Nome `KIVOR-CRM`; **Contas somente neste diretório organizacional (Locatário único)**.
3. URI de redirecionamento: plataforma **Aplicativo de página única (SPA)** → `http://localhost:5173/` → **Registrar**.
4. **Autenticação › Adicionar URI**: o endereço publicado, com a barra no final (`https://kivor-erp.github.io/kivor-crm/`).
5. **Permissões de API › Adicionar uma permissão › Microsoft Graph › Permissões delegadas**: `User.Read` e `Files.ReadWrite`.
   Se pedir, **Conceder consentimento do administrador**.
6. Copie **ID do aplicativo (cliente)** e **ID do diretório (locatário)** para `src/config.ts`. Não crie segredo.

---

## 4. Publicar (GitHub Pages)

1. Organização **`kivor-erp`** no GitHub (https://github.com/organizations/plan, plano Free) e, dentro dela, o repositório
   **`kivor-crm`** (público; o código não tem nenhum dado). Outros módulos seguem o padrão `kivor-<módulo>`.
2. No repositório: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
3. Envie o código:
   ```bash
   git remote add origin https://github.com/kivor-erp/kivor-crm.git
   git push -u origin main
   ```
4. A aba **Actions** roda testes + build e publica em `https://kivor-erp.github.io/kivor-crm/`.
5. Adicione esse endereço no Entra (passo 3.4).

Cada `git push` na `main` publica de novo. O app já aberto pega a versão nova ao recarregar.

---

## 5. Backup e restauração

- Backup automático uma vez por dia (primeira sincronização do dia), mantendo os 30 mais recentes.
- **Ajustes › Restaurar de um backup…**: escolha a data, veja o que some/volta/muda e confirme. Antes de restaurar, o app
  guarda o estado atual em `SOF_CRM › backup › antes_de_restaurar_….json`. A versão restaurada vale para todos os aparelhos.
- **Ajustes › Exportar Excel / JSON**: cópia para a pasta Downloads. O JSON tem o mesmo formato do `crm.json`.
- Último recurso: o OneDrive guarda o **histórico de versões** do `crm.json` (clique direito › Histórico de versões).

---

## 6. Dar acesso a outra pessoa (futuro)

O app usa o OneDrive **de quem entra** (`/me/drive`). Hoje:

- **Cada pessoa com o próprio CRM:** já funciona. Qualquer conta da Voltrum pode entrar e terá seu próprio
  `SOF_CRM/crm.json`. Para limitar quem pode entrar: Entra › **Aplicativos empresariais › CRM SOF (ou KIVOR-CRM) › Propriedades ›
  Atribuição obrigatória = Sim**, e em **Usuários e grupos** adicione as pessoas.
- **Equipe com os mesmos dados:** exige uma pequena mudança. Colocar `SOF_CRM` numa biblioteca do SharePoint/Teams
  compartilhada, trocar em `src/onedrive.ts` o caminho `me/drive/root:` pelo da biblioteca (`drives/{id}/root:`) e pedir
  a permissão `Files.ReadWrite.All` (ou `Sites.ReadWrite.All`) no Entra. O modelo de dados já tem ids únicos,
  `criadoEm/atualizadoEm/excluidoEm` e mesclagem por registro, então suporta vários usuários.

---

## 7. Estrutura

```
src/lib/      regras puras (modelo, datas, importação, regras de etapa, mesclagem, métricas, restauração, exportação)
src/telas/    CRM (Hoje, Empresas, Ficha, Registrar, Painel), Orçamentos (lista, editor, impressão), Estoque, Ajustes
src/db.ts     IndexedDB (Dexie)    src/auth.ts  login MSAL    src/onedrive.ts  Microsoft Graph
src/sync.ts   quando sincronizar + estado na tela
public/sw.js  service worker (offline)
tests/        Vitest: datas, regras, importação (planilha fictícia), sincronização/conflitos, painel, restauração,
              orçamentos (por extenso, numeração, funil), estoque (saldo, importação)
```
