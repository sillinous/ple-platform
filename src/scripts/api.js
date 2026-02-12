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
