import { neon } from '@netlify/neon';
import { v4 as uuidv4 } from 'uuid';

const sql = neon();

export default async (req, context) => {
  const url = new URL(req.url);
  const method = req.method;
  
  try {
    const user = await getCurrentUser(req);
    
    if (method === 'GET') {
      const proposalId = url.searchParams.get('proposalId');
      if (!proposalId) {
        return jsonResponse({ error: 'Proposal ID required' }, 400);
      }
      return await getVotes(proposalId, user);
    }
    
    if (!user) {
      return jsonResponse({ error: 'Authentication required' }, 401);
    }
    
    if (method === 'POST') {
      const body = await req.json();
      return await castVote(body, user);
    }
    
    if (method === 'DELETE') {
      const proposalId = url.searchParams.get('proposalId');
      return await removeVote(proposalId, user);
    }
    
    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('Voting API error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
};

async function getVotes(proposalId, user) {
  // Get vote counts
  const counts = await sql(`
    SELECT 
      COUNT(*) FILTER (WHERE vote_type = 'approve') as approve_count,
      COUNT(*) FILTER (WHERE vote_type = 'reject') as reject_count,
      COUNT(*) FILTER (WHERE vote_type = 'abstain') as abstain_count
    FROM votes
    WHERE proposal_id = $1
  `, [proposalId]);
  
  // Get user's vote if authenticated
  let userVote = null;
  if (user) {
    const votes = await sql(
      'SELECT vote_type, comment FROM votes WHERE proposal_id = $1 AND user_id = $2',
      [proposalId, user.id]
    );
    if (votes.length > 0) {
      userVote = {
        type: votes[0].vote_type,
        comment: votes[0].comment
      };
    }
  }
  
  // Get recent votes with comments
  const recentVotes = await sql(`
    SELECT v.vote_type, v.comment, v.created_at, 
           u.display_name as user_name, u.avatar_url as user_avatar
    FROM votes v
    JOIN users u ON v.user_id = u.id
    WHERE v.proposal_id = $1 AND v.comment IS NOT NULL AND v.comment != ''
    ORDER BY v.created_at DESC
    LIMIT 10
  `, [proposalId]);
  
  return jsonResponse({
    counts: {
      approve: parseInt(counts[0]?.approve_count || 0),
      reject: parseInt(counts[0]?.reject_count || 0),
      abstain: parseInt(counts[0]?.abstain_count || 0)
    },
    userVote,
    recentVotes: recentVotes.map(v => ({
      type: v.vote_type,
      comment: v.comment,
      user: {
        name: v.user_name,
        avatar: v.user_avatar
      },
      createdAt: v.created_at
    }))
  });
}

async function castVote(body, user) {
  const { proposalId, voteType, comment } = body;
  
  if (!proposalId || !voteType) {
    return jsonResponse({ error: 'Proposal ID and vote type required' }, 400);
  }
  
  const validTypes = ['approve', 'reject', 'abstain'];
  if (!validTypes.includes(voteType)) {
    return jsonResponse({ error: 'Invalid vote type' }, 400);
  }
  
  // Check proposal exists and is open for voting
  const proposals = await sql(
    'SELECT id, status, voting_starts, voting_ends FROM proposals WHERE id = $1',
    [proposalId]
  );
  
  if (proposals.length === 0) {
    return jsonResponse({ error: 'Proposal not found' }, 404);
  }
  
  const proposal = proposals[0];
  if (proposal.status !== 'voting' && proposal.status !== 'open') {
    return jsonResponse({ error: 'Proposal is not open for voting' }, 400);
  }
  
  // Upsert vote
  await sql(`
    INSERT INTO votes (id, proposal_id, user_id, vote_type, comment)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (proposal_id, user_id) 
    DO UPDATE SET vote_type = $4, comment = $5, created_at = CURRENT_TIMESTAMP
  `, [uuidv4(), proposalId, user.id, voteType, comment || null]);
  
  // Log activity
  await logActivity(user.id, 'vote_cast', 'proposal', proposalId, { voteType });
  
  // Return updated counts
  return getVotes(proposalId, user);
}

async function removeVote(proposalId, user) {
  if (!proposalId) {
    return jsonResponse({ error: 'Proposal ID required' }, 400);
  }
  
  await sql(
    'DELETE FROM votes WHERE proposal_id = $1 AND user_id = $2',
    [proposalId, user.id]
  );
  
  await logActivity(user.id, 'vote_removed', 'proposal', proposalId);
  
  return jsonResponse({ success: true });
}

// Helper functions (same as other files)
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
  path: '/api/votes'
};
