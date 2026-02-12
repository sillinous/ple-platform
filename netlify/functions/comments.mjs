/**
 * PLE Platform - Comments API
 * Generic comments that can attach to any entity (projects, tasks, content, etc.)
 */

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split('/').filter(Boolean);
  const commentId = pathParts[2]; // /api/comments/:id

  try {
    const db = await getDb();
    const user = await getCurrentUser(req);

    // GET /api/comments - List comments for entity
    if (method === 'GET' && !commentId) {
      return await listComments(db, url);
    }

    // GET /api/comments/:id - Get single comment with replies
    if (method === 'GET' && commentId) {
      return await getComment(db, commentId);
    }

    // Authenticated routes
    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    // POST /api/comments - Create comment
    if (method === 'POST' && !commentId) {
      return await createComment(db, req, user);
    }

    // PUT /api/comments/:id - Update comment
    if (method === 'PUT' && commentId) {
      return await updateComment(db, commentId, req, user);
    }

    // DELETE /api/comments/:id - Delete comment
    if (method === 'DELETE' && commentId) {
      return await deleteComment(db, commentId, user);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Comments API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// List comments for an entity
async function listComments(db, url) {
  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  const includeReplies = url.searchParams.get('include_replies') !== 'false';

  if (!entityType || !entityId) {
    return jsonResponse({ error: 'entity_type and entity_id are required' }, 400);
  }

  // Get top-level comments
  let comments = await db`
    SELECT c.*, 
           u.display_name as author_name,
           u.avatar_url as author_avatar,
           (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id AND r.status = 'active') as reply_count
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.entity_type = ${entityType} 
      AND c.entity_id = ${entityId}
      AND c.parent_id IS NULL
      AND c.status = 'active'
    ORDER BY c.created_at DESC
  `;

  // If including replies, fetch them as nested structure
  if (includeReplies) {
    const commentIds = comments.map(c => c.id);
    if (commentIds.length > 0) {
      const replies = await db`
        SELECT c.*, 
               u.display_name as author_name,
               u.avatar_url as author_avatar
        FROM comments c
        LEFT JOIN users u ON c.author_id = u.id
        WHERE c.parent_id = ANY(${commentIds}) AND c.status = 'active'
        ORDER BY c.created_at ASC
      `;

      // Nest replies under their parent comments
      const replyMap = {};
      replies.forEach(reply => {
        if (!replyMap[reply.parent_id]) {
          replyMap[reply.parent_id] = [];
        }
        replyMap[reply.parent_id].push(reply);
      });

      comments = comments.map(comment => ({
        ...comment,
        replies: replyMap[comment.id] || []
      }));
    }
  }

  return jsonResponse({ comments });
}

// Get single comment with replies
async function getComment(db, commentId) {
  const comments = await db`
    SELECT c.*, 
           u.display_name as author_name,
           u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.id = ${commentId}
  `;

  if (comments.length === 0) {
    return jsonResponse({ error: 'Comment not found' }, 404);
  }

  const comment = comments[0];

  // Get replies
  const replies = await db`
    SELECT c.*, 
           u.display_name as author_name,
           u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.parent_id = ${commentId} AND c.status = 'active'
    ORDER BY c.created_at ASC
  `;

  return jsonResponse({
    ...comment,
    replies
  });
}

// Create comment
async function createComment(db, req, user) {
  const body = await req.json();
  const {
    entity_type,
    entity_id,
    body: commentBody,
    parent_id
  } = body;

  if (!entity_type || !entity_id || !commentBody) {
    return jsonResponse({ error: 'entity_type, entity_id, and body are required' }, 400);
  }

  // Validate entity type
  const validEntityTypes = ['project', 'task', 'content', 'proposal', 'discussion', 'working_group'];
  if (!validEntityTypes.includes(entity_type)) {
    return jsonResponse({ error: 'Invalid entity type' }, 400);
  }

  // If replying, verify parent exists
  if (parent_id) {
    const parent = await db`SELECT * FROM comments WHERE id = ${parent_id}`;
    if (parent.length === 0) {
      return jsonResponse({ error: 'Parent comment not found' }, 404);
    }
  }

  const result = await db`
    INSERT INTO comments (entity_type, entity_id, author_id, body, parent_id)
    VALUES (${entity_type}, ${entity_id}, ${user.id}, ${commentBody}, ${parent_id || null})
    RETURNING *
  `;

  const comment = result[0];

  // Get author info
  const author = await db`SELECT display_name, avatar_url FROM users WHERE id = ${user.id}`;

  await logActivity(user.id, parent_id ? 'replied' : 'commented', entity_type, entity_id, {
    comment_id: comment.id
  });

  return jsonResponse({
    ...comment,
    author_name: author[0]?.display_name,
    author_avatar: author[0]?.avatar_url
  }, 201);
}

// Update comment
async function updateComment(db, commentId, req, user) {
  const body = await req.json();

  const existing = await db`SELECT * FROM comments WHERE id = ${commentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Comment not found' }, 404);
  }

  const comment = existing[0];

  // Only author or admin can edit
  if (comment.author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  if (!body.body) {
    return jsonResponse({ error: 'Body is required' }, 400);
  }

  const result = await db`
    UPDATE comments 
    SET body = ${body.body}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${commentId}
    RETURNING *
  `;

  return jsonResponse(result[0]);
}

// Delete comment (soft delete)
async function deleteComment(db, commentId, user) {
  const existing = await db`SELECT * FROM comments WHERE id = ${commentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Comment not found' }, 404);
  }

  const comment = existing[0];

  // Only author or admin can delete
  if (comment.author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  await db`
    UPDATE comments 
    SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${commentId}
  `;

  // Also soft-delete replies
  await db`
    UPDATE comments 
    SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
    WHERE parent_id = ${commentId}
  `;

  return jsonResponse({ success: true, message: 'Comment deleted' });
}

export const config = {
  path: "/api/comments/*"
};
