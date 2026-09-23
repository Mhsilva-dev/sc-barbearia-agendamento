#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  SC Barbearia — Script de Instalação Automática
#  Ubuntu 20.04 / 22.04 LTS
#  Uso: bash instalar.sh
# ══════════════════════════════════════════════════════════════

set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}"
echo "  ✂  SC Barbearia — Instalação Automática"
echo "  ════════════════════════════════════════"
echo -e "${NC}"

APP_DIR="/var/www/sc-barbearia"

# 1. Atualiza sistema
echo -e "${YELLOW}[1/7] Atualizando sistema...${NC}"
apt-get update -qq && apt-get upgrade -y -qq

# 2. Instala Node.js 20
echo -e "${YELLOW}[2/7] Instalando Node.js 20...${NC}"
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs -qq
fi
echo -e "${GREEN}  Node: $(node -v) | NPM: $(npm -v)${NC}"

# 3. Instala PM2 e Nginx
echo -e "${YELLOW}[3/7] Instalando PM2 e Nginx...${NC}"
npm install -g pm2 -q
apt-get install -y nginx -qq
systemctl enable nginx && systemctl start nginx

# 4. Copia arquivos
echo -e "${YELLOW}[4/7] Copiando arquivos...${NC}"
mkdir -p "$APP_DIR"
cp -r . "$APP_DIR/"
cd "$APP_DIR/backend"
mkdir -p data uploads

# 5. Instala dependências
echo -e "${YELLOW}[5/7] Instalando dependências Node...${NC}"
npm install --production -q

# 6. Configura .env
echo -e "${YELLOW}[6/7] Configurando ambiente...${NC}"
if [ ! -f .env ]; then
    cp .env.example .env
    JWT=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    sed -i "s|TROQUE_POR_UMA_CHAVE_SECRETA_LONGA_AQUI|$JWT|g" .env
    echo -e "${GREEN}  .env criado com JWT_SECRET gerado automaticamente${NC}"
    echo -e "${YELLOW}  ⚠️  IMPORTANTE: edite $APP_DIR/backend/.env para configurar:${NC}"
    echo "     - ADMIN_PASS (senha do painel)"
    echo "  Depois conecte o WhatsApp pelo painel admin (aba WhatsApp)"
fi

# 7. Inicia com PM2 e configura Nginx
echo -e "${YELLOW}[7/7] Iniciando aplicação...${NC}"
pm2 delete sc-barbearia 2>/dev/null || true
pm2 start server.js --name sc-barbearia --env production
pm2 startup systemd -u root --hp /root
pm2 save

cp "$APP_DIR/nginx.conf" /etc/nginx/sites-available/sc-barbearia
ln -sf /etc/nginx/sites-available/sc-barbearia /etc/nginx/sites-enabled/sc-barbearia
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Resumo
IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅  INSTALADO COM SUCESSO!              ${NC}"
echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
echo ""
echo -e "  🌐 Site:  ${BLUE}http://$IP${NC}"
echo -e "  🔑 Admin: acesse via método secreto (5 cliques na logo)"
echo ""
echo -e "  PRÓXIMOS PASSOS:"
echo "  1. Edite o .env:  nano $APP_DIR/backend/.env"
echo "  2. Reinicie:      pm2 restart sc-barbearia"
echo "  3. Domínio:       edite nginx.conf com seu domínio"
echo "  4. SSL grátis:    certbot --nginx -d seudominio.com.br"
echo ""
echo -e "  📋 Logs:      pm2 logs sc-barbearia"
echo -e "  🔄 Restart:   pm2 restart sc-barbearia"
echo ""
