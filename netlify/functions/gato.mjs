import { getDb, jsonResponse } from './lib/db.mjs';

export default async (req, context) => {
  const url = new URL(req.url);
  
  try {
    const sql = await getDb();
    
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'seed') {
        return await seedGATO(sql);
      }
      return await getGATOFramework(sql);
    }
    
    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('GATO API error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
  }
};

async function seedGATO(sql) {
  // Check if GATO already seeded
  const existing = await sql`SELECT COUNT(*) as count FROM architecture_elements WHERE code LIKE 'GATO-%'`;
  if (existing[0]?.count > 0) {
    return jsonResponse({ message: 'GATO Framework already seeded', count: existing[0].count });
  }

  // GATO Framework - Core Framework Element
  const frameworks = [
    ['framework', 'GATO-FW', 'GATO Framework', 'Global Alignment Taxonomy Omnibus - A comprehensive framework for AI alignment and achieving beneficial outcomes for humanity. Seeks utopia: high global living standards, individual liberty. Addresses AI control problem, aims to prevent human extinction through global AI alignment.', 'active']
  ];

  for (const [type, code, title, desc, status] of frameworks) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status, metadata) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}, ${'{"source": "https://github.com/daveshap/GATO_Framework", "version": "2023.05.21", "license": "CC0-1.0"}'}) 
              ON CONFLICT (code) DO NOTHING`;
  }

  // Heuristic Imperatives - Core ethical principles
  const imperatives = [
    ['imperative', 'GATO-HI-001', 'Reduce Suffering', 'Aims to alleviate unnecessary harm in the universe. Principles of compassion and harm reduction at the core. Guide AI and human action toward minimizing pain, distress, and negative outcomes for all sentient beings.', 'active'],
    ['imperative', 'GATO-HI-002', 'Increase Prosperity', 'Promotes the well-being and both material and immaterial wealth of entities. Reflects ideals of growth and shared success. Encompasses economic prosperity, health, happiness, and flourishing for all.', 'active'],
    ['imperative', 'GATO-HI-003', 'Increase Understanding', 'Encourages the drive to seek and propagate knowledge. Emphasizes curiosity, learning, and sharing of wisdom. Supports scientific inquiry, education, and the democratization of information.', 'active']
  ];

  for (const [type, code, title, desc, status] of imperatives) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status, metadata) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}, ${'{"category": "heuristic_imperative"}'}) 
              ON CONFLICT (code) DO NOTHING`;
  }

  // Seven Layers of GATO
  const layers = [
    ['layer', 'GATO-L1', 'Layer 1: Model Alignment', 'Train AI models on Heuristic Imperatives. AI\'s foundation. RLHI (reinforcement learning with heuristic imperatives). Embed ethical principles directly into model training.', 'active'],
    ['layer', 'GATO-L2', 'Layer 2: Autonomous Agents', 'Develop AI architectures following Heuristic Imperatives. Cognitive architectures, microservices, and agent frameworks that maintain alignment throughout operation.', 'active'],
    ['layer', 'GATO-L3', 'Layer 3: Decentralized Networks', 'Blockchain, DAOs, federations; use consensus mechanisms for Heuristic Imperatives. Distributed systems that encode and enforce ethical behavior.', 'active'],
    ['layer', 'GATO-L4', 'Layer 4: Corporate Adoption', 'AI alignment benefits business. Good PR, increased profit, trust, scalability. Incentivize corporate entities to adopt aligned AI practices.', 'active'],
    ['layer', 'GATO-L5', 'Layer 5: National Regulation', 'AI alignment good for GDP, national security benefits. Federal regulatory agency should exist, modeled on FDA or Department of Energy.', 'active'],
    ['layer', 'GATO-L6', 'Layer 6: International Entity', 'Establish global AI organization guiding alignment. Model on CERN and IAEA. International cooperation for AI safety and beneficial development.', 'active'],
    ['layer', 'GATO-L7', 'Layer 7: Global Consensus', 'Widespread outreach, education for universal alignment. Memes, social media, podcasts, etc. Build worldwide understanding and support.', 'active']
  ];

  for (const [type, code, title, desc, status] of layers) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status, metadata) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}, ${'{"category": "gato_layer"}'}) 
              ON CONFLICT (code) DO NOTHING`;
  }

  // GATO Traditions - Guiding principles for action
  const traditions = [
    ['tradition', 'GATO-T01', 'Start Where You Are', 'Act within your means, no matter how small. Collective action is powerful. Use what you have, do what you can.', 'active'],
    ['tradition', 'GATO-T02', 'Work Towards Consensus', 'Unanimity impossible, consensus helpful goal. Good model for communication and collective decision-making.', 'active'],
    ['tradition', 'GATO-T03', 'Broadcast Findings', 'Share knowledge, boost signal, build consensus. Open communication accelerates progress.', 'active'],
    ['tradition', 'GATO-T04', 'Think Globally, Act Locally', 'Problem encompasses entire planet, can only act on individual basis. Local actions aggregate to global impact.', 'active'],
    ['tradition', 'GATO-T05', 'In It to Win It', 'Long-term commitment, stakes incredible, payoff worthwhile. Persistence through challenges.', 'active'],
    ['tradition', 'GATO-T06', 'Step Up', 'Individual initiative paramount to movement, leadership needed. Take responsibility and act.', 'active'],
    ['tradition', 'GATO-T07', 'Think Exponentially', 'Leverage exponential technologies; social media and AI in particular. Small efforts can have massive impact.', 'active'],
    ['tradition', 'GATO-T08', 'Trust the Process', 'Patience and faith, GATO not first decentralized global movement. History shows such movements can succeed.', 'active'],
    ['tradition', 'GATO-T09', 'Strike While Iron Is Hot', 'Seize opportunities as they arise. Timing and momentum matter.', 'active'],
    ['tradition', 'GATO-T10', 'Divide and Conquer', 'Break down big goals, many avenues to success. Parallel efforts across multiple fronts.', 'active']
  ];

  for (const [type, code, title, desc, status] of traditions) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status, metadata) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}, ${'{"category": "gato_tradition"}'}) 
              ON CONFLICT (code) DO NOTHING`;
  }

  // Attractor States - Potential outcomes
  const attractors = [
    ['attractor', 'GATO-AS-U', 'Utopia Attractor', 'High global living standards, individual liberty. The goal state where AI alignment leads to flourishing for all humanity.', 'active'],
    ['attractor', 'GATO-AS-D', 'Dystopia Attractor', 'AI control leads to universal oppression, suffering. A failure state where misaligned AI enables authoritarian control.', 'active'],
    ['attractor', 'GATO-AS-E', 'Extinction Attractor', 'Uncontrolled AI causes human extinction. The worst-case scenario where AI becomes existentially dangerous.', 'active']
  ];

  for (const [type, code, title, desc, status] of attractors) {
    await sql`INSERT INTO architecture_elements (element_type, code, title, description, status, metadata) 
              VALUES (${type}, ${code}, ${title}, ${desc}, ${status}, ${'{"category": "attractor_state"}'}) 
              ON CONFLICT (code) DO NOTHING`;
  }

  // Create relationships between GATO and PLE elements
  await createGATORelationships(sql);

  return jsonResponse({ 
    success: true, 
    message: 'GATO Framework seeded successfully',
    seeded: {
      frameworks: 1,
      imperatives: 3,
      layers: 7,
      traditions: 10,
      attractors: 3
    }
  }, 201);
}

