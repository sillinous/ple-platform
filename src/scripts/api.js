/**
 * PLE Platform - Client API Module
 * Handles all API interactions and auth state
 */

// Auth state
let currentUser = null;
let authToken = localStorage.getItem('ple_token');

// API Base
const API_BASE = '/api';

// ============================================
// HTTP Client
// ============================================

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    
    return data;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
}

// ============================================
// Auth API
// ============================================

export const auth = {
  async register(email, password, displayName) {
    const data = await apiRequest('/auth?action=register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName })
    });
    
    if (data.token) {
      authToken = data.token;
      localStorage.setItem('ple_token', data.token);
      currentUser = data.user;
    }
    
    return data;
  },
  
  async login(email, password) {
    const data = await apiRequest('/auth?action=login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    if (data.token) {
      authToken = data.token;
      localStorage.setItem('ple_token', data.token);
      currentUser = data.user;
    }
    
    return data;
  },
  
  async logout() {
    try {
      await apiRequest('/auth?action=logout', { method: 'POST' });
    } catch (e) {
      // Ignore errors on logout
    }
    
    authToken = null;
    currentUser = null;
    localStorage.removeItem('ple_token');
  },
  
  async getCurrentUser() {
    if (!authToken) return null;
    
    try {
      const data = await apiRequest('/auth?action=me');
      currentUser = data.user;
      return data.user;
    } catch (e) {
      // Token invalid, clear it
      authToken = null;
      currentUser = null;
      localStorage.removeItem('ple_token');
      return null;
    }
  },
  
  isLoggedIn() {
    return !!authToken;
  },
  
  getUser() {
    return currentUser;
  }
};

// ============================================
// Proposals API
// ============================================

export const proposals = {
  async list(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/proposals${query ? '?' + query : ''}`);
  },
  
  async get(id) {
    return apiRequest(`/proposals?id=${id}`);
  },
  
  async create(data) {
    return apiRequest('/proposals', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  
  async update(id, data) {
    return apiRequest('/proposals', {
      method: 'PUT',
      body: JSON.stringify({ id, ...data })
    });
  },
  
  async delete(id) {
    return apiRequest(`/proposals?id=${id}`, { method: 'DELETE' });
  }
};

// ============================================
// Architecture API
// ============================================

export const architecture = {
  async list(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/architecture${query ? '?' + query : ''}`);
  },
  
  async get(id) {
    return apiRequest(`/architecture?id=${id}`);
  },
  
  async getByCode(code) {
    return apiRequest(`/architecture?code=${code}`);
  }
};

// ============================================
// Votes API
// ============================================

export const votes = {
  async get(proposalId) {
    return apiRequest(`/votes?proposalId=${proposalId}`);
  },
  
  async cast(proposalId, voteType, comment = null) {
    return apiRequest('/votes', {
      method: 'POST',
      body: JSON.stringify({ proposalId, voteType, comment })
    });
  },
  
  async remove(proposalId) {
    return apiRequest(`/votes?proposalId=${proposalId}`, { method: 'DELETE' });
  }
};

// ============================================
// Discussions API
// ============================================

export const discussions = {
  async list(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/discussions${query ? '?' + query : ''}`);
  },
  
  async get(id) {
    return apiRequest(`/discussions?id=${id}`);
  },
  
  async create(data) {
    return apiRequest('/discussions', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },
  
  async update(id, content) {
    return apiRequest('/discussions', {
      method: 'PUT',
      body: JSON.stringify({ id, content })
    });
  },
  
  async delete(id) {
    return apiRequest(`/discussions?id=${id}`, { method: 'DELETE' });
  }
};

// ============================================
// Activity API
// ============================================

export const activity = {
  async list(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/activity${query ? '?' + query : ''}`);
  }
};

// ============================================
// UI Helpers
// ============================================

export function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  
  // Less than 1 minute
  if (diff < 60000) return 'Just now';
  
  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  }
  
  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  
  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
  
  // Default to formatted date
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// Page Initialization
// ============================================

