import { neon } from '@netlify/neon';
import { v4 as uuidv4 } from 'uuid';

const sql = neon();

export default async (req, context) => {
  const url = new URL(req.url);
  const method = req.method;
  
  try {
    // Get current user if authenticated
    const user = await getCurrentUser(req);
    
    if (method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        return await getProposal(id);
      }
      return await listProposals(url.searchParams);
    }
    
    // All write operations require auth
    if (!user) {
      return jsonResponse({ error: 'Authentication required' }, 401);
    }
    
    if (method === 'POST') {
      const body = await req.json();
      return await createProposal(body, user);
    }
    
    if (method === 'PUT') {
      const body = await req.json();
      return await updateProposal(body, user);
    }
    
    if (method === 'DELETE') {
      const id = url.searchParams.get('id');
      return await deleteProposal(id, user);
    }
    
    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Proposals API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

async function listProposals(params) {
  const status = params.get('status');
  const type = params.get('type');
  const limit = Math.min(parseInt(params.get('limit') || '20'), 100);
  const offset = parseInt(params.get('offset') || '0');
  
  let query = `
    SELECT p.*, u.display_name as author_name, u.avatar_url as author_avatar,
           (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'approve') as approve_count,
           (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'reject') as reject_count,
           (SELECT COUNT(*) FROM discussions WHERE proposal_id = p.id) as comment_count
    FROM proposals p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE 1=1
  `;
  const queryParams = [];
  let paramIndex = 1;
  
  if (status) {
    query += ` AND p.status = $${paramIndex++}`;
    queryParams.push(status);
  }
  
  if (type) {
    query += ` AND p.proposal_type = $${paramIndex++}`;
    queryParams.push(type);
  }
  
  query += ` ORDER BY p.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  queryParams.push(limit, offset);
  
  const proposals = await sql(query, queryParams);
  
  // Get total count
  let countQuery = 'SELECT COUNT(*) as total FROM proposals WHERE 1=1';
  const countParams = [];
  let countIndex = 1;
  
  if (status) {
    countQuery += ` AND status = $${countIndex++}`;
    countParams.push(status);
  }
  if (type) {
    countQuery += ` AND proposal_type = $${countIndex++}`;
    countParams.push(type);
  }
  
  const countResult = await sql(countQuery, countParams);
  const total = parseInt(countResult[0]?.total || 0);
  
  return jsonResponse({
    proposals: proposals.map(formatProposal),
    total,
    limit,
    offset
  });
}

async function getProposal(id) {
  const proposals = await sql(`
    SELECT p.*, u.display_name as author_name, u.avatar_url as author_avatar,
           ae.title as element_title, ae.code as element_code,
           (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'approve') as approve_count,
           (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'reject') as reject_count
    FROM proposals p
    LEFT JOIN users u ON p.author_id = u.id
    LEFT JOIN architecture_elements ae ON p.element_id = ae.id
    WHERE p.id = $1
  `, [id]);
  
  if (proposals.length === 0) {
    return jsonResponse({ error: 'Proposal not found' }, 404);
  }
  
  // Get comments
  const comments = await sql(`
    SELECT d.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM discussions d
    LEFT JOIN users u ON d.author_id = u.id
    WHERE d.proposal_id = $1
    ORDER BY d.created_at ASC
  `, [id]);
  
  return jsonResponse({
    proposal: formatProposal(proposals[0]),
    comments: comments.map(formatComment)
  });
}

async function createProposal(body, user) {
  const { title, content, proposalType, elementId } = body;
  
  if (!title || !content || !proposalType) {
    return jsonResponse({ error: 'Title, content, and proposal type are required' }, 400);
  }
  
  const validTypes = ['new_element', 'modify_element', 'deprecate_element', 'policy', 'process', 'general'];
  if (!validTypes.includes(proposalType)) {
    return jsonResponse({ error: 'Invalid proposal type' }, 400);
  }
  
  const id = uuidv4();
  
  await sql(`
    INSERT INTO proposals (id, title, content, proposal_type, author_id, element_id, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'draft')
  `, [id, title, content, proposalType, user.id, elementId || null]);
  
  // Log activity
  await logActivity(user.id, 'proposal_created', 'proposal', id, { title, proposalType });
  
  return jsonResponse({ success: true, id }, 201);
}

async function updateProposal(body, user) {
  const { id, title, content, status } = body;
  
  if (!id) {
    return jsonResponse({ error: 'Proposal ID is required' }, 400);
  }
  
  // Check ownership or admin
  const proposals = await sql('SELECT author_id, status FROM proposals WHERE id = $1', [id]);
  if (proposals.length === 0) {
    return jsonResponse({ error: 'Proposal not found' }, 404);
  }
  
  const proposal = proposals[0];
  if (proposal.author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized to edit this proposal' }, 403);
  }
  
  // Build update query
  const updates = [];
  const params = [];
  let paramIndex = 1;
  
  if (title) {
    updates.push(`title = $${paramIndex++}`);
    params.push(title);
  }
  if (content) {
    updates.push(`content = $${paramIndex++}`);
    params.push(content);
  }
  if (status && user.role === 'admin') {
    updates.push(`status = $${paramIndex++}`);
    params.push(status);
  }
  
  if (updates.length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }
  
  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);
  
  await sql(`UPDATE proposals SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);
  
  await logActivity(user.id, 'proposal_updated', 'proposal', id);
  
  return jsonResponse({ success: true });
}

async function deleteProposal(id, user) {
  if (!id) {
    return jsonResponse({ error: 'Proposal ID is required' }, 400);
  }
  
  const proposals = await sql('SELECT author_id FROM proposals WHERE id = $1', [id]);
  if (proposals.length === 0) {
    return jsonResponse({ error: 'Proposal not found' }, 404);
  }
  
  if (proposals[0].author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized to delete this proposal' }, 403);
  }
  
  await sql('DELETE FROM proposals WHERE id = $1', [id]);
  
  await logActivity(user.id, 'proposal_deleted', 'proposal', id);
  
  return jsonResponse({ success: true });
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

function formatProposal(p) {
  return {
    id: p.id,
    title: p.title,
    content: p.content,
    proposalType: p.proposal_type,
    status: p.status,
    author: {
      id: p.author_id,
      name: p.author_name,
      avatar: p.author_avatar
    },
    element: p.element_id ? {
      id: p.element_id,
      title: p.element_title,
      code: p.element_code
    } : null,
    votes: {
      approve: parseInt(p.approve_count || 0),
      reject: parseInt(p.reject_count || 0)
    },
    commentCount: parseInt(p.comment_count || 0),
    votingStarts: p.voting_starts,
    votingEnds: p.voting_ends,
    createdAt: p.created_at,
    updatedAt: p.updated_at
  };
}

function formatComment(c) {
  return {
    id: c.id,
    content: c.content,
    author: {
      id: c.author_id,
      name: c.author_name,
      avatar: c.author_avatar
    },
    createdAt: c.created_at
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  path: '/api/proposals'
};
