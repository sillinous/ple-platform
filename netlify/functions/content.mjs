/**
 * PLE Platform - Content API
 * Content management with editorial workflow, versioning, and tags
 */

import { getDb, getCurrentUser, logActivity, jsonResponse } from './lib/db.mjs';
import { v4 as uuidv4 } from 'uuid';

export default async (req, context) => {
  const url = new URL(req.url);
  
  try {
    const sql = await getDb();
    const user = await getCurrentUser(req);

    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      const action = url.searchParams.get('action');
      if (action === 'versions' && id) return await getVersionHistory(sql, id);
      return id ? await getContent(sql, id, user) : await listContent(sql, url.searchParams, user);
    }

    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    if (req.method === 'POST') {
      const action = url.searchParams.get('action');
      if (action === 'submit') return await submitForReview(sql, await req.json(), user);
      if (action === 'approve') return await approveContent(sql, await req.json(), user);
      if (action === 'publish') return await publishContent(sql, await req.json(), user);
      return await createContent(sql, await req.json(), user);
    }
    if (req.method === 'PUT') {
      return await updateContent(sql, await req.json(), user);
    }
    if (req.method === 'DELETE') {
      return await deleteContent(sql, url.searchParams.get('id'), user);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Content API error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
};

async function listContent(sql, params, user) {
  const status = params.get('status') || null;
  const type = params.get('type') || null;
  const author = params.get('author') || null;
  const visibility = params.get('visibility') || null;
  const projectId = params.get('projectId') || null;
  const limit = Math.min(parseInt(params.get('limit') || '50'), 100);
  const offset = parseInt(params.get('offset') || '0');

  let authorFilter = null;
  if (author === 'me' && user) authorFilter = user.id;
  else if (author) authorFilter = author;

  // Build visibility filter - if not logged in, only show published public content
  const content = await sql`
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar,
           p.title as project_title
    FROM content_items c
    LEFT JOIN users u ON c.author_id = u.id
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE (${status}::text IS NULL OR c.status = ${status})
      AND (${type}::text IS NULL OR c.content_type = ${type})
      AND (${authorFilter}::uuid IS NULL OR c.author_id = ${authorFilter}::uuid)
      AND (${visibility}::text IS NULL OR c.visibility = ${visibility})
      AND (${projectId}::uuid IS NULL OR c.project_id = ${projectId}::uuid)
      AND (
        c.status = 'published' AND c.visibility = 'public'
        OR ${user?.id}::uuid IS NOT NULL
      )
    ORDER BY c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*) as total FROM content_items c
    WHERE (${status}::text IS NULL OR c.status = ${status})
      AND (${type}::text IS NULL OR c.content_type = ${type})
      AND (c.status = 'published' AND c.visibility = 'public' OR ${user?.id}::uuid IS NOT NULL)
  `;

  // Fetch tags for all content items in batch
  const contentIds = content.map(c => c.id);
  let tagMap = {};
  if (contentIds.length > 0) {
    const allTags = await sql`
      SELECT ct.content_id, t.name FROM content_tags ct
      JOIN tags t ON ct.tag_id = t.id
      WHERE ct.content_id = ANY(${contentIds})
    `;
    for (const row of allTags) {
      if (!tagMap[row.content_id]) tagMap[row.content_id] = [];
      tagMap[row.content_id].push(row.name);
    }
  }

  return jsonResponse({
    content: content.map(c => ({ ...formatContent(c), tags: tagMap[c.id] || [] })),
    total: parseInt(countResult[0]?.total || 0),
    limit, offset
  });
}

async function getContent(sql, id, user) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const content = isUuid
    ? await sql`SELECT c.*, u.display_name as author_name, u.email as author_email, u.avatar_url as author_avatar,
           r.display_name as reviewer_name, p.title as project_title
      FROM content_items c LEFT JOIN users u ON c.author_id = u.id LEFT JOIN users r ON c.reviewer_id = r.id LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.id = ${id}::uuid`
    : await sql`SELECT c.*, u.display_name as author_name, u.email as author_email, u.avatar_url as author_avatar,
           r.display_name as reviewer_name, p.title as project_title
      FROM content_items c LEFT JOIN users u ON c.author_id = u.id LEFT JOIN users r ON c.reviewer_id = r.id LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.slug = ${id}`;

  if (content.length === 0) return jsonResponse({ error: 'Content not found' }, 404);
  const item = content[0];

  // Check access
  if (item.status !== 'published' && item.visibility !== 'public') {
    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);
  }

  // Get tags
  const tags = await sql`
    SELECT t.name FROM tags t
    JOIN content_tags ct ON t.id = ct.tag_id
    WHERE ct.content_id = ${item.id}
  `;

  // Get version count
  const versionCount = await sql`SELECT COUNT(*) as count FROM content_versions WHERE content_id = ${item.id}`;

  // Get comments
  const comments = await sql`
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM comments c LEFT JOIN users u ON c.author_id = u.id
    WHERE c.entity_type = 'content' AND c.entity_id = ${item.id} AND c.status = 'active'
    ORDER BY c.created_at
  `;

  return jsonResponse({
    content: formatContent(item),
    tags: tags.map(t => t.name),
    versionCount: parseInt(versionCount[0]?.count || 0),
    comments
  });
}

