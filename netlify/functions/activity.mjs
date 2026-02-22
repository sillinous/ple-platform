import { getDb, jsonResponse } from './lib/db.mjs';

export default async (req, context) => {
  const url = new URL(req.url);
  
  try {
    if (req.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }
    
    const sql = await getDb();
    
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const userId = url.searchParams.get('userId') || null;
    const entityType = url.searchParams.get('entityType') || null;
    
    let activities;
    try {
      activities = await sql`
        SELECT a.*, u.display_name as user_name, u.avatar_url as user_avatar,
          COALESCE(
            (SELECT title FROM proposals WHERE id = a.entity_id AND a.entity_type = 'proposal'),
            (SELECT title FROM discussions WHERE id = a.entity_id AND a.entity_type = 'discussion'),
            (SELECT title FROM tasks WHERE id = a.entity_id AND a.entity_type = 'task'),
            (SELECT title FROM projects WHERE id = a.entity_id AND a.entity_type = 'project'),
            (SELECT title FROM content_items WHERE id = a.entity_id AND a.entity_type = 'content')
          ) as entity_title
        FROM activity_log a LEFT JOIN users u ON a.user_id = u.id
        WHERE (${userId}::uuid IS NULL OR a.user_id = ${userId}::uuid)
          AND (${entityType}::text IS NULL OR a.entity_type = ${entityType})
        ORDER BY a.created_at DESC 
        LIMIT ${limit} OFFSET ${offset}
      `;
    } catch(e) {
      // Fallback without entity title lookups
      activities = await sql`
        SELECT a.*, u.display_name as user_name, u.avatar_url as user_avatar
        FROM activity_log a LEFT JOIN users u ON a.user_id = u.id
        WHERE (${userId}::uuid IS NULL OR a.user_id = ${userId}::uuid)
          AND (${entityType}::text IS NULL OR a.entity_type = ${entityType})
        ORDER BY a.created_at DESC 
        LIMIT ${limit} OFFSET ${offset}
      `;
    }
    
    return jsonResponse({
      activities: activities.map(a => ({
        id: a.id,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        details: a.details || {},
        user: a.user_id ? { id: a.user_id, name: a.user_name, avatar: a.user_avatar } : null,
        createdAt: a.created_at,
        description: formatActivityDescription(a)
      })),
      limit, offset
    });
  } catch (error) {
    console.error('Activity API error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
};

function formatActivityDescription(activity) {
  const userName = activity.user_name || 'Someone';
  const details = activity.details || {};
  const entityTitle = activity.entity_title || details.title || '';
  const quoted = entityTitle ? `: "${entityTitle}"` : '';
  
  const descriptions = {
    'user_registered': `${userName} joined the community`,
    'user_login': `${userName} signed in`,
    'proposal_created': `${userName} created a proposal${quoted}`,
    'proposal_updated': `${userName} updated a proposal${quoted}`,
    'proposal_deleted': `${userName} deleted a proposal`,
    'vote_cast': `${userName} voted ${details.voteType || ''} on a proposal${quoted}`,
    'vote_removed': `${userName} removed their vote`,
    'discussion_created': `${userName} started a discussion${quoted}`,
    'reply_created': `${userName} replied to a discussion${quoted}`,
    'element_created': `${userName} created an architecture element`,
    'element_updated': `${userName} updated an architecture element`,
    'content_created': `${userName} drafted${quoted}`,
    'content_updated': `${userName} updated${quoted || ' content'}`,
    'content_submitted': `${userName} submitted${quoted} for review`,
    'content_approved': `${userName} approved${quoted}`,
    'content_published': `${userName} published${quoted}`,
    'content_archived': `${userName} archived${quoted || ' content'}`,
    'task_created': `${userName} created a task${quoted}`,
    'task_updated': `${userName} updated a task${quoted}`,
    'task_moved': `${userName} moved${quoted || ' a task'} to ${details.status || 'a new status'}`,
    'task_deleted': `${userName} removed a task`,
    'milestone_created': `${userName} created a milestone${quoted}`,
    'milestone_updated': `${userName} updated a milestone${quoted}`,
    'project_created': `${userName} created a project${quoted}`,
    'project_updated': `${userName} updated a project${quoted}`,
    'project_archived': `${userName} archived a project${quoted}`,
    'commented': `${userName} commented on ${details.entity_type || 'an item'}`,
    'replied': `${userName} replied to a comment`,
    'created': `${userName} created a ${details.name ? 'group: "' + details.name + '"' : 'working group'}`,
    'updated': `${userName} updated a working group`,
    'joined': `${userName} joined ${details.group_name || 'a working group'}`,
    'left': `${userName} left a working group`,
    'added_member': `${userName} added a member to a working group`,
    'content_published': `${userName} published${quoted || ' new content'}`,
    'discussion_started': `${userName} started a discussion${quoted}`,
    'proposal_created': `${userName} submitted a proposal${quoted}`,
    'proposal_voted': `${userName} voted on a proposal${quoted}`,
    'auto_ingest_run': `Auto-ingest discovered new content`
  };
  
  return descriptions[activity.action] || `${userName} performed an action`;
}

export const config = { path: '/api/activity' };
