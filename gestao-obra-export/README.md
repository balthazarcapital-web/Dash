# Gestão de Obra — exportação

Exportação da tela/módulo de Gestão de Obra na versão atual do projeto. A tela original não foi alterada.

## 1. Componente principal

`works.js` contém o módulo principal, exposto como `window.WorkManagement`. Ele renderiza a visão executiva, orçamento, documentos, diário, etapas, tarefas e contatos.

## 2. Arquivos obrigatórios

- `gestao-obra.html` — markup da tela, extraído da seção atual de Gestão de Obra.
- `works.js` — lógica e renderização do módulo.
- `styles.css` — estilos atuais do projeto, incluindo as classes `work-*`, `budget-*`, `journal-*` e auxiliares usados pelo módulo.
- `works-data.json` — dados de exemplo usados como fallback/mock local.

O módulo espera um elemento pai com a seção `#work` e os IDs/data-attributes presentes no HTML. O carregador padrão consulta `/api/works/:clientId`; em modo demo, usa `works-data.json` e `localStorage`.

## 3. Bibliotecas externas

Não há biblioteca de UI ou gráfico externa. A interface usa HTML, CSS e JavaScript nativos, `fetch`, `localStorage`, `Intl.NumberFormat` e `Intl.DateTimeFormat`.

## 4. Dados esperados

Inicialize o módulo com:

```js
window.WorkManagement.init({
  toast: message => {},
  client: { id: "deterlimp", name: "Deterlimp", work: "Deterlimp" }
});
```

O objeto de obra deve conter, no mínimo, `clientId`, `details`, `phases`, `budget`, `documents`, `tasks`, `contacts` e `journal`. O orçamento usa `budget.items`, `budget.directTotal`, `budget.grandTotal`, `budget.administrationValue`, `budget.project`, `budget.budgetDate`, `budget.sourceUrl` e `budget.actuals`. Consulte `works-data.json` para o formato completo e os valores de exemplo.

## Observação de integração

Inclua `gestao-obra.html` dentro de um `<main>` da aplicação, carregue `styles.css` e depois `works.js`. A API de produção precisa implementar `GET` e `PUT` em `/api/works/:clientId`; o upload de documentos usa também `POST /api/works/:clientId/documents/:documentId/files`.
