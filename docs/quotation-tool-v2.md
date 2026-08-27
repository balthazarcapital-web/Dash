# Ferramenta de cotação v2

Interface nova em `quotation-tool.js` e `quotation-tool.css`, acessível em
`/?modo=cotacoes`. Não usa o leitor, os dados locais nem o matching de `quotes.js`.
As rotas antigas permanecem disponíveis para não quebrar integrações existentes.

## Fluxo

1. Escolher a obra e, para arquivar, a pasta oficial do pedido.
2. Importar o pedido e as propostas pelo computador, Google Drive ou texto.
   É possível preencher/corrigir itens manualmente. Não há busca automática.
3. Gerar o mapa. A IA sugere relações; quantidades, unidades, embalagens e
   divergências passam por verificações determinísticas. Pendências mantêm
   valores visíveis, mas não entram nos menores preços até conferência.
4. Baixar Excel ou exportar uma planilha nativa para a pasta escolhida no Drive.
5. Selecionar um fornecedor, marcar os itens e quantidades aprovados, registrar
   a autorização do cliente e confirmar as despesas. Gerar a O.C. parcial ou
   completa. Não há envio automático ao fornecedor.

## Servidor e dados

- `lib/quotation-ai.mjs`: leitura visual/estruturada via Responses e embeddings
  `text-embedding-3-small`. Embeddings são gerados com os itens já conferidos,
  a cada matching; não existe índice global nem sincronização nova do Supabase.
- `lib/quotation-core.mjs`: normalização, equivalência, valores e aprovação.
- `lib/quotation-export.mjs`: ExcelJS, fórmulas, conferência e fontes originais.
- `lib/quotation-api.mjs`: rotas `/api/quotation-tool/*`, Drive, rascunhos e exports.
- `OPENAI_API_KEY` deve estar configurada **somente no servidor**, no ambiente
  de produção do Vercel. Requer API com faturamento/saldo. `QUOTATION_AI_MODEL`
  é opcional (padrão `gpt-4.1`). Nunca colocar a chave no HTML/JS público.
- Usa as credenciais Google já existentes no servidor. O acesso aos arquivos
  é limitado à pasta raiz da obra selecionada. Upload local: 4 MB; Drive: 12 MB.
- Os documentos importados são enviados à API de IA configurada para leitura.
- Rascunho automático é **local**. Para outro computador, usar explicitamente
  **Salvar rascunho no Drive** e **Abrir rascunho do Drive**. Conflitos de versão
  são bloqueados. Os rascunhos anteriores de `quotes.js` não são convertidos.
- Arquivos do computador são arquivados quando a pasta já está selecionada na
  importação. Selecionar pasta posteriormente não envia originais retroativamente.
- Mapas/O.C. gerados para o mesmo rascunho e fornecedor atualizam o mesmo arquivo
  de saída; importar um original diferente preserva o original anterior.

## Verificação

`pnpm test` e `pnpm build`. Os testes usam documentos fictícios, sem escrever
em planilhas de clientes. Configuração presente não prova leitura correta:
conferir o pedido e um orçamento real antes de utilizar uma O.C. comercialmente.
