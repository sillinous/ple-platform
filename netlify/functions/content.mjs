/**
 * PLE Platform - Content CMS API
 * Full content management with workflow, versioning, and publishing
 */

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathParts = url.pathname.split('/').filter(Boolean);
  const contentId = pathParts[2]; // /api/content/:id
  const action = pathParts[3]; // /api/content/:id/publish, /api/content/:id/versions

  try {
    const db = await getDb();
    const user = await getCurrentUser(req);

    // GET /api/content - List content
    if (method === 'GET' && !contentId) {
      return await listContent(db, url, user);
    }

    // GET /api/content/:id - Get single content item
    if (method === 'GET' && contentId && !action) {
      return await getContent(db, contentId, user);
    }

    // GET /api/content/:id/versions - Get version history
    if (method === 'GET' && contentId && action === 'versions') {
      return await getVersions(db, contentId, user);
    }

    // Authenticated routes
    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    // POST /api/content - Create content
    if (method === 'POST' && !contentId) {
      return await createContent(db, req, user);
    }

    // PUT /api/content/:id - Update content
    if (method === 'PUT' && contentId && !action) {
      return await updateContent(db, contentId, req, user);
    }

    // POST /api/content/:id/submit - Submit for review
    if (method === 'POST' && contentId && action === 'submit') {
      return await submitForReview(db, contentId, user);
    }

    // POST /api/content/:id/approve - Approve content
    if (method === 'POST' && contentId && action === 'approve') {
      return await approveContent(db, contentId, user);
    }

    // POST /api/content/:id/publish - Publish content
    if (method === 'POST' && contentId && action === 'publish') {
      return await publishContent(db, contentId, user);
    }

    // POST /api/content/:id/unpublish - Unpublish content
    if (method === 'POST' && contentId && action === 'unpublish') {
      return await unpublishContent(db, contentId, user);
    }

    // POST /api/content/:id/revert - Revert to version
    if (method === 'POST' && contentId && action === 'revert') {
      return await revertToVersion(db, contentId, req, user);
    }

    // DELETE /api/content/:id - Archive content
    if (method === 'DELETE' && contentId) {
      return await archiveContent(db, contentId, user);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Content API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

// List content with filtering
async function listContent(db, url, user) {
  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const visibility = url.searchParams.get('visibility');
  const author = url.searchParams.get('author');
  const projectId = url.searchParams.get('project_id');
  const tag = url.searchParams.get('tag');
  const search = url.searchParams.get('search');
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  let query = `
    SELECT c.*, 
           a.display_name as author_name,
           a.avatar_url as author_avatar,
           r.display_name as reviewer_name,
           p.title as project_title,
           p.slug as project_slug,
           (SELECT array_agg(t.name) FROM content_tags ct JOIN tags t ON ct.tag_id = t.id WHERE ct.content_id = c.id) as tags
    FROM content_items c
    LEFT JOIN users a ON c.author_id = a.id
    LEFT JOIN users r ON c.reviewer_id = r.id
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE 1=1
  `;

  const params = [];
  let paramIndex = 1;

  // Visibility filter based on auth
  if (!user) {
    query += ` AND c.visibility = 'public' AND c.status = 'published'`;
  } else if (visibility) {
    query += ` AND c.visibility = $${paramIndex++}`;
    params.push(visibility);
  }

  if (status) {
    if (status.includes(',')) {
      const statuses = status.split(',');
      query += ` AND c.status = ANY($${paramIndex++})`;
      params.push(statuses);
    } else {
      query += ` AND c.status = $${paramIndex++}`;
      params.push(status);
    }
  }

  if (type) {
    query += ` AND c.content_type = $${paramIndex++}`;
    params.push(type);
  }

  if (author) {
    if (author === 'me' && user) {
      query += ` AND c.author_id = $${paramIndex++}`;
      params.push(user.id);
    } else {
      query += ` AND c.author_id = $${paramIndex++}`;
      params.push(author);
    }
  }

  if (projectId) {
    query += ` AND c.project_id = $${paramIndex++}`;
    params.push(projectId);
  }

  if (tag) {
    query += ` AND EXISTS (
      SELECT 1 FROM content_tags ct 
      JOIN tags t ON ct.tag_id = t.id 
      WHERE ct.content_id = c.id AND t.slug = $${paramIndex++}
    )`;
    params.push(tag);
  }

  if (search) {
    query += ` AND (c.title ILIKE $${paramIndex} OR c.body ILIKE $${paramIndex} OR c.excerpt ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  query += ` ORDER BY c.updated_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);

  const content = await db.unsafe(query, params);

  // Get total count
  let countQuery = `SELECT COUNT(*) as total FROM content_items c WHERE 1=1`;
  if (!user) {
    countQuery += ` AND c.visibility = 'public' AND c.status = 'published'`;
  }
  const countResult = await db.unsafe(countQuery);
  const total = parseInt(countResult[0]?.total || 0);

  return jsonResponse({
    content,
    pagination: { total, limit, offset, hasMore: offset + content.length < total }
  });
}

// Get single content item
async function getContent(db, contentId, user) {
  const content = await db`
    SELECT c.*, 
           a.display_name as author_name,
           a.email as author_email,
           a.avatar_url as author_avatar,
           r.display_name as reviewer_name,
           p.title as project_title,
           p.slug as project_slug
    FROM content_items c
    LEFT JOIN users a ON c.author_id = a.id
    LEFT JOIN users r ON c.reviewer_id = r.id
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE c.id = ${contentId} OR c.slug = ${contentId}
  `;

  if (content.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const item = content[0];

  // Check visibility
  if (item.visibility !== 'public' && !user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  if (item.status !== 'published' && !user) {
    return jsonResponse({ error: 'Content not published' }, 404);
  }

  // Get tags
  const tags = await db`
    SELECT t.* FROM tags t
    JOIN content_tags ct ON t.id = ct.tag_id
    WHERE ct.content_id = ${item.id}
  `;

  // Get comments
  const comments = await db`
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.entity_type = 'content' AND c.entity_id = ${item.id} AND c.status = 'active'
    ORDER BY c.created_at
  `;

  // Get recent versions count
  const versionCount = await db`
    SELECT COUNT(*) as count FROM content_versions WHERE content_id = ${item.id}
  `;

  return jsonResponse({
    ...item,
    tags,
    comments,
    version_count: parseInt(versionCount[0]?.count || 0)
  });
}

// Get version history
async function getVersions(db, contentId, user) {
  if (!user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const versions = await db`
    SELECT cv.*, u.display_name as changed_by_name
    FROM content_versions cv
    LEFT JOIN users u ON cv.changed_by = u.id
    WHERE cv.content_id = ${contentId}
    ORDER BY cv.version_number DESC
  `;

  return jsonResponse({ versions });
}

// Create content
async function createContent(db, req, user) {
  const body = await req.json();
  const {
    title,
    content_type = 'article',
    body: contentBody,
    excerpt,
    visibility = 'internal',
    project_id,
    featured_image,
    tags = [],
    metadata = {}
  } = body;

  if (!title) {
    return jsonResponse({ error: 'Title is required' }, 400);
  }

  // Generate slug
  const baseSlug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const existing = await db`SELECT slug FROM content_items WHERE slug LIKE ${baseSlug + '%'}`;
  let slug = baseSlug;
  if (existing.length > 0) {
    slug = `${baseSlug}-${existing.length + 1}`;
  }

  const metadataJson = JSON.stringify(metadata);

  const result = await db`
    INSERT INTO content_items (
      title, slug, content_type, body, excerpt, status, visibility,
      author_id, project_id, featured_image, metadata
    ) VALUES (
      ${title}, ${slug}, ${content_type}, ${contentBody || ''}, ${excerpt || null},
      'draft', ${visibility}, ${user.id}, ${project_id || null}, 
      ${featured_image || null}, ${metadataJson}
    )
    RETURNING *
  `;

  const content = result[0];

  // Add tags
  if (tags.length > 0) {
    await addTags(db, content.id, tags);
  }

  await logActivity(user.id, 'created', 'content', content.id, { title, content_type });

  return jsonResponse(content, 201);
}

// Update content
async function updateContent(db, contentId, req, user) {
  const body = await req.json();

  const existing = await db`SELECT * FROM content_items WHERE id = ${contentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const content = existing[0];

  // Check permission
  if (content.author_id !== user.id && user.role !== 'admin' && user.role !== 'editor') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  // Save version before updating
  await db`
    INSERT INTO content_versions (content_id, version_number, title, body, changed_by, change_summary)
    VALUES (${content.id}, ${content.version}, ${content.title}, ${content.body}, ${user.id}, ${body.change_summary || 'Updated'})
  `;

  const allowedFields = [
    'title', 'body', 'excerpt', 'visibility', 'featured_image', 'project_id', 'metadata'
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0 && !body.tags) {
    return jsonResponse({ error: 'No valid fields to update' }, 400);
  }

  // Increment version
  updates.version = content.version + 1;

  // Build dynamic update
  const setClause = Object.keys(updates)
    .map((key, i) => {
      if (key === 'metadata') return `${key} = $${i + 1}::jsonb`;
      return `${key} = $${i + 1}`;
    })
    .join(', ');

  const values = Object.values(updates).map(v => 
    typeof v === 'object' ? JSON.stringify(v) : v
  );
  values.push(contentId);

  const query = `
    UPDATE content_items 
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $${values.length}
    RETURNING *
  `;

  const result = await db.unsafe(query, values);

  // Update tags if provided
  if (body.tags) {
    await db`DELETE FROM content_tags WHERE content_id = ${contentId}`;
    await addTags(db, contentId, body.tags);
  }

  await logActivity(user.id, 'updated', 'content', contentId, { 
    version: updates.version,
    fields: Object.keys(updates)
  });

  return jsonResponse(result[0]);
}

// Submit for review
async function submitForReview(db, contentId, user) {
  const existing = await db`SELECT * FROM content_items WHERE id = ${contentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const content = existing[0];

  if (content.author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  if (content.status !== 'draft') {
    return jsonResponse({ error: 'Only drafts can be submitted for review' }, 400);
  }

  const result = await db`
    UPDATE content_items 
    SET status = 'in_review', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${contentId}
    RETURNING *
  `;

  await logActivity(user.id, 'submitted_for_review', 'content', contentId, { title: content.title });

  return jsonResponse(result[0]);
}

// Approve content (reviewer/editor)
async function approveContent(db, contentId, user) {
  if (user.role !== 'admin' && user.role !== 'editor') {
    return jsonResponse({ error: 'Only editors can approve content' }, 403);
  }

  const existing = await db`SELECT * FROM content_items WHERE id = ${contentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const content = existing[0];

  if (content.status !== 'in_review') {
    return jsonResponse({ error: 'Only content in review can be approved' }, 400);
  }

  const result = await db`
    UPDATE content_items 
    SET status = 'approved', reviewer_id = ${user.id}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${contentId}
    RETURNING *
  `;

  await logActivity(user.id, 'approved', 'content', contentId, { title: content.title });

  return jsonResponse(result[0]);
}

// Publish content
async function publishContent(db, contentId, user) {
  const existing = await db`SELECT * FROM content_items WHERE id = ${contentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const content = existing[0];

  // Check permission
  const canPublish = user.role === 'admin' || user.role === 'editor' || 
    (content.author_id === user.id && content.status === 'approved');

  if (!canPublish) {
    return jsonResponse({ error: 'Permission denied or content not approved' }, 403);
  }

  const result = await db`
    UPDATE content_items 
    SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${contentId}
    RETURNING *
  `;

  await logActivity(user.id, 'published', 'content', contentId, { title: content.title });

  return jsonResponse(result[0]);
}

// Unpublish content
async function unpublishContent(db, contentId, user) {
  if (user.role !== 'admin' && user.role !== 'editor') {
    return jsonResponse({ error: 'Only editors can unpublish content' }, 403);
  }

  const existing = await db`SELECT * FROM content_items WHERE id = ${contentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const result = await db`
    UPDATE content_items 
    SET status = 'draft', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${contentId}
    RETURNING *
  `;

  await logActivity(user.id, 'unpublished', 'content', contentId, { title: existing[0].title });

  return jsonResponse(result[0]);
}

// Revert to previous version
async function revertToVersion(db, contentId, req, user) {
  const { version_number } = await req.json();

  const existing = await db`SELECT * FROM content_items WHERE id = ${contentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const content = existing[0];

  if (content.author_id !== user.id && user.role !== 'admin' && user.role !== 'editor') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  const version = await db`
    SELECT * FROM content_versions 
    WHERE content_id = ${contentId} AND version_number = ${version_number}
  `;

  if (version.length === 0) {
    return jsonResponse({ error: 'Version not found' }, 404);
  }

  const oldVersion = version[0];

  // Save current as new version
  await db`
    INSERT INTO content_versions (content_id, version_number, title, body, changed_by, change_summary)
    VALUES (${content.id}, ${content.version}, ${content.title}, ${content.body}, ${user.id}, 'Before revert')
  `;

  // Revert
  const result = await db`
    UPDATE content_items 
    SET title = ${oldVersion.title}, body = ${oldVersion.body}, 
        version = ${content.version + 1}, status = 'draft',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${contentId}
    RETURNING *
  `;

  await logActivity(user.id, 'reverted', 'content', contentId, { 
    to_version: version_number,
    from_version: content.version
  });

  return jsonResponse(result[0]);
}

// Archive content
async function archiveContent(db, contentId, user) {
  const existing = await db`SELECT * FROM content_items WHERE id = ${contentId}`;
  if (existing.length === 0) {
    return jsonResponse({ error: 'Content not found' }, 404);
  }

  const content = existing[0];

  if (content.author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Permission denied' }, 403);
  }

  await db`
    UPDATE content_items 
    SET status = 'archived', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${contentId}
  `;

  await logActivity(user.id, 'archived', 'content', contentId, { title: content.title });

  return jsonResponse({ success: true, message: 'Content archived' });
}

// Helper: Add tags to content
async function addTags(db, contentId, tagNames) {
  for (const tagName of tagNames) {
    const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    
    // Upsert tag
    let tag = await db`SELECT id FROM tags WHERE slug = ${slug}`;
    if (tag.length === 0) {
      const newTag = await db`
        INSERT INTO tags (name, slug) VALUES (${tagName}, ${slug})
        ON CONFLICT (slug) DO UPDATE SET name = ${tagName}
        RETURNING id
      `;
      tag = newTag;
    }

    // Link to content
    await db`
      INSERT INTO content_tags (content_id, tag_id) 
      VALUES (${contentId}, ${tag[0].id})
      ON CONFLICT DO NOTHING
    `;
  }
}

export const config = {
  path: "/api/content/*"
};
