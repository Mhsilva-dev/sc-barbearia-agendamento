/* ══════════════════════════════════════════════════════════════
   SC Barbearia — site.js
   Parte pública do site: navegação entre páginas, cabeçalho,
   página inicial (faixa de serviços, grade de serviços) e os
   cartões de localização/contato.
══════════════════════════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════════════════════════════
//  Navegação
//  O site é uma SPA: cada "página" é uma <section class="page">
//  e só a que tem .active fica visível.
// ══════════════════════════════════════════════════════════════

/**
 * Mostra a página `n` (home | booking | location | admin) e
 * carrega o conteúdo que ela precisa.
 * @param {string} n
 */
function navTo(n) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .drawer-nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + n)?.classList.add('active');
  document.getElementById('nav-' + n)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  closeDrawer();

  if (n === 'home')     initHome();
  if (n === 'booking')  initBooking();
  if (n === 'location') buildLocCards();
}

/** Menu lateral (mobile). */
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.body.style.overflow = '';
}

// Cabeçalho fica com fundo sólido ao rolar a página
const hdr = document.getElementById('hdr');
window.addEventListener('scroll', () => hdr.classList.toggle('solid', scrollY > 40), { passive: true });
hdr.classList.add('solid');

// ══════════════════════════════════════════════════════════════
//  Página inicial
// ══════════════════════════════════════════════════════════════
async function initHome() {
  await loadPublicData();
  buildMarquee();
  buildSvcGrid();
  buildLocCards();
}

// requestAnimationFrame da faixa animada — guardado para poder cancelar
let _marqueeRaf = null;

/**
 * Faixa horizontal com os serviços e preços rolando sem parar.
 * O conteúdo é duplicado: quando a posição chega à metade da largura,
 * volta a 0 — como a segunda metade é idêntica, o salto não aparece.
 */
function buildMarquee() {
  const track = document.getElementById('marquee-track');
  if (!track) return;

  if (_marqueeRaf) { cancelAnimationFrame(_marqueeRaf); _marqueeRaf = null; }

  const items = servicos.map(s =>
    `<div class="marquee-item"><div class="dot"></div>${esc(s.nome)} — ${fmtPreco(s.preco)}</div>`
  ).join('');

  track.innerHTML = items + items;
  track.style.transform = 'translateX(0px)';

  // Espera o navegador calcular a largura real dos itens antes de animar
  requestAnimationFrame(() => {
    const halfWidth = track.offsetWidth / 2;
    if (halfWidth <= 0) return;

    // Respeita a preferência de acessibilidade "reduzir movimento"
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const pxPorFrame = 0.45; // velocidade da faixa
    let x = 0;

    function tick() {
      x -= pxPorFrame;
      if (x <= -halfWidth) x = 0;
      track.style.transform = `translateX(${x}px)`;
      _marqueeRaf = requestAnimationFrame(tick);
    }
    _marqueeRaf = requestAnimationFrame(tick);
  });
}

/** Grade "Nossos serviços" da página inicial. */
function buildSvcGrid() {
  const el = document.getElementById('svc-grid');
  if (!el) return;
  el.innerHTML = servicos.map(s => `
    <div class="svc-cell" role="listitem">
      <span class="svc-cell-ico" aria-hidden="true">${esc(s.icone)}</span>
      <div class="svc-cell-nm">${esc(s.nome)}</div>
      <div class="svc-cell-pr">${fmtPreco(s.preco)}</div>
      <div class="svc-cell-dur">⏱ ${esc(s.duracao)} minutos</div>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
//  Localização e contato
// ══════════════════════════════════════════════════════════════

/** HTML do cartão de endereço, horário, contato e como chegar. */
function locHTML() {
  const aberto = isOpen();

  return `
    <div class="loc-info-row"><div class="loc-ico">📍</div><div><div class="loc-lbl">Endereço</div><div class="loc-val">${escMultilinha(configData.endereco)}</div></div></div>
    <div class="loc-info-row"><div class="loc-ico">🕐</div><div><div class="loc-lbl">Horário</div><div class="loc-val">${escMultilinha(configData.horarios)}</div></div></div>
    <div class="loc-info-row"><div class="loc-ico">📲</div><div><div class="loc-lbl">Contato</div><div class="loc-val">
      <a href="${linkWhatsApp(configData.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a> &nbsp;·&nbsp;
      <a href="https://instagram.com/sc_barbearia00" target="_blank" rel="noopener">📸 Instagram</a>
      <div class="status-chip ${aberto ? 'chip-open' : 'chip-closed'}">${aberto ? '● Aberto Agora' : '● Fechado'}</div>
    </div></div></div>
    <div class="loc-info-row"><div class="loc-ico">🚗</div><div><div class="loc-lbl">Como Chegar</div><div class="loc-val">${esc(configData.como_chegar)}</div></div></div>`;
}

/** Atualiza os cartões de localização (home e página "Localização") e os mapas. */
function buildLocCards() {
  const h = locHTML();
  ['loc-home', 'loc-page'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = h;
  });
  atualizarMapas(configData.maps_embed);
}

/** Aponta os iframes do Google Maps para a URL configurada no painel. */
function atualizarMapas(url) {
  if (!url) return;
  document.querySelectorAll('#map1, #map2').forEach(f => { f.src = url; });
}
