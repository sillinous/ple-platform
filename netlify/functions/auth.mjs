import { getDb, hashToken, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export default async (req, context) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const sql = await getDb();
    
    if (req.method === 'POST') {
      const body = await req.json();
      
      if (action === 'register') {
        return await handleRegister(sql, body);
      } else if (action === 'login') {
        return await handleLogin(sql, body);
      } else if (action === 'logout') {
        return await handleLogout(sql, req);
      } else if (action === 'update-profile') {
        return await handleUpdateProfile(sql, req, body);
      }
    } else if (req.method === 'GET' && action === 'me') {
      return await handleGetCurrentUser(sql, req);
    } else if (req.method === 'GET' && action === 'profile') {
      return await handleGetPublicProfile(sql, url.searchParams.get('id'));
    } else if (req.method === 'GET' && action === 'members') {
      return await handleListMembers(sql);
    }
    
    return jsonResponse({ error: 'Invalid action' }, 400);
  } catch (error) {
    console.error('Auth error:', error);
    return jsonResponse({ 
      error: 'Internal server error',
      details: error.message
    }, 500);
  }
};

async function handleRegister(sql, { email, password, displayName }) {
  if (!email || !password || !displayName) {
    return jsonResponse({ error: 'Email, password, and display name are required' }, 400);
  }
  
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
  }
  
  const emailLower = email.toLowerCase();
  const existing = await sql`SELECT id FROM users WHERE email = ${emailLower}`;
  if (existing.length > 0) {
    return jsonResponse({ error: 'Email already registered' }, 409);
  }
  
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  const role = 'member';
  
  await sql`INSERT INTO users (id, email, password_hash, display_name, role) 
            VALUES (${userId}, ${emailLower}, ${passwordHash}, ${displayName}, ${role})`;
  
  const session = await createSession(sql, userId);
  await logActivity(userId, 'user_registered', 'user', userId);
  
  return jsonResponse({
    success: true,
    user: { id: userId, email: emailLower, displayName, role: 'member' },
    token: session.token
  }, 201);
}

async function handleLogin(sql, { email, password }) {
  if (!email || !password) {
    return jsonResponse({ error: 'Email and password are required' }, 400);
  }
  
  const emailLower = email.toLowerCase();
  const users = await sql`
    SELECT id, email, password_hash, display_name, role, is_active 
    FROM users WHERE email = ${emailLower}
  `;
  
  if (users.length === 0) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }
  
  const user = users[0];
  
  if (!user.is_active) {
    return jsonResponse({ error: 'Account is deactivated' }, 403);
  }
  
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }
  
  await sql`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ${user.id}`;
  
  const session = await createSession(sql, user.id);
  await logActivity(user.id, 'user_login', 'user', user.id);
  
  return jsonResponse({
    success: true,
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
    token: session.token
  });
}

async function handleLogout(sql, req) {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const tokenHash = await hashToken(token);
    await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
  }
  return jsonResponse({ success: true });
}

async function handleGetCurrentUser(sql, req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }
  
  const token = authHeader.slice(7);
  const tokenHash = await hashToken(token);
  
  const sessions = await sql`
    SELECT u.id, u.email, u.display_name, u.role, u.avatar_url, u.bio, u.created_at
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = true
  `;
  
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

async function createSession(sql, userId) {
  const token = uuidv4() + '-' + uuidv4();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  
  await sql`INSERT INTO sessions (user_id, token_hash, expires_at) 
            VALUES (${userId}, ${tokenHash}, ${expiresAt})`;
  
  return { token, expiresAt };
}

async function handleUpdateProfile(sql, req, body) {
  const user = await getCurrentUser(req);
  if (!user) return jsonResponse({ error: 'Authentication required' }, 401);
  
  const { displayName, bio } = body || {};
  if (!displayName?.trim()) return jsonResponse({ error: 'Display name is required' }, 400);
  
  await sql`UPDATE users SET display_name = ${displayName.trim()}, bio = ${(bio||'').trim()}, updated_at = CURRENT_TIMESTAMP WHERE id = ${user.id}`;
  
  return jsonResponse({ success: true, user: { ...user, displayName: displayName.trim(), bio: (bio||'').trim() } });
}

async function handleListMembers(sql) {
  const members = await sql`
    SELECT u.id, u.display_name, u.role, u.avatar_url, u.bio, u.created_at,
      (SELECT COUNT(*) FROM content_items WHERE author_id = u.id AND status = 'published') as content_count,
      (SELECT COUNT(*) FROM proposals WHERE author_id = u.id) as proposal_count,
      (SELECT COUNT(*) FROM discussions WHERE author_id = u.id AND parent_id IS NULL) as discussion_count
    FROM users u WHERE u.is_active = true
    ORDER BY u.created_at ASC
    LIMIT 100
  `;
  return jsonResponse({
    members: members.map(m => ({
      id: m.id, displayName: m.display_name, role: m.role,
      avatarUrl: m.avatar_url, bio: m.bio, createdAt: m.created_at,
      stats: { content: parseInt(m.content_count), proposals: parseInt(m.proposal_count), discussions: parseInt(m.discussion_count) }
    })),
    total: members.length
  });
}

async function handleGetPublicProfile(sql, userId) {
  if (!userId) return jsonResponse({ error: 'User ID required' }, 400);
  
  const users = await sql`SELECT id, display_name, role, avatar_url, bio, created_at FROM users WHERE id = ${userId} AND is_active = true`;
  if (users.length === 0) return jsonResponse({ error: 'User not found' }, 404);
  
  const u = users[0];
  const [contentCount, proposalCount, discussionCount] = await Promise.all([
    sql`SELECT COUNT(*) as c FROM content_items WHERE author_id = ${userId} AND status = 'published'`,
    sql`SELECT COUNT(*) as c FROM proposals WHERE author_id = ${userId}`,
    sql`SELECT COUNT(*) as c FROM discussions WHERE author_id = ${userId} AND parent_id IS NULL AND status = 'active'`
  ]);
  
  return jsonResponse({
    user: {
      id: u.id, displayName: u.display_name, role: u.role,
      avatarUrl: u.avatar_url, bio: u.bio, createdAt: u.created_at
    },
    stats: {
      content: parseInt(contentCount[0].c),
      proposals: parseInt(proposalCount[0].c),
      discussions: parseInt(discussionCount[0].c)
    }
  });
}

export const config = { path: '/api/auth' };
