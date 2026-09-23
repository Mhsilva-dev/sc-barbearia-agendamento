# Fluxo WhatsApp — Ciclo de Vida da Conexão

## Máquina de Estados

```mermaid
stateDiagram-v2
  [*]           --> Desconectado  : Servidor inicia
  Desconectado  --> Conectando    : initialize()
  Conectando    --> QRGerado      : evento 'qr'
  QRGerado      --> Autenticando  : Admin escaneia QR
  Autenticando  --> Conectado     : evento 'ready'
  Conectando    --> Desconectado  : Erro de inicialização
  Conectado     --> Desconectado  : evento 'disconnected'
  Conectado     --> Desconectado  : Browser crash
  Conectado     --> Conectado     : CONFLICT → takeOver()
  Desconectado  --> Conectando    : scheduleReconnect() (backoff)

  state Conectado {
    [*]         --> Ocioso
    Ocioso      --> EnviandoMsg  : enviarMensagem()
    EnviandoMsg --> Ocioso       : Mensagem enviada
    Ocioso      --> Heartbeat    : A cada 45s
    Heartbeat   --> Ocioso       : Estado = CONNECTED
    Heartbeat   --> [*]          : Estado != CONNECTED → forceReconnect()
  }
```

---

## Diagrama de Sequência — Conexão e Reconexão

```mermaid
sequenceDiagram
  participant PM2   as PM2 (Process Manager)
  participant SRV   as server.js
  participant WAS   as WhatsApp Service
  participant CHR   as Chromium (Puppeteer)
  participant WW    as WhatsApp Web

  PM2->>SRV: Inicia processo Node.js
  SRV->>WAS: initialize()
  WAS->>WAS: cleanupChrome() — remove locks antigos
  WAS->>CHR: Lança Chromium (headless)
  CHR->>WW: Abre web.whatsapp.com
  WW-->>CHR: Sessão restaurada (LocalAuth)
  CHR-->>WAS: evento 'authenticated'
  CHR-->>WAS: evento 'ready'
  WAS->>WAS: status = 'connected'
  WAS->>WAS: startHeartbeat() — pulso a cada 45s
  WAS->>WAS: reenviarPendentes() — após 5s

  Note over CHR,WW: ... conexão estável ...

  CHR--xWAS: Browser crash / desconexão
  WAS->>WAS: forceReconnect()
  WAS->>CHR: destroy()
  WAS->>WAS: scheduleReconnect(backoff + jitter)
  Note over WAS: Aguarda N segundos (5s → 10s → 20s → ... → 120s)
  WAS->>WAS: initialize() novamente
  WAS->>CHR: Relança Chromium
  CHR->>WW: Reconecta com sessão salva
  WW-->>WAS: evento 'ready'
  WAS->>WAS: reconnectDelay = 5000 (reseta backoff)
```

---

## Fila de Mensagens (Anti-ban)

```mermaid
flowchart TD
  A["enviarMensagem(numero, texto)"] --> B["Adiciona à fila\nmsgQueue.push()"]
  B --> C{Fila já\nprocessando?}
  C -->|Sim| Z["Aguarda sua vez"]
  C -->|Não| D["processQueue()"]
  D --> E{Limite de\n10 msg/min\natingido?}
  E -->|Sim| F["Aguarda 5s e\nverifica novamente"]
  F --> E
  E -->|Não| G["_enviar(numero, texto)"]
  G --> H["client.getNumberId()"]
  H --> I{Número\nno WhatsApp?}
  I -->|Não| J["{ ok: false }\nNúmero não encontrado"]
  I -->|Sim| K["client.sendMessage()"]
  K --> L["{ ok: true }"]
  K --> M{Erro de\nbrowser?}
  M -->|Sim| N["forceReconnect()"]
  L --> O{Mais itens\nna fila?}
  O -->|Sim| P["sleep(2s–5s)\ndelay aleatório"]
  P --> D
  O -->|Não| Q["queueRunning = false"]

  style A fill:#C49A2E,color:#07070A
  style L fill:#22C55E,color:#07070A
  style J fill:#EF4444,color:#fff
  style N fill:#EF4444,color:#fff
```

---

## Configurações do Chromium

| Flag | Motivo |
|------|--------|
| `--no-sandbox` | Necessário para rodar como root no Linux |
| `--disable-setuid-sandbox` | Complemento ao no-sandbox |
| `--disable-dev-shm-usage` | Evita crash por `/dev/shm` pequeno em VPS |
| `--disable-gpu` | Sem GPU no servidor |
| `--no-zygote` | Evita processo zygote desnecessário em servidor |
| `--disable-blink-features=AutomationControlled` | Oculta flag de automação do browser |
| `--lang=pt-BR` | Simula usuário brasileiro |
| `--window-size=1280,800` | Resolução realista |

> **Removido:** `--single-process` — causa crashes constantes ao isolar tudo em um único processo sem isolamento entre abas/frames.
