import { neon } from '@netlify/neon';

const sql = neon();

export default async (req, context) => {
  const url = new URL(req.url);
  
  try {
    if (req.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }
    
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const userId = url.searchParams.get('userId');
    const entityType = url.searchParams.get('entityType');
    
    let query = `
      SELECT a.*, u.display_name as user_name, u.avatar_url as user_avatar
      FROM activity_log a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (userId) {
      query += ` AND a.user_id = $${paramIndex++}`;
      params.push(userId);
    }
    
    if (entityType) {
      query += ` AND a.entity_type = $${paramIndex++}`;
      params.push(entityType);
    }
    
    query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const activities = await sql(query, params);
    
    return jsonResponse({
      activities: activities.map(a => ({
        id: a.id,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        details: a.details || {},
        user: a.user_id ? {
          id: a.user_id,
          name: a.user_name,
          avatar: a.user_avatar
        } : null,
        createdAt: a.created_at,
        // Generate human-readable description
        description: formatActivityDescription(a)
      })),
      limit,
      offset
    });
  } catch (error) {
    console.error('Activity API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

function formatActivityDescription(activity) {
  const userName = activity.user_name || 'Someone';
  const details = activity.details || {};
  
  switch (activity.action) {
    case 'user_registered':
      return `${userName} joined the community`;
    case 'user_login':
      return `${userName} signed in`;
    case 'proposal_created':
      return `${userName} created a new proposal: "${details.title || 'Untitled'}"`;
    case 'proposal_updated':
      return `${userName} updated a proposal`;
    case 'proposal_deleted':
      return `${userName} deleted a proposal`;
    case 'vote_cast':
      return `${userName} voted ${details.voteType || ''} on a proposal`;
    case 'vote_removed':
      return `${userName} removed their vote`;
    case 'discussion_created':
      return `${userName} started a new discussion`;
    case 'reply_created':
      return `${userName} replied to a discussion`;
    case 'element_created':
      return `${userName} created a new architecture element`;
    case 'element_updated':
      return `${userName} updated an architecture element`;
    default:
      return `${userName} performed an action`;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  path: '/api/activity'
};
