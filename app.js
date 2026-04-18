/* ═══════════════════════════════════════════════════════
   NEXUS STORE — app.js
   ═══════════════════════════════════════════════════════ */

'use strict';

// ── CONFIG ──────────────────────────────────────────────
const API_BASE = 'http://localhost:3000/api/v1';

// ── STATE ───────────────────────────────────────────────
const state = {
  token:          localStorage.getItem('nxs_token') || null,
  user:           JSON.parse(localStorage.getItem('nxs_user') || 'null'),
  cartCount:      0,
  selectedPayment:'cartao_credito',
  selectedCategory: null,
  searchQuery:    '',
  allGames:       [],
  allCategories:  [],
  wishlistIds:    new Set(),
  currentGame:    null,
  reviewStars:    5,
};

// ── API LAYER ────────────────────────────────────────────

async function request(method, path, body = null, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.token) headers['Authorization'] = `Bearer ${state.token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.error || data.message || data.mensagem || 'Erro desconhecido';
    throw new Error(msg);
  }
  return data;
}

const api = {
  // Auth
  register:       (b) => request('POST', '/auth/register', b),
  login:          (b) => request('POST', '/auth/login', b),
  changePassword: (b) => request('PUT',  '/auth/change-password', b, true),

  // Jogos (público — não precisa de auth)
  getGames:       ()   => request('GET', '/public/jogos'),
  getGame:        (id) => request('GET', `/jogos/${id}`, null, true),
  getCategories:  ()   => request('GET', '/categorias'),

  // Carrinho
  getCart:        ()   => request('GET',    '/carrinho', null, true),
  addToCart:      (id) => request('POST',   '/carrinho/add', { jogoId: id }, true),
  removeFromCart: (id) => request('DELETE', `/carrinho/${id}`, null, true),

  // Wishlist
  getWishlist:    ()   => request('GET',    '/lista-desejo', null, true),
  addToWishlist:  (id) => request('POST',   '/lista-desejo', { jogoId: id }, true),
  removeWishlist: (id) => request('DELETE', '/lista-desejo', { jogoId: id }, true),

  // Vendas
  checkout:       (b)  => request('POST', '/vendas/checkout', b, true),
  getHistory:     ()   => request('GET',  '/vendas', null, true),

  // Avaliações
  getReviews:     (gameId) => request('GET', `/avaliacoes?jogoId=${gameId}`),
  getRating:      (gameId) => request('GET', `/avaliacoes/media/${gameId}`),
  createReview:   (b)      => request('POST', '/avaliacoes', b, true),
};

// ── UTILS ────────────────────────────────────────────────

function formatPrice(val) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function stars(avg, max = 5) {
  const full  = Math.round(avg || 0);
  return '★'.repeat(full) + '☆'.repeat(max - full);
}

function coverClass(id) {
  return `cover-${(id || 0) % 6}`;
}

function coverInitials(title) {
  if (!title) return '?';
  return title.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── TOAST ────────────────────────────────────────────────

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── ROUTER ───────────────────────────────────────────────

const PROTECTED_VIEWS = ['cart', 'wishlist', 'history'];

function navigate(view) {
  if (PROTECTED_VIEWS.includes(view) && !state.token) {
    openModal('auth');
    toast('Faça login para acessar essa área.', 'info');
    return;
  }
  location.hash = view;
}

function handleRoute() {
  const view = location.hash.replace('#', '') || 'store';

  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const section = document.getElementById(`view-${view}`);
  if (section) section.classList.remove('hidden');

  const navLink = document.querySelector(`.nav-link[data-view="${view}"]`);
  if (navLink) navLink.classList.add('active');

  switch (view) {
    case 'store':    loadStore();    break;
    case 'cart':     loadCart();     break;
    case 'wishlist': loadWishlist(); break;
    case 'history':  loadHistory();  break;
  }
}

// ── AUTH HELPERS ─────────────────────────────────────────

function setAuth(token, user) {
  state.token = token;
  state.user  = user;
  localStorage.setItem('nxs_token', token);
  localStorage.setItem('nxs_user', JSON.stringify(user));
  updateUserUI();
}

function clearAuth() {
  state.token = null;
  state.user  = null;
  localStorage.removeItem('nxs_token');
  localStorage.removeItem('nxs_user');
  updateUserUI();
}

function updateUserUI() {
  const loginBtn  = document.getElementById('btn-login-open');
  const userInfo  = document.getElementById('user-info');
  const nameDisp  = document.getElementById('user-name-display');

  if (state.token && state.user) {
    loginBtn.classList.add('hidden');
    userInfo.classList.remove('hidden');
    nameDisp.textContent = `Olá, ${(state.user.nome || state.user.name || 'Usuário').split(' ')[0]}`;
  } else {
    loginBtn.classList.remove('hidden');
    userInfo.classList.add('hidden');
  }
}

// ── MODAL HELPERS ─────────────────────────────────────────

function openModal(id)  { document.getElementById(`modal-${id}`).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(`modal-${id}`).classList.add('hidden'); }

// ── CART BADGE ───────────────────────────────────────────

async function refreshCartBadge() {
  if (!state.token) { updateCartBadge(0); return; }
  try {
    const data = await api.getCart();
    const items = data.itens || data.items || data || [];
    const count = Array.isArray(items) ? items.length : 0;
    updateCartBadge(count);
  } catch { updateCartBadge(0); }
}

function updateCartBadge(count) {
  state.cartCount = count;
  const badge = document.getElementById('cart-badge');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════════════
//  STORE VIEW
// ════════════════════════════════════════════════════════

async function loadStore() {
  const grid    = document.getElementById('games-grid');
  const loading = document.getElementById('store-loading');
  const empty   = document.getElementById('store-empty');

  loading.classList.remove('hidden');
  grid.classList.add('hidden');
  empty.classList.add('hidden');

  try {
    const [gamesData, catsData] = await Promise.all([
      api.getGames(),
      api.getCategories().catch(() => []),
    ]);

    state.allGames      = gamesData.jogos || gamesData || [];
    state.allCategories = catsData.categorias || catsData || [];

    // Load wishlist IDs if logged in
    if (state.token) {
      try {
        const wl = await api.getWishlist();
        const wlItems = wl.itens || wl || [];
        state.wishlistIds = new Set(wlItems.map(i => i.jogoId || i.id || i.jogo_id));
      } catch { /* ignore */ }
    }

    renderCategoryFilters();
    renderGames();
  } catch (err) {
    loading.classList.add('hidden');
    toast('Erro ao carregar jogos: ' + err.message, 'error');
  }
}

function renderCategoryFilters() {
  const container = document.getElementById('category-filters');
  const all = { id: null, nome: 'Todos' };
  const cats = [all, ...state.allCategories];

  container.innerHTML = cats.map(c => `
    <button
      class="cat-chip ${state.selectedCategory === c.id ? 'active' : ''}"
      data-id="${c.id ?? ''}"
    >${escapeHtml(c.nome)}</button>
  `).join('');
}

function renderGames() {
  const grid    = document.getElementById('games-grid');
  const loading = document.getElementById('store-loading');
  const empty   = document.getElementById('store-empty');

  let games = [...state.allGames];

  if (state.selectedCategory !== null) {
    games = games.filter(g =>
      (g.fkCategoria || g.categoria_id || g.categoriaId) === state.selectedCategory
    );
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    games = games.filter(g =>
      (g.nome || g.title || '').toLowerCase().includes(q) ||
      (g.descricao || g.description || '').toLowerCase().includes(q)
    );
  }

  loading.classList.add('hidden');

  if (games.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  grid.innerHTML = games.map(g => buildGameCard(g)).join('');
}

function buildGameCard(game) {
  const id       = game.id;
  const title    = game.nome || game.title || 'Sem título';
  const price    = game.preco || game.price || 0;
  const year     = game.ano || game.year || '';
  const catName  = game.categoriaNome || game.categoria || '';
  const avgRating= game.mediaAvaliacao || game.rating || 0;
  const inWish   = state.wishlistIds.has(id);

  return `
    <article class="game-card" data-game-id="${id}">
      <div class="card-cover ${coverClass(id)}">
        <span>${escapeHtml(coverInitials(title))}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-meta">
          ${catName ? `<span class="card-category">${escapeHtml(catName)}</span>` : ''}
          ${year    ? `<span class="card-year">${year}</span>` : ''}
        </div>
        ${avgRating ? `<div class="card-rating">${stars(avgRating)} <span style="color:var(--text-3);font-size:.7rem">(${Number(avgRating).toFixed(1)})</span></div>` : ''}
      </div>
      <div class="card-footer">
        <span class="card-price">${formatPrice(price)}</span>
        <div class="card-actions">
          <button
            class="btn-wish ${inWish ? 'active' : ''}"
            title="${inWish ? 'Remover da lista' : 'Adicionar à lista de desejos'}"
            data-wish-id="${id}"
          >${inWish ? '♥' : '♡'}</button>
          <button class="btn btn-primary btn-sm" data-cart-add="${id}">+ Carrinho</button>
        </div>
      </div>
    </article>
  `;
}

// ════════════════════════════════════════════════════════
//  GAME DETAIL MODAL
// ════════════════════════════════════════════════════════

async function openGameDetail(gameId) {
  openModal('game');
  const container = document.getElementById('game-detail-content');
  container.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  try {
    // Try authenticated first; fall back to public list lookup
    let game;
    try {
      game = await api.getGame(gameId);
      game = game.jogo || game;
    } catch {
      game = state.allGames.find(g => g.id === gameId) || {};
    }

    const [reviewsData, ratingData] = await Promise.all([
      api.getReviews(gameId).catch(() => []),
      api.getRating(gameId).catch(() => null),
    ]);

    const reviews = reviewsData.avaliacoes || reviewsData || [];
    const avg     = ratingData?.media || ratingData?.average || 0;
    const count   = ratingData?.total || reviews.length || 0;

    state.currentGame = game;
    container.innerHTML = buildGameDetail(game, reviews, avg, count);
    initStarPicker();
  } catch (err) {
    container.innerHTML = `<p class="form-error">Erro ao carregar jogo: ${escapeHtml(err.message)}</p>`;
  }
}

function buildGameDetail(game, reviews, avg, count) {
  const id       = game.id;
  const title    = game.nome  || game.title       || 'Sem título';
  const desc     = game.descricao || game.description || '';
  const price    = game.preco || game.price        || 0;
  const year     = game.ano   || game.year         || '—';
  const catName  = game.categoriaNome || game.categoria || '—';
  const empresa  = game.empresaNome   || game.empresa   || '—';
  const inWish   = state.wishlistIds.has(id);

  const reviewsHtml = reviews.length
    ? reviews.map(r => `
        <div class="review-item">
          <div class="review-header">
            <span class="review-author">${escapeHtml(r.nomeUsuario || r.usuario || 'Usuário')}</span>
            <span class="review-stars">${stars(r.nota || r.rating)}</span>
          </div>
          <p class="review-comment">${escapeHtml(r.comentario || r.comment || '')}</p>
        </div>
      `).join('')
    : '<p style="color:var(--text-3);font-size:.85rem">Nenhuma avaliação ainda.</p>';

  const reviewFormHtml = state.token ? `
    <div class="review-form">
      <h5>Deixe sua avaliação</h5>
      <div class="star-picker" id="star-picker">
        ${[1,2,3,4,5].map(n => `<button class="star-btn ${n <= state.reviewStars ? 'selected' : ''}" data-star="${n}">★</button>`).join('')}
      </div>
      <div class="form-group">
        <textarea id="review-comment" class="form-input" rows="3" placeholder="Seu comentário (opcional)..." style="resize:vertical"></textarea>
      </div>
      <button id="btn-submit-review" class="btn btn-outline btn-sm" data-game-id="${id}">Enviar avaliação</button>
    </div>
  ` : `<p style="font-size:.82rem;color:var(--text-3);margin-top:8px"><a href="#" id="link-login-review" style="color:var(--cyan)">Faça login</a> para avaliar este jogo.</p>`;

  return `
    <div class="game-detail">
      <div class="game-detail-cover ${coverClass(id)}">
        <span style="font-size:2rem">${escapeHtml(coverInitials(title))}</span>
      </div>

      <div class="game-detail-info" style="grid-column:1">
        <div class="game-detail-title">${escapeHtml(title)}</div>
        <div class="game-meta-grid">
          <div class="meta-item"><div class="meta-label">Desenvolvedora</div><div class="meta-value">${escapeHtml(empresa)}</div></div>
          <div class="meta-item"><div class="meta-label">Categoria</div><div class="meta-value">${escapeHtml(catName)}</div></div>
          <div class="meta-item"><div class="meta-label">Ano</div><div class="meta-value">${escapeHtml(String(year))}</div></div>
          ${avg ? `<div class="meta-item"><div class="meta-label">Avaliação</div><div class="meta-value" style="color:#ffd54f">${stars(avg)} ${Number(avg).toFixed(1)}</div></div>` : ''}
        </div>
        ${desc ? `<p class="game-detail-desc">${escapeHtml(desc)}</p>` : ''}
      </div>

      <div style="grid-column:2;display:flex;flex-direction:column;gap:12px;align-self:start">
        <div class="game-detail-price">${formatPrice(price)}</div>
        <div class="game-detail-actions">
          <button class="btn btn-primary" data-cart-add="${id}">Adicionar ao carrinho</button>
          <button class="btn btn-outline btn-wish ${inWish ? 'active' : ''}" data-wish-id="${id}">
            ${inWish ? '♥ Na lista' : '♡ Desejos'}
          </button>
        </div>
      </div>

      <div class="reviews-section">
        <h4>Avaliações ${count ? `(${count})` : ''}</h4>
        ${avg ? `
          <div class="rating-summary">
            <span class="rating-big">${Number(avg).toFixed(1)}</span>
            <div>
              <div class="stars-display">${stars(avg)}</div>
              <div class="rating-count">${count} avaliação${count !== 1 ? 'ões' : ''}</div>
            </div>
          </div>
        ` : ''}
        <div class="review-list">${reviewsHtml}</div>
        ${reviewFormHtml}
      </div>
    </div>
  `;
}

function initStarPicker() {
  const picker = document.getElementById('star-picker');
  if (!picker) return;
  picker.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.reviewStars = parseInt(btn.dataset.star);
      picker.querySelectorAll('.star-btn').forEach((b, i) => {
        b.classList.toggle('selected', i < state.reviewStars);
      });
    });
  });
}

// ════════════════════════════════════════════════════════
//  CART VIEW
// ════════════════════════════════════════════════════════

async function loadCart() {
  const loading = document.getElementById('cart-loading');
  const content = document.getElementById('cart-content');
  const empty   = document.getElementById('cart-empty');

  loading.classList.remove('hidden');
  content.classList.add('hidden');
  empty.classList.add('hidden');

  try {
    const data  = await api.getCart();
    const items = data.itens || data.items || data || [];

    loading.classList.add('hidden');

    if (!Array.isArray(items) || items.length === 0) {
      empty.classList.remove('hidden');
      updateCartBadge(0);
      return;
    }

    renderCartItems(items);
    content.classList.remove('hidden');
    updateCartBadge(items.length);
  } catch (err) {
    loading.classList.add('hidden');
    toast('Erro ao carregar carrinho: ' + err.message, 'error');
  }
}

function renderCartItems(items) {
  const container = document.getElementById('cart-items');
  const countEl   = document.getElementById('cart-count-label');
  const totalEl   = document.getElementById('cart-total-value');

  const total = items.reduce((s, i) => s + Number(i.preco || i.price || 0), 0);

  countEl.textContent = items.length;
  totalEl.textContent = formatPrice(total);

  container.innerHTML = items.map(item => {
    const id    = item.jogoId || item.id || item.jogo_id;
    const title = item.nome   || item.title || 'Jogo';
    const price = item.preco  || item.price || 0;
    const cat   = item.categoria || item.categoriaNome || '';

    return `
      <div class="cart-item">
        <div class="cart-item-cover ${coverClass(id)}">${escapeHtml(coverInitials(title))}</div>
        <div class="cart-item-info">
          <div class="cart-item-title">${escapeHtml(title)}</div>
          ${cat ? `<div class="cart-item-cat">${escapeHtml(cat)}</div>` : ''}
        </div>
        <span class="cart-item-price">${formatPrice(price)}</span>
        <button class="btn btn-danger btn-sm" data-cart-remove="${id}">Remover</button>
      </div>
    `;
  }).join('');

  // Store total for checkout modal
  state._cartTotal = total;
  state._cartItems = items;
}

// ════════════════════════════════════════════════════════
//  WISHLIST VIEW
// ════════════════════════════════════════════════════════

async function loadWishlist() {
  const loading = document.getElementById('wishlist-loading');
  const grid    = document.getElementById('wishlist-items');
  const empty   = document.getElementById('wishlist-empty');

  loading.classList.remove('hidden');
  grid.classList.add('hidden');
  empty.classList.add('hidden');

  try {
    const data  = await api.getWishlist();
    const items = data.itens || data.items || data || [];

    loading.classList.add('hidden');

    if (!Array.isArray(items) || items.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    state.wishlistIds = new Set(items.map(i => i.jogoId || i.id || i.jogo_id));
    grid.innerHTML = items.map(item => {
      const game = {
        id:    item.jogoId || item.id || item.jogo_id,
        nome:  item.nome   || item.title,
        preco: item.preco  || item.price,
        ano:   item.ano    || item.year,
        categoriaNome: item.categoria || item.categoriaNome,
      };
      return buildGameCard(game);
    }).join('');
    grid.classList.remove('hidden');
  } catch (err) {
    loading.classList.add('hidden');
    toast('Erro ao carregar lista de desejos: ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════
//  HISTORY VIEW
// ════════════════════════════════════════════════════════

async function loadHistory() {
  const loading = document.getElementById('history-loading');
  const list    = document.getElementById('history-items');
  const empty   = document.getElementById('history-empty');

  loading.classList.remove('hidden');
  list.classList.add('hidden');
  empty.classList.add('hidden');

  try {
    const data  = await api.getHistory();
    const sales = data.vendas || data.historico || data || [];

    loading.classList.add('hidden');

    if (!Array.isArray(sales) || sales.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    list.innerHTML = sales.map(sale => {
      const saleId  = sale.id || sale.vendaId || '—';
      const date    = sale.dataVenda || sale.date || sale.createdAt || '—';
      const total   = sale.total || sale.valorTotal || 0;
      const items   = sale.itens || sale.items || sale.jogos || [];

      const dateStr = date !== '—'
        ? new Date(date).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' })
        : '—';

      const itemsHtml = items.map(item => {
        const title = item.nome || item.title || 'Jogo';
        const keys  = item.chaves || item.activationKeys || item.keys || [];
        return `
          <div class="history-item">
            <div>
              <div class="history-item-name">${escapeHtml(title)}</div>
              <div class="history-item-keys">
                ${Array.isArray(keys) && keys.length
                  ? keys.map(k => `<span class="activation-key">${escapeHtml(typeof k === 'object' ? (k.chave || k.key || JSON.stringify(k)) : k)}</span>`).join('')
                  : item.chave || item.activationKey
                    ? `<span class="activation-key">${escapeHtml(item.chave || item.activationKey)}</span>`
                    : '<span style="font-size:.78rem;color:var(--text-3)">Chave não disponível</span>'
                }
              </div>
            </div>
            <span style="font-family:var(--font-mono);font-size:.85rem;color:var(--text-2);white-space:nowrap">${formatPrice(item.preco || item.price || 0)}</span>
          </div>
        `;
      }).join('');

      return `
        <div class="history-sale">
          <div class="history-sale-header">
            <span class="history-sale-id">Pedido #${saleId}</span>
            <span class="history-sale-date">${dateStr}</span>
            <span class="history-sale-total">${formatPrice(total)}</span>
          </div>
          <div class="history-sale-items">
            ${itemsHtml || '<p style="color:var(--text-3);font-size:.85rem">Sem detalhes de itens.</p>'}
          </div>
        </div>
      `;
    }).join('');

    list.classList.remove('hidden');
  } catch (err) {
    loading.classList.add('hidden');
    toast('Erro ao carregar histórico: ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════
//  CHECKOUT
// ════════════════════════════════════════════════════════

function openCheckout() {
  const items   = state._cartItems || [];
  const total   = state._cartTotal || 0;

  const preview = document.getElementById('checkout-items-preview');
  const totalEl = document.getElementById('checkout-total-display');

  preview.innerHTML = items.map(i =>
    `<div class="checkout-preview-item">
      <span>${escapeHtml(i.nome || i.title || 'Jogo')}</span>
      <span class="checkout-preview-price">${formatPrice(i.preco || i.price || 0)}</span>
    </div>`
  ).join('');

  totalEl.textContent = formatPrice(total);

  document.getElementById('checkout-error').classList.add('hidden');
  openModal('checkout');
}

async function confirmCheckout() {
  const btn = document.getElementById('btn-confirm-checkout');
  const err = document.getElementById('checkout-error');

  btn.disabled = true;
  btn.textContent = 'Processando...';
  err.classList.add('hidden');

  try {
    const result = await api.checkout({ metodoPagamento: state.selectedPayment });

    closeModal('checkout');
    updateCartBadge(0);

    const successMsg = document.getElementById('success-message');
    const successTitle = document.getElementById('success-title');
    successTitle.textContent = 'Compra realizada! 🎉';
    successMsg.textContent = 'Seus jogos foram adicionados ao seu histórico com as chaves de ativação. Obrigado pela compra!';
    openModal('success');

    // Reload cart view data
    state._cartItems = [];
    state._cartTotal = 0;
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar Pagamento';
  }
}

// ════════════════════════════════════════════════════════
//  WISHLIST TOGGLE
// ════════════════════════════════════════════════════════

async function toggleWishlist(gameId) {
  if (!state.token) { openModal('auth'); return; }

  const inList = state.wishlistIds.has(gameId);
  try {
    if (inList) {
      await api.removeWishlist(gameId);
      state.wishlistIds.delete(gameId);
      toast('Removido da lista de desejos', 'info');
    } else {
      await api.addToWishlist(gameId);
      state.wishlistIds.add(gameId);
      toast('Adicionado à lista de desejos ♥', 'success');
    }
    // Update all wish buttons for this game
    document.querySelectorAll(`[data-wish-id="${gameId}"]`).forEach(btn => {
      btn.classList.toggle('active', !inList);
      btn.textContent = !inList ? (btn.classList.contains('btn-outline') ? '♥ Na lista' : '♥') : (btn.classList.contains('btn-outline') ? '♡ Desejos' : '♡');
    });
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}

// ════════════════════════════════════════════════════════
//  ADD TO CART
// ════════════════════════════════════════════════════════

async function addToCart(gameId, btn) {
  if (!state.token) { openModal('auth'); return; }

  const orig = btn.textContent;
  btn.disabled  = true;
  btn.textContent = '...';

  try {
    await api.addToCart(gameId);
    await refreshCartBadge();
    toast('Adicionado ao carrinho!', 'success');
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// ════════════════════════════════════════════════════════
//  EVENT DELEGATION (clicks on dynamic content)
// ════════════════════════════════════════════════════════

document.addEventListener('click', async (e) => {
  const t = e.target;

  // Open game detail (click on card, but not on buttons)
  const card = t.closest('.game-card');
  if (card && !t.closest('button') && !t.closest('[data-cart-add]') && !t.closest('[data-wish-id]')) {
    openGameDetail(parseInt(card.dataset.gameId));
    return;
  }

  // Add to cart
  const cartAddBtn = t.closest('[data-cart-add]');
  if (cartAddBtn) {
    e.stopPropagation();
    addToCart(parseInt(cartAddBtn.dataset.cartAdd), cartAddBtn);
    return;
  }

  // Wishlist toggle
  const wishBtn = t.closest('[data-wish-id]');
  if (wishBtn) {
    e.stopPropagation();
    toggleWishlist(parseInt(wishBtn.dataset.wishId));
    return;
  }

  // Remove from cart
  const removeBtn = t.closest('[data-cart-remove]');
  if (removeBtn) {
    removeBtn.disabled = true;
    try {
      await api.removeFromCart(parseInt(removeBtn.dataset.cartRemove));
      await loadCart();
      toast('Item removido do carrinho', 'info');
    } catch (err) {
      toast('Erro: ' + err.message, 'error');
      removeBtn.disabled = false;
    }
    return;
  }

  // Submit review
  const reviewBtn = t.closest('#btn-submit-review');
  if (reviewBtn) {
    if (!state.token) { openModal('auth'); return; }
    const gameId  = parseInt(reviewBtn.dataset.gameId);
    const comment = document.getElementById('review-comment')?.value || '';
    reviewBtn.disabled = true;
    reviewBtn.textContent = 'Enviando...';
    try {
      await api.createReview({ jogoId: gameId, nota: state.reviewStars, comentario: comment });
      toast('Avaliação enviada! ✓', 'success');
      openGameDetail(gameId); // reload detail
    } catch (err) {
      toast('Erro: ' + err.message, 'error');
      reviewBtn.disabled = false;
      reviewBtn.textContent = 'Enviar avaliação';
    }
    return;
  }

  // Category chips
  if (t.classList.contains('cat-chip')) {
    const rawId = t.dataset.id;
    state.selectedCategory = rawId === '' ? null : parseInt(rawId);
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    t.classList.add('active');
    renderGames();
    return;
  }

  // Login link inside review section
  if (t.id === 'link-login-review') {
    e.preventDefault();
    openModal('auth');
    return;
  }
});

// ════════════════════════════════════════════════════════
//  STATIC EVENT LISTENERS
// ════════════════════════════════════════════════════════

// ── Search ──
document.getElementById('search-input').addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim();
  renderGames();
});

// ── Auth Modal ──
document.getElementById('btn-login-open').addEventListener('click', () => openModal('auth'));
document.getElementById('btn-auth-close').addEventListener('click', () => closeModal('auth'));

document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

// Login submit
document.getElementById('btn-login-submit').addEventListener('click', async () => {
  const email  = document.getElementById('login-email').value.trim();
  const senha  = document.getElementById('login-password').value;
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('btn-login-submit');

  errEl.classList.add('hidden');
  if (!email || !senha) { errEl.textContent = 'Preencha e-mail e senha.'; errEl.classList.remove('hidden'); return; }

  btn.disabled = true; btn.textContent = 'Entrando...';
  try {
    const data = await api.login({ email, senha });
    setAuth(data.token, data.usuario || data.user || { nome: email.split('@')[0] });
    closeModal('auth');
    toast(`Bem-vindo, ${(state.user?.nome || 'usuário').split(' ')[0]}!`, 'success');
    refreshCartBadge();
    handleRoute();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

// Enter key on password
document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-login-submit').click();
});

// Register submit
document.getElementById('btn-register-submit').addEventListener('click', async () => {
  const nome          = document.getElementById('register-nome').value.trim();
  const email         = document.getElementById('register-email').value.trim();
  const senha         = document.getElementById('register-senha').value;
  const dataNascimento= document.getElementById('register-dob').value;
  const errEl         = document.getElementById('register-error');
  const succEl        = document.getElementById('register-success');
  const btn           = document.getElementById('btn-register-submit');

  errEl.classList.add('hidden');
  succEl.classList.add('hidden');

  if (!nome || !email || !senha || !dataNascimento) {
    errEl.textContent = 'Preencha todos os campos.'; errEl.classList.remove('hidden'); return;
  }
  if (senha.length < 8) {
    errEl.textContent = 'Senha deve ter pelo menos 8 caracteres.'; errEl.classList.remove('hidden'); return;
  }

  btn.disabled = true; btn.textContent = 'Criando conta...';
  try {
    await api.register({ nome, email, senha, dataNascimento });
    succEl.textContent = 'Conta criada com sucesso! Faça login.';
    succEl.classList.remove('hidden');
    // Switch to login tab
    setTimeout(() => {
      document.querySelector('.auth-tab[data-tab="login"]').click();
      document.getElementById('login-email').value = email;
    }, 1200);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Criar conta';
  }
});

// Logout
document.getElementById('btn-logout').addEventListener('click', () => {
  clearAuth();
  state.wishlistIds.clear();
  updateCartBadge(0);
  toast('Sessão encerrada.', 'info');
  navigate('store');
});

// ── Nav links ──
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    const view = link.dataset.view;
    if (view) { e.preventDefault(); navigate(view); }
  });
});

// ── Game detail modal ──
document.getElementById('btn-game-close').addEventListener('click', () => closeModal('game'));

// ── Checkout ──
document.getElementById('btn-checkout').addEventListener('click', openCheckout);
document.getElementById('btn-checkout-close').addEventListener('click', () => closeModal('checkout'));
document.getElementById('btn-confirm-checkout').addEventListener('click', confirmCheckout);

document.querySelectorAll('.payment-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedPayment = btn.dataset.method;
  });
});

// ── Success modal ──
document.getElementById('btn-success-close').addEventListener('click', () => {
  closeModal('success');
  navigate('history');
});

// ── Close modals on overlay click ──
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ── ESC to close modals ──
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  }
});

// ── Logo link ──
document.querySelector('.logo').addEventListener('click', (e) => {
  e.preventDefault();
  navigate('store');
});

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════

function init() {
  updateUserUI();
  if (state.token) refreshCartBadge();
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

init();
