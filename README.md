# Dashboard de Gestão de Obras

Dashboard web responsivo e multi-cliente para análise de pedidos, automação de mapas de cotação e controle de notas fiscais.

## Executar

Execute o serviço local pelo PowerShell:

```powershell
.\start-dashboard.ps1
```

Depois acesse `http://localhost:4173`.

O terminal precisa permanecer aberto durante o uso. O serviço local é necessário para ler PDFs, executar OCR em imagens, guardar rascunhos e gerar arquivos Excel.

## Publicação

Após cada atualização, incremente a versão em `web-demo.js`, registre um commit, envie-o para `main` e confirme no site publicado que a nova versão aparece no menu lateral. O deploy de produção é acionado automaticamente pelo GitHub.

## Fonte dos dados

O dashboard tenta ler a aba `Respostas ao formulário 1` da planilha configurada em `data.js`. Se a planilha não permitir leitura pública pelo endpoint CSV do Google, a interface usa automaticamente o retrato local incluído no mesmo arquivo.

O seletor **Cliente ativo**, no menu lateral, alterna entre Deterlimp, Carlos Bezerra, Clínica Gianna e Dr. Clovis CMSF. Dados, filtros, relatórios e históricos de cotações permanecem separados por cliente. Carlos Bezerra e Clínica Gianna sincronizam diretamente; Dr. Clovis usa o retrato local quando a exportação pública da planilha está restrita.

Para sincronização direta, publique a planilha para leitura ou substitua a URL por um endpoint autenticado. O botão **Atualizar base** tenta uma nova leitura; **Exportar** baixa os registros filtrados em CSV.

## Recursos

- KPIs de pedidos, valores, notas fiscais e pagamentos
- alertas de NF pendente e vencimentos
- análise por status e categoria
- gráficos clicáveis para filtrar pedidos por categoria e status
- navegação lateral contextual para pedidos, notas fiscais e financeiro
- busca e filtros combináveis
- tabela paginada e painel de detalhes
- exportação CSV
- relatório fiscal por mês ou período personalizado, com data de emissão, NF, fornecedor e valor
- central de cotações em quatro etapas: pedido, orçamentos, conferência e geração
- importação de pedidos e propostas em PDF, Excel, CSV, texto, JPG e PNG
- OCR local com dupla leitura para tabelas enviadas como imagem
- relacionamento de itens por descrição, unidade, quantidade e especificações
- alerta e bloqueio de divergências de quantidade até a conferência
- comparação de até cinco fornecedores e menor valor por item
- geração de mapa de cotação em `.xlsx`, com fórmulas e prévia visual
- histórico local de rascunhos, arquivos importados e mapas gerados
- layout adaptado para desktop, tablet e celular

## Privacidade e armazenamento

Os documentos são processados no computador. Nenhum arquivo é enviado para serviços externos automaticamente. Rascunhos e anexos ficam em `runtime_data/`, pasta ignorada pelo controle de versão.

## Mapa de cotação pelo Bravo (aba Cotações)

O painel "Gerar mapa de cotação" envia orçamentos (PDF/imagem até 20 MB cada, ou texto) ao Bravo:

1. `POST /api/cotacoes/arquivos` devolve uma URL assinada; o navegador envia o arquivo direto ao Storage (sem passar pelo limite de 4,5 MB da Vercel).
2. `POST /api/cotacoes/pedidos` grava o pedido (`cotacao_pedidos`, status `enviado`) e chama `BRAVO_WEBHOOK_URL` com `{pedido_id, cliente_id, obra, titulo, texto, arquivos:[{nome,tipo,url}], callback_url, callback_token}`. As URLs dos arquivos valem 7 dias. Se o webhook falhar, o pedido fica `erro`.
3. O Bravo responde em `POST /api/cotacoes/pedidos/:id/resultado` com `Authorization: Bearer <callback_token>` e `{status: "gerando"|"pronto"|"erro", planilha_url (https, obrigatório em pronto), mensagem}`. Só o hash do token é guardado.
4. `GET /api/cotacoes/pedidos?clientId=` lista os pedidos (sem segredos); a tela atualiza a cada 10 s enquanto houver pedido `enviado`/`gerando`.

Variáveis: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BRAVO_WEBHOOK_URL`, `BRAVO_WEBHOOK_TOKEN`, opcionais `BRAVO_WEBHOOK_HEADER`, `COTACOES_BUCKET`, `DASH_PUBLIC_URL`. Banco: `supabase/migrations/002_cotacao_pedidos.sql`. Sem Supabase, em ambiente local os dados ficam em `runtime_data/`. Em preview da Vercel, se existir `VERCEL_AUTOMATION_BYPASS_SECRET`, ele é anexado ao `callback_url` para o Bravo passar pela proteção do preview.