async function createContent(sql, body, user) {
  const { title, content_type = 'article', body: contentBody, excerpt, visibility = 'internal', project_id, tags = [] } = body;

  if (!title || !contentBody) return jsonResponse({ error: 'Title and body are required' }, 400);

  const id = uuidv4();
  const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = await sql`SELECT slug FROM content_items WHERE slug LIKE ${baseSlug + '%'}`;
  const slug = existing.length > 0 ? `${baseSlug}-${existing.length + 1}` : baseSlug;

  await sql`
    INSERT INTO content_items (id, title, slug, content_type, body, excerpt, status, visibility, author_id, project_id, version)
    VALUES (${id}, ${title}, ${slug}, ${content_type}, ${contentBody}, ${excerpt || null}, 'draft', ${visibility}, ${user.id}, ${project_id || null}, 1)
  `;

  // Handle tags
  if (tags.length > 0) {
    for (const tagName of tags) {
      const tagSlug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const tagResult = await sql`
        INSERT INTO tags (name, slug) VALUES (${tagName}, ${tagSlug})
        ON CONFLICT (name) DO UPDATE SET name = tags.name
        RETURNING id
      `;
      await sql`INSERT INTO content_tags (content_id, tag_id) VALUES (${id}, ${tagResult[0].id}) ON CONFLICT DO NOTHING`;
    }
  }

  await logActivity(user.id, 'content_created', 'content', id, { title, content_type });

  return jsonResponse({ success: true, id, slug }, 201);
}

async function updateContent(sql, body, user) {
  const { id, title, body: contentBody, excerpt, visibility } = body;
  if (!id) return jsonResponse({ error: 'Content ID is required' }, 400);

  const existing = await sql`SELECT * FROM content_items WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Content not found' }, 404);
  
  const item = existing[0];
  if (item.author_id !== user.id && user.role !== 'admin' && user.role !== 'editor') {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }

  // Save version before updating
  await sql`
    INSERT INTO content_versions (content_id, version_number, title, body, changed_by)
    VALUES (${id}, ${item.version}, ${item.title}, ${item.body}, ${user.id})
  `;

  await sql`
    UPDATE content_items SET 
      title = COALESCE(${title || null}, title),
      body = COALESCE(${contentBody || null}, body),
      excerpt = COALESCE(${excerpt || null}, excerpt),
      visibility = COALESCE(${visibility || null}, visibility),
      version = version + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `;

  await logActivity(user.id, 'content_updated', 'content', id);

  return jsonResponse({ success: true });
}

async function submitForReview(sql, body, user) {
  const { id } = body;
  if (!id) return jsonResponse({ error: 'Content ID is required' }, 400);

  const existing = await sql`SELECT author_id, status FROM content_items WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Content not found' }, 404);
  if (existing[0].author_id !== user.id) return jsonResponse({ error: 'Not authorized' }, 403);
  if (existing[0].status !== 'draft') return jsonResponse({ error: 'Can only submit drafts' }, 400);

  await sql`UPDATE content_items SET status = 'in_review', updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await logActivity(user.id, 'content_submitted', 'content', id);

  return jsonResponse({ success: true });
}

async function approveContent(sql, body, user) {
  const { id } = body;
  if (!id) return jsonResponse({ error: 'Content ID is required' }, 400);
  if (user.role !== 'admin' && user.role !== 'editor') {
    return jsonResponse({ error: 'Editor or admin role required' }, 403);
  }

  const existing = await sql`SELECT status FROM content_items WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Content not found' }, 404);
  if (existing[0].status !== 'in_review') return jsonResponse({ error: 'Can only approve content in review' }, 400);

  await sql`UPDATE content_items SET status = 'approved', reviewer_id = ${user.id}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await logActivity(user.id, 'content_approved', 'content', id);

  return jsonResponse({ success: true });
}

async function publishContent(sql, body, user) {
  const { id } = body;
  if (!id) return jsonResponse({ error: 'Content ID is required' }, 400);

  const existing = await sql`SELECT author_id, status FROM content_items WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Content not found' }, 404);
  
  const item = existing[0];
  const canPublish = item.author_id === user.id || user.role === 'admin' || user.role === 'editor';
  if (!canPublish) return jsonResponse({ error: 'Not authorized' }, 403);
  if (item.status !== 'approved' && user.role !== 'admin') {
    return jsonResponse({ error: 'Can only publish approved content' }, 400);
  }

  await sql`UPDATE content_items SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await logActivity(user.id, 'content_published', 'content', id);

  return jsonResponse({ success: true });
}

async function deleteContent(sql, id, user) {
  if (!id) return jsonResponse({ error: 'Content ID is required' }, 400);

  const existing = await sql`SELECT author_id, title FROM content_items WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Content not found' }, 404);
  if (existing[0].author_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }

  await sql`UPDATE content_items SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await logActivity(user.id, 'content_archived', 'content', id, { title: existing[0].title });

  return jsonResponse({ success: true });
}

function formatContent(c) {
  return {
    id: c.id, title: c.title, slug: c.slug, 
    contentType: c.content_type, body: c.body, excerpt: c.excerpt,
    status: c.status, visibility: c.visibility, version: c.version,
    author: { id: c.author_id, name: c.author_name, avatar: c.author_avatar },
    reviewer: c.reviewer_id ? { id: c.reviewer_id, name: c.reviewer_name } : null,
    project: c.project_id ? { id: c.project_id, title: c.project_title } : null,
    featuredImage: c.featured_image,
    publishedAt: c.published_at, createdAt: c.created_at, updatedAt: c.updated_at
  };
}

async function getVersionHistory(sql, contentId) {
  const versions = await sql`
    SELECT cv.id, cv.version_number, cv.title, cv.change_summary,
           cv.created_at, u.display_name as editor_name
    FROM content_versions cv
    LEFT JOIN users u ON cv.edited_by = u.id
    WHERE cv.content_id = ${contentId}
    ORDER BY cv.version_number DESC
  `;
  return jsonResponse({ versions });
}

export const config = { path: '/api/content' };
