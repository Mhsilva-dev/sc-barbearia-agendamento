/* ══════════════════════════════════════════════════════════════
   SC Barbearia — main.js
   Último script carregado: registra os eventos globais (modais,
   tecla Esc, acesso secreto ao painel) e inicializa o site.
══════════════════════════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════════════════════════════
//  Modais — fechar clicando fora ou com Esc
// ══════════════════════════════════════════════════════════════
document.querySelectorAll('.modal-overlay').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); })
);

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  closeDrawer();
});

// ══════════════════════════════════════════════════════════════
//  Acesso "secreto" ao painel admin
//  O painel não aparece no menu; o dono entra por um destes atalhos:
//    1. 5 cliques rápidos na logo do cabeçalho
//    2. clique triplo no copyright do rodapé
//    3. endereço terminado em #painel
// ══════════════════════════════════════════════════════════════
let logoClicks = 0;
let logoTimer;

document.querySelector('.hdr-brand')?.addEventListener('click', () => {
  logoClicks++;
  clearTimeout(logoTimer);
  if (logoClicks >= 5) { logoClicks = 0; openAdminSecret(); return; }
  logoTimer = setTimeout(() => { logoClicks = 0; }, 1200);
});

document.getElementById('footer-secret')?.addEventListener('click', e => {
  if (e.detail === 3) openAdminSecret();
});

if (window.location.hash === '#painel') setTimeout(openAdminSecret, 300);
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#painel') openAdminSecret();
});

/** Abre o painel (com um leve "flash" de feedback); se já logado, vai direto ao dashboard. */
function openAdminSecret() {
  window.location.hash = '';
  document.body.style.transition = 'filter .3s';
  document.body.style.filter     = 'brightness(1.04)';
  setTimeout(() => { document.body.style.filter = ''; }, 300);

  navTo('admin');
  if (adminToken) showDashboard();
}

// ══════════════════════════════════════════════════════════════
//  Inicialização
// ══════════════════════════════════════════════════════════════
(async function init() {
  await loadPublicData();
  buildMarquee();
  buildSvcGrid();
  buildLocCards();

  // Página do admin já aberta com token salvo: valida o token antes de entrar
  if (adminToken && document.getElementById('page-admin')?.classList.contains('active')) {
    try {
      const r = await apiFetch('/api/agendamentos/stats');
      if (r.ok) showDashboard();
      else      limparToken();
    } catch {
      limparToken();
    }
  }
})();
