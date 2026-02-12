/**
 * PLE Platform - Tasks API
 * Task management with Kanban workflow, assignments, and subtasks
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
      return id ? await getTask(sql, id) : await listTasks(sql, url.searchParams, user);
    }

    if (!user) return jsonResponse({ error: 'Authentication required' }, 401);

    if (req.method === 'POST') {
      const action = url.searchParams.get('action');
      if (action === 'move') return await moveTask(sql, await req.json(), user);
      return await createTask(sql, await req.json(), user);
    }
    if (req.method === 'PUT') {
      return await updateTask(sql, await req.json(), user);
    }
    if (req.method === 'DELETE') {
      return await deleteTask(sql, url.searchParams.get('id'), user);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Tasks API error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
};

async function listTasks(sql, params, user) {
  const projectId = params.get('projectId') || null;
  const milestoneId = params.get('milestoneId') || null;
  const status = params.get('status') || null;
  const assignee = params.get('assignedTo') || null;
  const view = params.get('view') || 'list';
  const limit = Math.min(parseInt(params.get('limit') || '100'), 200);
  const offset = parseInt(params.get('offset') || '0');

  let assigneeFilter = null;
  if (assignee === 'me' && user) assigneeFilter = user.id;
  else if (assignee && assignee !== 'unassigned') assigneeFilter = assignee;

  const tasks = await sql`
    SELECT t.*, p.title as project_title, p.slug as project_slug,
           u.display_name as assignee_name, u.avatar_url as assignee_avatar,
           creator.display_name as creator_name, m.title as milestone_title,
           (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) as subtask_count,
           (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id AND st.status = 'done') as completed_subtasks
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN milestones m ON t.milestone_id = m.id
    WHERE t.parent_task_id IS NULL
      AND (${projectId}::uuid IS NULL OR t.project_id = ${projectId}::uuid)
      AND (${milestoneId}::uuid IS NULL OR t.milestone_id = ${milestoneId}::uuid)
      AND (${status}::text IS NULL OR t.status = ${status})
      AND (${assigneeFilter}::uuid IS NULL OR t.assigned_to = ${assigneeFilter}::uuid)
      AND (${assignee} != 'unassigned' OR t.assigned_to IS NULL)
    ORDER BY t.order_index, t.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  if (view === 'kanban') {
    const columns = {
      backlog: tasks.filter(t => t.status === 'backlog').map(formatTask),
      todo: tasks.filter(t => t.status === 'todo').map(formatTask),
      in_progress: tasks.filter(t => t.status === 'in_progress').map(formatTask),
      review: tasks.filter(t => t.status === 'review').map(formatTask),
      done: tasks.filter(t => t.status === 'done').map(formatTask),
      blocked: tasks.filter(t => t.status === 'blocked').map(formatTask)
    };
    return jsonResponse({ view: 'kanban', columns });
  }

  return jsonResponse({ tasks: tasks.map(formatTask), view, limit, offset });
}

async function getTask(sql, id) {
  const tasks = await sql`
    SELECT t.*, p.title as project_title, p.slug as project_slug,
           u.display_name as assignee_name, u.email as assignee_email, u.avatar_url as assignee_avatar,
           creator.display_name as creator_name, m.title as milestone_title
    FROM tasks t
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN users creator ON t.created_by = creator.id
    LEFT JOIN milestones m ON t.milestone_id = m.id
    WHERE t.id = ${id}
  `;

  if (tasks.length === 0) return jsonResponse({ error: 'Task not found' }, 404);

  const subtasks = await sql`
    SELECT t.*, u.display_name as assignee_name
    FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.parent_task_id = ${id} ORDER BY t.order_index, t.created_at
  `;

  const comments = await sql`
    SELECT c.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM comments c LEFT JOIN users u ON c.author_id = u.id
    WHERE c.entity_type = 'task' AND c.entity_id = ${id} AND c.status = 'active'
    ORDER BY c.created_at
  `;

  return jsonResponse({ task: formatTask(tasks[0]), subtasks: subtasks.map(formatTask), comments });
}

async function createTask(sql, body, user) {
  const { project_id, milestone_id, title, description, status = 'backlog',
    priority = 'medium', assigned_to, parent_task_id, due_date, estimated_hours } = body;

  if (!project_id || !title) return jsonResponse({ error: 'Project ID and title are required' }, 400);

  const project = await sql`SELECT id FROM projects WHERE id = ${project_id}`;
  if (project.length === 0) return jsonResponse({ error: 'Project not found' }, 404);

  const maxOrder = await sql`
    SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM tasks 
    WHERE project_id = ${project_id} AND status = ${status}
  `;

  const id = uuidv4();
  await sql`
    INSERT INTO tasks (id, project_id, milestone_id, title, description, status, priority,
      assigned_to, parent_task_id, due_date, estimated_hours, order_index, created_by)
    VALUES (${id}, ${project_id}, ${milestone_id || null}, ${title}, ${description || null}, 
      ${status}, ${priority}, ${assigned_to || null}, ${parent_task_id || null},
      ${due_date || null}, ${estimated_hours || null}, ${maxOrder[0].next_order}, ${user.id})
  `;

  await logActivity(user.id, 'task_created', 'task', id, { title, project_id });
  if (assigned_to) await logActivity(user.id, 'task_assigned', 'task', id, { assigned_to });

  return jsonResponse({ success: true, id }, 201);
}

async function updateTask(sql, body, user) {
  const { id, title, description, status, priority, milestone_id, assigned_to, due_date } = body;
  if (!id) return jsonResponse({ error: 'Task ID is required' }, 400);

  const existing = await sql`SELECT * FROM tasks WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Task not found' }, 404);
  const task = existing[0];
  const oldStatus = task.status;

  await sql`
    UPDATE tasks SET 
      title = COALESCE(${title || null}, title),
      description = COALESCE(${description || null}, description),
      status = COALESCE(${status || null}, status),
      priority = COALESCE(${priority || null}, priority),
      milestone_id = COALESCE(${milestone_id || null}, milestone_id),
      assigned_to = COALESCE(${assigned_to || null}, assigned_to),
      due_date = COALESCE(${due_date || null}, due_date),
      updated_at = CURRENT_TIMESTAMP,
      completed_at = CASE WHEN ${status} = 'done' AND ${oldStatus} != 'done' THEN CURRENT_TIMESTAMP 
                         WHEN ${status} IS NOT NULL AND ${status} != 'done' THEN NULL 
                         ELSE completed_at END
    WHERE id = ${id}
  `;

  if (status && status !== oldStatus) {
    await logActivity(user.id, 'task_status_changed', 'task', id, { from: oldStatus, to: status });
  }

  await updateProjectProgress(sql, task.project_id);
  return jsonResponse({ success: true });
}

async function moveTask(sql, body, user) {
  const { id, status, order_index } = body;

  const existing = await sql`SELECT * FROM tasks WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Task not found' }, 404);
  const task = existing[0];
  const oldStatus = task.status;

  await sql`
    UPDATE tasks SET status = ${status}, order_index = ${order_index}, updated_at = CURRENT_TIMESTAMP,
      completed_at = CASE WHEN ${status} = 'done' AND ${oldStatus} != 'done' THEN CURRENT_TIMESTAMP 
                         WHEN ${status} != 'done' AND ${oldStatus} = 'done' THEN NULL ELSE completed_at END
    WHERE id = ${id}
  `;

  if (status !== oldStatus) {
    await logActivity(user.id, 'task_moved', 'task', id, { from: oldStatus, to: status });
  }

  await updateProjectProgress(sql, task.project_id);
  return jsonResponse({ success: true });
}

async function deleteTask(sql, id, user) {
  if (!id) return jsonResponse({ error: 'Task ID is required' }, 400);

  const existing = await sql`SELECT * FROM tasks WHERE id = ${id}`;
  if (existing.length === 0) return jsonResponse({ error: 'Task not found' }, 404);
  const task = existing[0];

  const project = await sql`SELECT owner_id FROM projects WHERE id = ${task.project_id}`;
  const isOwner = project.length > 0 && project[0].owner_id === user.id;
  const isCreator = task.created_by === user.id;

  if (!isOwner && !isCreator && user.role !== 'admin') {
    return jsonResponse({ error: 'Not authorized' }, 403);
  }

  await sql`DELETE FROM tasks WHERE id = ${id}`;
  await logActivity(user.id, 'task_deleted', 'task', id, { title: task.title });
  await updateProjectProgress(sql, task.project_id);

  return jsonResponse({ success: true });
}

async function updateProjectProgress(sql, projectId) {
  const stats = await sql`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'done') as completed
    FROM tasks WHERE project_id = ${projectId}
  `;
  const total = parseInt(stats[0].total) || 0;
  const completed = parseInt(stats[0].completed) || 0;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  await sql`UPDATE projects SET progress = ${progress}, updated_at = CURRENT_TIMESTAMP WHERE id = ${projectId}`;
}

function formatTask(t) {
  return {
    id: t.id, title: t.title, description: t.description,
    status: t.status, priority: t.priority,
    project: { id: t.project_id, title: t.project_title, slug: t.project_slug },
    milestone: t.milestone_id ? { id: t.milestone_id, title: t.milestone_title } : null,
    assignee: t.assigned_to ? { id: t.assigned_to, name: t.assignee_name, avatar: t.assignee_avatar } : null,
    creator: { id: t.created_by, name: t.creator_name },
    parentTaskId: t.parent_task_id,
    dueDate: t.due_date, estimatedHours: t.estimated_hours, actualHours: t.actual_hours,
    orderIndex: t.order_index,
    subtaskCount: parseInt(t.subtask_count || 0), completedSubtasks: parseInt(t.completed_subtasks || 0),
    createdAt: t.created_at, updatedAt: t.updated_at, completedAt: t.completed_at
  };
}

export const config = { path: '/api/tasks' };