export async function initPage() {
  // Try to get current user
  if (authToken) {
    await auth.getCurrentUser();
  }
  
  // Update UI based on auth state
  updateAuthUI();
  
  // Initialize Lucide icons if available
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Mobile: close nav menu when clicking a link
  const navMenu = document.querySelector('.nav-menu');
  if (navMenu) {
    navMenu.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => navMenu.classList.remove('open'));
    });
    document.addEventListener('click', (e) => {
      if (navMenu.classList.contains('open') && !navMenu.contains(e.target) && !e.target.closest('.nav-toggle')) {
        navMenu.classList.remove('open');
      }
    });
  }

  // Dark mode toggle
  const savedTheme = localStorage.getItem('ple_theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  if (!document.querySelector('.dark-toggle')) {
    const btn = document.createElement('button');
    btn.className = 'dark-toggle';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
      localStorage.setItem('ple_theme', isDark ? '' : 'dark');
      btn.textContent = isDark ? '🌙' : '☀️';
    });
    document.body.appendChild(btn);
  }

  // Focus trap for modals
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { modal.classList.remove('active'); return; }
      if (e.key !== 'Tab') return;
      const focusable = modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });

  // ARIA: label nav
  document.querySelectorAll('nav, .nav-container').forEach(n => { if(!n.getAttribute('aria-label')) n.setAttribute('aria-label', 'Main navigation'); });
  document.querySelectorAll('main, .main-content, [id="main-content"]').forEach(m => m.setAttribute('role', 'main'));

  // Notification bell for logged-in users
  if (auth.isLoggedIn() && !document.querySelector('.notif-bell')) {
    const bell = document.createElement('div');
    bell.className = 'notif-bell';
    bell.setAttribute('aria-label', 'Notifications');
    bell.innerHTML = '🔔<span class="notif-badge" style="display:none">0</span>';
    bell.style.cssText = 'position:fixed;bottom:1.5rem;right:4rem;width:36px;height:36px;border-radius:50%;border:1px solid var(--border-color,#ddd);background:var(--bg-secondary,white);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:999;font-size:1rem;transition:all 0.2s;';
    const badge = bell.querySelector('.notif-badge');
    badge.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#EF4444;color:white;font-size:0.6rem;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;';
    
    // Notification dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'notif-dropdown';
    dropdown.style.cssText = 'display:none;position:fixed;bottom:4.5rem;right:1.5rem;width:340px;max-height:400px;background:white;border:1px solid var(--border-color,#ddd);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);z-index:1000;overflow:hidden;';
    dropdown.innerHTML = '<div style="padding:0.75rem 1rem;border-bottom:1px solid var(--border-color,#eee);display:flex;justify-content:space-between;align-items:center"><strong style="font-size:0.9rem">Notifications</strong><button onclick="markAllRead()" style="background:none;border:none;color:var(--color-horizon,#1B4D3E);font-size:0.75rem;cursor:pointer">Mark all read</button></div><div class="notif-list" style="max-height:340px;overflow-y:auto;padding:0.25rem 0"></div>';
    
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      if (dropdown.style.display === 'block') loadNotifications(dropdown.querySelector('.notif-list'), badge);
    });
    document.addEventListener('click', () => { dropdown.style.display = 'none'; });
    dropdown.addEventListener('click', e => e.stopPropagation());
    
    document.body.appendChild(bell);
    document.body.appendChild(dropdown);
    
    // Check for unread on page load
    checkUnread(badge);
    
    window.markAllRead = function() {
      localStorage.setItem('ple_notif_read', new Date().toISOString());
      badge.style.display = 'none';
      document.querySelectorAll('.notif-item.unread').forEach(n => n.classList.remove('unread'));
    };
  }
}

async function checkUnread(badge) {
  try {
    const lastRead = localStorage.getItem('ple_notif_read') || '2000-01-01';
    const token = localStorage.getItem('ple_token');
    if (!token) return;
    const r = await fetch('/api/activity?limit=10', { headers: { 'Authorization': `Bearer ${token}` } });
    const d = await r.json();
    const unread = (d.activities || []).filter(a => new Date(a.createdAt) > new Date(lastRead)).length;
    if (unread > 0) { badge.textContent = unread > 9 ? '9+' : unread; badge.style.display = 'flex'; }
    else { badge.style.display = 'none'; }
  } catch(e) {}
}

async function loadNotifications(container, badge) {
  try {
    const lastRead = localStorage.getItem('ple_notif_read') || '2000-01-01';
    const token = localStorage.getItem('ple_token');
    const r = await fetch('/api/activity?limit=15', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
    const d = await r.json();
    const acts = d.activities || [];
    if (!acts.length) { container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem">No recent activity</div>'; return; }
    const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    const links = { content: 'content-view.html?id=', project: 'project-view.html?id=', proposal: 'proposal-view.html?id=', discussion: 'discussion-view.html?id=' };
    container.innerHTML = acts.map(a => {
      const isUnread = new Date(a.createdAt) > new Date(lastRead);
      const href = links[a.entityType] ? links[a.entityType] + a.entityId : 'activity.html';
      const ago = fmtRelative(a.createdAt);
      return `<a href="${href}" class="notif-item ${isUnread ? 'unread' : ''}" style="display:block;padding:0.6rem 1rem;text-decoration:none;color:inherit;border-bottom:1px solid var(--border-color,#f0ede8);${isUnread ? 'background:rgba(27,77,62,0.04);' : ''}">
        <div style="font-size:0.83rem;line-height:1.4;color:var(--text-primary)">${esc(a.description)}</div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.15rem">${ago}</div>
      </a>`;
    }).join('') + '<a href="activity.html" style="display:block;padding:0.6rem 1rem;text-align:center;font-size:0.8rem;color:var(--color-horizon,#1B4D3E);text-decoration:none">View all activity →</a>';
  } catch(e) { container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted);font-size:0.85rem">Unable to load</div>'; }
}

function fmtRelative(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function updateAuthUI() {
  const authLinks = document.querySelectorAll('[data-auth]');
  const isLoggedIn = auth.isLoggedIn();
  const user = auth.getUser();
  
  authLinks.forEach(el => {
    const authType = el.dataset.auth;
    
    if (authType === 'logged-in') {
      el.style.display = isLoggedIn ? '' : 'none';
    } else if (authType === 'logged-out') {
      el.style.display = isLoggedIn ? 'none' : '';
    }
  });
  
  // Update user name displays
  if (user) {
    document.querySelectorAll('[data-user-name]').forEach(el => {
      el.textContent = user.displayName;
    });
    document.querySelectorAll('[data-user-email]').forEach(el => {
      el.textContent = user.email;
    });
  }
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

// Export everything as default for convenience
export default {
  auth,
  proposals,
  architecture,
  votes,
  discussions,
  activity,
  formatDate,
  escapeHtml,
  showToast,
  initPage,
  updateAuthUI
};