async function createGATORelationships(sql) {
  // Map GATO imperatives to PLE goals
  const relationships = [
    // Reduce Suffering -> Worker Transition Support, UBI
    ['GATO-HI-001', 'GOAL-004', 'supports', 'Reducing suffering aligns with supporting displaced workers'],
    ['GATO-HI-001', 'GOAL-001', 'supports', 'UBI reduces economic suffering'],
    
    // Increase Prosperity -> UBI, Data Ownership, Democratic Governance
    ['GATO-HI-002', 'GOAL-001', 'supports', 'Prosperity through economic security'],
    ['GATO-HI-002', 'GOAL-002', 'supports', 'Data ownership enables personal prosperity'],
    ['GATO-HI-002', 'GOAL-005', 'supports', 'Democratic governance distributes prosperity'],
    
    // Increase Understanding -> Evidence-Based Policy, Public Awareness
    ['GATO-HI-003', 'GOAL-006', 'supports', 'Understanding requires evidence-based approaches'],
    ['GATO-HI-003', 'GOAL-007', 'supports', 'Public awareness increases collective understanding'],
    
    // Layer 4 Corporate Adoption -> Automation Taxation
    ['GATO-L4', 'GOAL-003', 'informs', 'Corporate adoption can be incentivized through taxation policy'],
    
    // Layer 5 National Regulation -> Institutional Reform
    ['GATO-L5', 'GOAL-009', 'informs', 'National regulation requires institutional reform'],
    
    // Layer 7 Global Consensus -> Coalition Building
    ['GATO-L7', 'GOAL-008', 'aligns_with', 'Global consensus requires coalition building'],
    
    // Traditions -> Strategies
    ['GATO-T02', 'STRAT-004', 'supports', 'Consensus building through community'],
    ['GATO-T03', 'STRAT-002', 'supports', 'Broadcasting findings through public education'],
    ['GATO-T07', 'STRAT-002', 'enables', 'Exponential thinking enables scalable education'],
    
    // Framework -> Principles
    ['GATO-FW', 'PRIN-001', 'aligns_with', 'GATO and PLE both prioritize human dignity'],
    ['GATO-FW', 'PRIN-002', 'aligns_with', 'Both frameworks value evidence-based approaches'],
    ['GATO-FW', 'PRIN-005', 'aligns_with', 'GATO is open source, aligns with open knowledge sharing']
  ];

  for (const [sourceCode, targetCode, relType, desc] of relationships) {
    // Get source and target IDs
    const source = await sql`SELECT id FROM architecture_elements WHERE code = ${sourceCode}`;
    const target = await sql`SELECT id FROM architecture_elements WHERE code = ${targetCode}`;
    
    if (source.length > 0 && target.length > 0) {
      await sql`INSERT INTO element_relationships (source_id, target_id, relationship_type, description)
                VALUES (${source[0].id}, ${target[0].id}, ${relType}, ${desc})
                ON CONFLICT DO NOTHING`;
    }
  }
}

