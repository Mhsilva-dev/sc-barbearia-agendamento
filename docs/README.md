# SC Barbearia — Documentação Técnica

Diagramas UML e referência de arquitetura do sistema.
Todos os diagramas usam **Mermaid** — renderizam automaticamente no GitHub, VS Code (extensão Mermaid) e GitLab.

---

## Índice

| Arquivo | Conteúdo |
|---------|----------|
| [arquitetura.md](./arquitetura.md) | Visão geral dos componentes do sistema |
| [banco-de-dados.md](./banco-de-dados.md) | Diagrama ERD — tabelas e relacionamentos |
| [fluxo-agendamento.md](./fluxo-agendamento.md) | Jornada do cliente ao fazer um agendamento |
| [fluxo-whatsapp.md](./fluxo-whatsapp.md) | Ciclo de vida da conexão WhatsApp |
| [api-referencia.md](./api-referencia.md) | Todas as rotas da API com exemplos |

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Banco de dados | SQLite 3 (better-sqlite3, modo WAL) |
| Autenticação | JWT (jsonwebtoken) |
| WhatsApp | whatsapp-web.js + Puppeteer/Chromium |
| Agendador | node-cron |
| Upload | Multer |
| Frontend | Vanilla JS + CSS3 (SPA) |
| Servidor | Nginx (reverse proxy) |
| Processo | PM2 |
| SSL | Let's Encrypt (certbot) |
