import { neon } from '@netlify/neon';
import { v4 as uuidv4 } from 'uuid';

const sql = neon();

export default async (req, context) => {
  const url = new URL(req.url);
  const method = req.method;
  
  try {
    const user = await getCurrentUser(req);
    
    if (method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        return await getDiscussion(id);
      }
      return await listDiscussions(url.searchParams);
    }
    
    if (!user) {
      return jsonResponse({ error: 'Authentication required' }, 401);
    }
    
    if (method === 'POST') {
      const body = await req.json();
      return await createDiscussion(body, user);
    }
    
    if (method === 'PUT') {
      const body = await req.json();
      return await updateDiscussion(body, user);
    }
    
    if (method === 'DELETE') {
      const id = url.searchParams.get('id');
      return await deleteDiscussion(id, user);
    }
    
    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Discussions API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

async function listDiscussions(params) {
  const proposalId = params.get('proposalId');
  const elementId = params.get('elementId');
  const type = params.get('type');
  const limit = Math.min(parseInt(params.get('limit') || '20'), 100);
  const offset = parseInt(params.get('offset') || '0');
  
  let query = `
    SELECT d.*, u.display_name as author_name, u.avatar_url as author_avatar,
           (SELECT COUNT(*) FROM discussions WHERE parent_id = d.id) as reply_count
    FROM discussions d
    LEFT JOIN users u ON d.author_id = u.id
    WHERE d.parent_id IS NULL
  `;
  const queryParams = [];
  let paramIndex = 1;
  
  if (proposalId) {
    query += ` AND d.proposal_id = $${paramIndex++}`;
    queryParams.push(proposalId);
  }
  
  if (elementId) {
    query += ` AND d.element_id = $${paramIndex++}`;
    queryParams.push(elementId);
  }
  
  if (type) {
    query += ` AND d.discussion_type = $${paramIndex++}`;
    queryParams.push(type);
  }
  
  query += ` AND d.status = 'active'`;
  query += ` ORDER BY d.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(limit, offset);
  
  const discussions = await sql(query, queryParams);
  
  return jsonResponse({
    discussions: discussions.map(formatDiscussion),
    limit,
    offset
  });
}

async function getDiscussion(id) {
  const discussions = await sql(`
    SELECT d.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM discussions d
    LEFT JOIN users u ON d.author_id = u.id
    WHERE d.id = $1
  `, [id]);
  
  if (discussions.length === 0) {
    return jsonResponse({ error: 'Discussion not found' }, 404);
  }
  
  // Get replies
  const replies = await sql(`
    SELECT d.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM discussions d
    LEFT JOIN users u ON d.author_id = u.id
    WHERE d.parent_id = $1 AND d.status = 'active'
    ORDER BY d.created_at ASC
  `, [id]);
  
  return jsonResponse({
    discussion: formatDiscussion(discussions[0]),
    replies: replies.map(formatDiscussion)
  });
}

async function createDiscussion(body, user) {
  const { title, content, proposalId, elementId, parentId, discussionType } = body;
  
  if (!content) {
    return jsonResponse({ error: 'Content is required' }, 400);
  }
  
  const id = uuidv4();
  
  await sql(`
    INSERT INTO discussions (id, title, content, author_id, proposal_id, element_id, parent_id, discussion_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    id, 
    title || null, 
    content, 
    user.id, 
    proposalId || null, 
    elementId || null, 
    parentId || null,
    discussionType || 'general'
  ]);
  
  // Log activity
  const action = parentId ? 'reply_created' : 'discussion_created';
  await logActivity(user.id, action, 'discussion', id, { proposalId, elementId });
  
  return jsonResponse({ success: true, id }, 201);
}

async function updateDiscussion(body, user) {
  const { id, content } = body;
  
  if (!id || !content) {
    return jsonResponse({ error: 'ID and content required' }, 400);
  }
  
  const discussions = await sql('SELECT author_id FROM discussions WHERE id = $1', [id]);
  if (discussions.length === 0) {
    return jsonResponse({ error: 'Discussion not found' }, 404);
  }
  
  if (discussions[0].author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }
  
  await sql(
    'UPDATE discussions SET content = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [content, id]
  );
  
  return jsonResponse({ success: true });
}

async function deleteDiscussion(id, user) {
  if (!id) {
    return jsonResponse({ error: 'Discussion ID required' }, 400);
  }
  
  const discussions = await sql('SELECT author_id FROM discussions WHERE id = $1', [id]);
  if (discussions.length === 0) {
    return jsonResponse({ error: 'Discussion not found' }, 404);
  }
  
  if (discussions[0].author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }
  
  // Soft delete
  await sql("UPDATE discussions SET status = 'deleted' WHERE id = $1", [id]);
  
  return jsonResponse({ success: true });
}

function formatDiscussion(d) {
  return {
    id: d.id,
    title: d.title,
    content: d.content,
    author: {
      id: d.author_id,
      name: d.author_name,
      avatar: d.author_avatar
    },
    proposalId: d.proposal_id,
    elementId: d.element_id,
    parentId: d.parent_id,
    type: d.discussion_type,
    status: d.status,
    replyCount: parseInt(d.reply_count || 0),
    createdAt: d.created_at,
    updatedAt: d.updated_at
  };
}

// Helper functions
async function getCurrentUser(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  const token = authHeader.slice(7);
  const tokenHash = await hashToken(token);
  
  const sessions = await sql(`
    SELECT u.id, u.email, u.display_name, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = true
  `, [tokenHash]);
  
  return sessions.length > 0 ? sessions[0] : null;
}

async function hashToken(token) {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
  path: '/api/discussions'
};
