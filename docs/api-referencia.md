# API — Referência Completa

Base URL: `http://localhost:3000/api` (em produção, o domínio configurado no Nginx)

Rotas marcadas com 🔐 exigem header: `Authorization: Bearer <token>`

---

## Autenticação

### `POST /auth/login`
Faz login e retorna token JWT.

**Body:**
```json
{ "user": "admin", "pass": "senha123" }
```
**Resposta:**
```json
{ "token": "eyJ...", "user": "admin", "expira": "24h" }
```

### `PUT /auth/senha` 🔐
Troca a senha do admin.
```json
{ "senhaAtual": "admin123", "novaSenha": "novaSenha456" }
```

### `PUT /auth/usuario` 🔐
Troca o nome de usuário do admin.
```json
{ "novoUsuario": "joao", "senhaAtual": "admin123" }
```

---

## Barbeiros

### `GET /barbeiros`
Lista barbeiros ativos (público).
```json
[{ "id": 1, "nome": "Carlos", "especialidade": "Degradê", "emoji": "💈", "foto": "/uploads/..." }]
```

### `POST /admin/barbeiros` 🔐
Cria barbeiro.
```json
{ "nome": "João", "especialidade": "Corte Clássico", "emoji": "✂" }
```

### `PUT /admin/barbeiros/:id` 🔐
Atualiza barbeiro.

### `DELETE /admin/barbeiros/:id` 🔐
Desativa barbeiro (soft delete — `ativo = 0`).

### `POST /admin/barbeiros/:id/foto` 🔐
Upload de foto via `multipart/form-data` (campo: `foto`, máx 5MB).

### `POST /admin/barbeiros/:id/foto-base64` 🔐
Upload de foto via base64.
```json
{ "fotoBase64": "data:image/jpeg;base64,/9j/..." }
```

---

## Serviços

### `GET /servicos`
Lista serviços ativos (público).

### `POST /admin/servicos` 🔐
Cria serviço.
```json
{ "nome": "Corte + Barba", "preco": 55.00, "duracao": 50, "icone": "💈" }
```

### `PUT /admin/servicos/:id` 🔐
Atualiza serviço.

### `DELETE /admin/servicos/:id` 🔐
Desativa serviço.

---

## Agendamentos

### `GET /agendamentos/horarios?barbeiro_id=&data=`
Retorna horários disponíveis para um barbeiro em uma data (público).
```json
["09:00", "09:30", "10:00", ...]
```

### `POST /agendamentos`
Cria agendamento (público).
```json
{
  "cliente_nome": "João Silva",
  "cliente_fone": "(34) 99999-9999",
  "barbeiro_id": 1,
  "servico_id": 2,
  "data": "2026-05-01",
  "horario": "10:00",
  "observacao": ""
}
```

### `GET /agendamentos` 🔐
Lista agendamentos (admin). Query params: `data`, `barbeiro_id`, `status`.

### `PUT /agendamentos/:id/status` 🔐
Atualiza status do agendamento.
```json
{ "status": "cancelado" }
```

### `DELETE /agendamentos/:id` 🔐
Remove agendamento.

### `GET /agendamentos/relatorio` 🔐
Relatório financeiro. Query params: `periodo` (`dia` | `semana` | `mes`).
```json
{ "total": 350.00, "quantidade": 7, "agendamentos": [...] }
```

---

## Configurações

### `GET /config`
Retorna configurações públicas da barbearia.
```json
{
  "barbearia_nome": "SC Barbearia",
  "endereco": "Serra do Salitre, MG",
  "horarios": "Seg–Sex: 08h às 19h",
  "horarios_funcionamento": "{\"1\":{\"ini\":\"08:00\",\"fim\":\"17:30\"},...}"
}
```

### `PUT /config/admin` 🔐
Atualiza configurações.

---

## Bloqueios

### `GET /bloqueios/dias?barbeiro_id=`
Lista datas completamente bloqueadas (público, para o calendário).

### `GET /bloqueios/horarios?barbeiro_id=&data=`
Lista horários bloqueados de um barbeiro em uma data (público).

### `GET /bloqueios` 🔐
Lista todos os bloqueios (admin).

### `POST /bloqueios` 🔐
Cria bloqueio.
```json
{ "tipo": "dia", "data": "2026-05-01", "barbeiro_id": 1, "motivo": "Feriado" }
{ "tipo": "horario", "data": "2026-05-02", "horario": "14:00", "barbeiro_id": null }
```

### `DELETE /bloqueios/:id` 🔐
Remove bloqueio.

---

## WhatsApp

### `GET /whatsapp/status` 🔐
```json
{ "status": "connected" }
```
Valores possíveis: `connected` | `connecting` | `disconnected`

### `GET /whatsapp/qr` 🔐
Retorna QR Code em base64 (quando `status = connecting`).
```json
{ "qr": "data:image/png;base64,...", "status": "connecting" }
```

### `POST /whatsapp/connect` 🔐
Inicia conexão.

### `POST /whatsapp/disconnect` 🔐
Desconecta manualmente.

### `GET /whatsapp/validar?fone=` (público)
Verifica se número existe no WhatsApp.
```json
{ "valido": true }
```

---

## Health Check

### `GET /health`
```json
{
  "status": "ok",
  "app": "SC Barbearia",
  "versao": "1.0.0",
  "uptime": "3600s",
  "env": "production"
}
```