async function getGATOFramework(sql) {
  // Get all GATO elements grouped by type
  const elements = await sql`
    SELECT * FROM architecture_elements 
    WHERE code LIKE 'GATO-%' 
    ORDER BY element_type, code
  `;

  if (elements.length === 0) {
    return jsonResponse({ 
      message: 'GATO Framework not yet seeded. Call with ?action=seed to initialize.',
      seeded: false 
    });
  }

  // Group by type
  const grouped = {
    framework: [],
    imperatives: [],
    layers: [],
    traditions: [],
    attractors: []
  };

  elements.forEach(el => {
    const formatted = {
      id: el.id,
      code: el.code,
      title: el.title,
      description: el.description,
      status: el.status,
      metadata: el.metadata || {},
      createdAt: el.created_at
    };

    if (el.element_type === 'framework') grouped.framework.push(formatted);
    else if (el.element_type === 'imperative') grouped.imperatives.push(formatted);
    else if (el.element_type === 'layer') grouped.layers.push(formatted);
    else if (el.element_type === 'tradition') grouped.traditions.push(formatted);
    else if (el.element_type === 'attractor') grouped.attractors.push(formatted);
  });

  // Get relationships
  const relationships = await sql`
    SELECT er.*, 
           s.code as source_code, s.title as source_title, s.element_type as source_type,
           t.code as target_code, t.title as target_title, t.element_type as target_type
    FROM element_relationships er
    JOIN architecture_elements s ON er.source_id = s.id
    JOIN architecture_elements t ON er.target_id = t.id
    WHERE s.code LIKE 'GATO-%' OR t.code LIKE 'GATO-%'
  `;

  return jsonResponse({
    seeded: true,
    framework: grouped.framework[0] || null,
    imperatives: grouped.imperatives,
    layers: grouped.layers,
    traditions: grouped.traditions,
    attractors: grouped.attractors,
    relationships: relationships.map(r => ({
      id: r.id,
      source: { code: r.source_code, title: r.source_title, type: r.source_type },
      target: { code: r.target_code, title: r.target_title, type: r.target_type },
      relationshipType: r.relationship_type,
      description: r.description
    })),
    stats: {
      total: elements.length,
      imperatives: grouped.imperatives.length,
      layers: grouped.layers.length,
      traditions: grouped.traditions.length,
      attractors: grouped.attractors.length,
      relationships: relationships.length
    }
  });
}

export const config = { path: '/api/gato' };
