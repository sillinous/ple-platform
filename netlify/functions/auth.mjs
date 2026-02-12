import { neon } from '@netlify/neon';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const sql = neon();

export default async (req, context) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    if (req.method === 'POST') {
      const body = await req.json();
      
      if (action === 'register') {
        return await handleRegister(body);
      } else if (action === 'login') {
        return await handleLogin(body);
      } else if (action === 'logout') {
        return await handleLogout(req);
      }
    } else if (req.method === 'GET' && action === 'me') {
      return await handleGetCurrentUser(req);
    }
    
    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (error) {
    console.error('Auth error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

async function handleRegister({ email, password, displayName }) {
  if (!email || !password || !displayName) {
    return jsonResponse({ error: 'Email, password, and display name are required' }, 400);
  }
  
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
  }
  
  // Check if user exists
  const existing = await sql('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.length > 0) {
    return jsonResponse({ error: 'Email already registered' }, 409);
  }
  
  // Hash password and create user
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  
  await sql(
    `INSERT INTO users (id, email, password_hash, display_name, role) 
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, email.toLowerCase(), passwordHash, displayName, 'member']
  );
  
  // Create session
  const session = await createSession(userId);
  
  // Log activity
  await logActivity(userId, 'user_registered', 'user', userId);
  
  return jsonResponse({
    success: true,
    user: { id: userId, email: email.toLowerCase(), displayName, role: 'member' },
    token: session.token
  }, 201);
}

async function handleLogin({ email, password }) {
  if (!email || !password) {
    return jsonResponse({ error: 'Email and password are required' }, 400);
  }
  
  // Find user
  const users = await sql(
    'SELECT id, email, password_hash, display_name, role, is_active FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  
  if (users.length === 0) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }
  
  const user = users[0];
  
  if (!user.is_active) {
    return jsonResponse({ error: 'Account is deactivated' }, 403);
  }
  
  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }
  
  // Update last login
  await sql('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
  
  // Create session
  const session = await createSession(user.id);
  
  // Log activity
  await logActivity(user.id, 'user_login', 'user', user.id);
  
  return jsonResponse({
    success: true,
    user: { 
      id: user.id, 
      email: user.email, 
      displayName: user.display_name, 
      role: user.role 
    },
    token: session.token
  });
}

async function handleLogout(req) {
  const token = getTokenFromRequest(req);
  if (token) {
    const tokenHash = await hashToken(token);
    await sql('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }
  return jsonResponse({ success: true });
}

async function handleGetCurrentUser(req) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }
  
  const tokenHash = await hashToken(token);
  const sessions = await sql(
    `SELECT u.id, u.email, u.display_name, u.role, u.avatar_url, u.bio, u.created_at
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = true`,
    [tokenHash]
  );
  
  if (sessions.length === 0) {
    return jsonResponse({ error: 'Session expired or invalid' }, 401);
  }
  
  const user = sessions[0];
  return jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      avatarUrl: user.avatar_url,
      bio: user.bio,
      createdAt: user.created_at
    }
  });
}

async function createSession(userId) {
  const token = uuidv4() + '-' + uuidv4(); // Long random token
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  await sql(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt.toISOString()]
  );
  
  return { token, expiresAt };
}

async function hashToken(token) {
  // Simple hash for token storage (not password-level security needed)
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

async function logActivity(userId, action, entityType, entityId, details = {}) {
  try {
    await sql(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) 
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, entityType, entityId, JSON.stringify(details)]
    );
  } catch (e) {
    console.error('Failed to log activity:', e);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  path: '/api/auth'
};
