/**
 * PLE Platform - Projects API
 * Full project management with lifecycle, linking, and progress tracking
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
      return id ? await getProject(sql, id, user) : await listProjects(sql, url.searchParams, user);
    }

    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    if (req.method === 'POST') {
      return await createProject(sql, await req.json(), user);
    }
    if (req.method === 'PUT') {
      return await updateProject(sql, await req.json(), user);
    }
    if (req.method === 'DELETE') {
      return await deleteProject(sql, url.searchParams.get('id'), user);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Projects API error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
};

async function listProjects(sql, params, user) {
  const status = params.get('status') || null;
  const type = params.get('type') || null;
  const limit = Math.min(parseInt(params.get('limit') || '50'), 100);
  const offset = parseInt(params.get('offset') || '0');
  const isLoggedIn = !!user;

  const projects = await sql`
    SELECT p.*, 
           u.display_name as owner_name,
           u.avatar_url as owner_avatar,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as completed_tasks,
           (SELECT COUNT(*) FROM milestones m WHERE m.project_id = p.id) as milestone_count,
           (SELECT COUNT(*) FROM working_groups wg WHERE wg.project_id = p.id) as team_count
    FROM projects p
    LEFT JOIN users u ON p.owner_id = u.id
    WHERE (${status}::text IS NULL OR p.status = ${status})
      AND (${type}::text IS NULL OR p.project_type = ${type})
      AND (p.visibility = 'public' OR ${isLoggedIn})
    ORDER BY 
      CASE p.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END,
      p.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*) as total FROM projects p
    WHERE (${status}::text IS NULL OR p.status = ${status})
      AND (${type}::text IS NULL OR p.project_type = ${type})
      AND (p.visibility = 'public' OR ${isLoggedIn})
  `;

  return jsonResponse({
    projects: projects.map(formatProject),
    total: parseInt(countResult[0]?.total || 0),
    limit, offset
  });
}

async function getProject(sql, id, user) {
  // Determine if id looks like a UUID
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  
  let projects;
  if (isUuid) {
    projects = await sql`
      SELECT p.*, 
             u.display_name as owner_name,
             u.email as owner_email,
             u.avatar_url as owner_avatar,
             prop.title as linked_proposal_title
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      LEFT JOIN proposals prop ON p.linked_proposal_id = prop.id
      WHERE p.id = ${id}::uuid
    `;
  } else {
    projects = await sql`
      SELECT p.*, 
             u.display_name as owner_name,
             u.email as owner_email,
             u.avatar_url as owner_avatar,
             prop.title as linked_proposal_title
      FROM projects p
      LEFT JOIN users u ON p.owner_id = u.id
      LEFT JOIN proposals prop ON p.linked_proposal_id = prop.id
      WHERE p.slug = ${id}
    `;
  }

  if (projects.length === 0) {
    return jsonResponse({ error: 'Project not found' }, 404);
  }

  const project = projects[0];

  if (project.visibility !== 'public' && !user) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const milestones = await sql`
    SELECT m.*, 
           (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id) as task_count,
           (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status = 'done') as completed_tasks
    FROM milestones m
    WHERE m.project_id = ${project.id}
    ORDER BY m.order_index, m.target_date
  `;

  const taskStats = await sql`
    SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ${project.id} GROUP BY status
  `;

  const recentTasks = await sql`
    SELECT t.*, u.display_name as assignee_name
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.project_id = ${project.id}
    ORDER BY t.updated_at DESC LIMIT 10
  `;

  const workingGroups = await sql`
    SELECT wg.*, u.display_name as lead_name,
           (SELECT COUNT(*) FROM working_group_members wgm WHERE wgm.group_id = wg.id AND wgm.left_at IS NULL) as member_count
    FROM working_groups wg LEFT JOIN users u ON wg.lead_id = u.id
    WHERE wg.project_id = ${project.id}
  `;

  const activity = await sql`
    SELECT al.*, u.display_name as user_name
    FROM activity_log al LEFT JOIN users u ON al.user_id = u.id
    WHERE al.entity_type = 'project' AND al.entity_id = ${project.id}
    ORDER BY al.created_at DESC LIMIT 20
  `;

  return jsonResponse({
    project: formatProject(project),
    milestones, taskStats: taskStats.reduce((acc, s) => ({ ...acc, [s.status]: parseInt(s.count) }), {}),
    recentTasks, workingGroups, activity
  });
}

async function createProject(sql, body, user) {
  const { title, description, project_type = 'initiative', visibility = 'members',
    priority = 'medium', linked_proposal_id, linked_elements = [], start_date, target_end_date } = body;

  if (!title) return jsonResponse({ error: 'Title is required' }, 400);

  const id = uuidv4();
  const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existing = await sql`SELECT slug FROM projects WHERE slug LIKE ${baseSlug + '%'}`;
  const slug = existing.length > 0 ? `${baseSlug}-${existing.length + 1}` : baseSlug;
  const linkedElementsJson = JSON.stringify(linked_elements);

  await sql`
    INSERT INTO projects (id, title, slug, description, project_type, status, visibility, priority,
      owner_id, linked_proposal_id, linked_elements, start_date, target_end_date)
    VALUES (${id}, ${title}, ${slug}, ${description || null}, ${project_type}, 'draft', ${visibility}, ${priority},
      ${user.id}, ${linked_proposal_id || null}, ${linkedElementsJson}::jsonb, ${start_date || null}, ${target_end_date || null})
  `;

  await logActivity(user.id, 'project_created', 'project', id, { title });
  return jsonResponse({ success: true, id, slug }, 201);
}

async function updateProject(sql, body, user) {
  const { id, title, description, status, visibility, priority, progress } = body;
  if (!id) return jsonResponse({ error: 'Project ID is required' }, 400);

  const projects = await sql`SELECT owner_id FROM projects WHERE id = ${id}`;
  if (projects.length === 0) return jsonResponse({ error: 'Project not found' }, 404);
  if (projects[0].owner_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }

  await sql`
    UPDATE projects SET title = COALESCE(${title || null}, title), description = COALESCE(${description || null}, description),
      status = COALESCE(${status || null}, status), visibility = COALESCE(${visibility || null}, visibility),
      priority = COALESCE(${priority || null}, priority), progress = COALESCE(${progress || null}, progress),
      updated_at = CURRENT_TIMESTAMP WHERE id = ${id}
  `;

  await logActivity(user.id, 'project_updated', 'project', id);
  return jsonResponse({ success: true });
}

async function deleteProject(sql, id, user) {
  if (!id) return jsonResponse({ error: 'Project ID is required' }, 400);

  const projects = await sql`SELECT owner_id, title FROM projects WHERE id = ${id}`;
  if (projects.length === 0) return jsonResponse({ error: 'Project not found' }, 404);
  if (projects[0].owner_id !== user.id && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }

  await sql`UPDATE projects SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await logActivity(user.id, 'project_archived', 'project', id, { title: projects[0].title });
  return jsonResponse({ success: true });
}

function formatProject(p) {
  return {
    id: p.id, title: p.title, slug: p.slug, description: p.description,
    projectType: p.project_type, status: p.status, visibility: p.visibility,
    priority: p.priority, progress: parseInt(p.progress || 0),
    owner: { id: p.owner_id, name: p.owner_name, avatar: p.owner_avatar },
    linkedProposalId: p.linked_proposal_id, linkedElements: p.linked_elements || [],
    startDate: p.start_date, targetEndDate: p.target_end_date, actualEndDate: p.actual_end_date,
    taskCount: parseInt(p.task_count || 0), completedTasks: parseInt(p.completed_tasks || 0),
    milestoneCount: parseInt(p.milestone_count || 0), teamCount: parseInt(p.team_count || 0),
    createdAt: p.created_at, updatedAt: p.updated_at
  };
}

export const config = { path: '/api/projects' };
