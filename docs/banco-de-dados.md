# Banco de Dados — Diagrama ERD

## Diagrama de Entidade e Relacionamento

```mermaid
erDiagram
  BARBEIROS {
    int     id            PK
    text    nome
    text    especialidade
    text    emoji
    text    foto
    int     ativo         "0 = inativo, 1 = ativo"
    text    criado_em
  }

  SERVICOS {
    int     id        PK
    text    nome
    real    preco
    int     duracao   "em minutos"
    text    icone
    int     ativo     "0 = inativo, 1 = ativo"
    text    criado_em
  }

  AGENDAMENTOS {
    int     id                  PK
    text    cliente_nome
    text    cliente_fone
    text    observacao
    int     barbeiro_id         FK
    text    barbeiro_nome       "desnormalizado para histórico"
    int     servico_id          FK
    text    servico_nome        "desnormalizado para histórico"
    real    preco               "desnormalizado para histórico"
    text    data                "formato YYYY-MM-DD"
    text    horario             "formato HH:MM"
    text    status              "confirmado | cancelado"
    int     confirmacao_enviada "0 = pendente, 1 = enviado"
    int     lembrete_enviado    "0 = pendente, 1 = enviado"
    text    criado_em
  }

  CONFIGURACOES {
    text    chave  PK  "ex: barbearia_nome, horarios"
    text    valor
  }

  ADMINS {
    int     id    PK
    text    user  "único"
    text    hash  "bcrypt hash da senha"
  }

  BLOQUEIOS {
    int     id          PK
    text    tipo        "dia | horario"
    text    data        "formato YYYY-MM-DD"
    text    horario     "null quando tipo = dia"
    int     barbeiro_id FK  "null = bloqueia todos"
    text    motivo
    text    criado_em
  }

  BARBEIROS ||--o{ AGENDAMENTOS : "realiza"
  SERVICOS  ||--o{ AGENDAMENTOS : "executado em"
  BARBEIROS ||--o{ BLOQUEIOS    : "tem bloqueio"
```

---

## Índices de Performance

| Índice | Tabela | Colunas | Uso |
|--------|--------|---------|-----|
| `idx_agend_data` | agendamentos | `data` | Consulta de agenda por data |
| `idx_agend_barbeiro` | agendamentos | `barbeiro_id` | Agenda por barbeiro |
| `idx_agend_status` | agendamentos | `status` | Filtragem por status |
| `idx_agend_lembrete` | agendamentos | `lembrete_enviado, status, data` | CRON de lembretes |

---

## Configurações da Chave-Valor (`configuracoes`)

| Chave | Descrição | Exemplo |
|-------|-----------|---------|
| `barbearia_nome` | Nome exibido no site | `SC Barbearia` |
| `endereco` | Endereço completo | `Serra do Salitre, MG` |
| `horarios` | Texto dos horários de atendimento | `Seg–Sex: 08h às 19h` |
| `whatsapp` | Número WhatsApp da barbearia | `5534999999999` |
| `como_chegar` | Descrição de como chegar | `...` |
| `maps_embed` | URL de embed do Google Maps | `https://...` |
| `horarios_funcionamento` | JSON com horários por dia da semana (0=Dom..6=Sáb) | `{"1":{"ini":"08:00","fim":"17:30"},...}` |

---

## Pragmas SQLite Ativos

```sql
PRAGMA journal_mode = WAL;      -- Leituras simultâneas sem bloquear escrita
PRAGMA foreign_keys = ON;       -- Integridade referencial
PRAGMA synchronous  = NORMAL;   -- Equilíbrio entre segurança e performance
```
