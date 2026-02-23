/**
 * PLE Membership & Monetization
 * 
 * Tiers:
 *   - Community (free): Read content, browse discussions
 *   - Pro ($19/mo): Post, vote, GATO chat, smart search, groups
 *   - Institutional ($99/mo): API/MCP, bulk export, governance, auto-ingest
 * 
 * Routes:
 *   GET  /api/membership             → pricing info
 *   POST /api/membership?action=checkout  → create Stripe session
 *   POST /api/membership?action=webhook   → Stripe webhook
 *   GET  /api/membership?action=status    → check user tier
 */

import { getDb, getCurrentUser, jsonResponse } from './lib/db.mjs';

const TIERS = {
  community: {
    name: 'Community', price: 0, features: ['Read all content', 'Browse discussions', 'View research', 'RSS feed'],
  },
  pro: {
    name: 'Pro Member', price: 1900, interval: 'month',
    features: ['Post in discussions', 'Vote on proposals', 'GATO AI Chat', 'Smart search', 'Comments', 'Groups', 'Task tracking'],
  },
  institutional: {
    name: 'Institutional', price: 9900, interval: 'month',
    features: ['MCP endpoint access', 'API integration', 'Bulk export', 'Governance participation', 'Auto-ingest', 'Priority support'],
  },
};

async function ensureMembershipTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS memberships (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    tier VARCHAR(20) DEFAULT 'community',
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
  )`;
}

export default async (req, context) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    const sql = await getDb();
    await ensureMembershipTable(sql);

    // GET: Pricing info or status
    if (req.method === 'GET') {
      if (action === 'status') {
        const user = await getCurrentUser(req);
        if (!user) return jsonResponse({ tier: 'community', authenticated: false }, 200);
        
        const [membership] = await sql`
          SELECT tier, status, current_period_end FROM memberships WHERE user_id = ${user.id}
        `;
        
        return jsonResponse({
          tier: membership?.tier || 'community',
          status: membership?.status || 'active',
          periodEnd: membership?.current_period_end,
          authenticated: true,
          user: { id: user.id, username: user.username },
        }, 200);
      }

      // Default: return pricing
      return jsonResponse({
        tiers: Object.entries(TIERS).map(([id, t]) => ({ id, ...t })),
        crossSell: [
          { platform: 'ORACLE Intelligence', url: 'https://oracle-intelligence.netlify.app', desc: 'AI Market Research Reports ($39-$199)' },
          { platform: 'Grant OS', url: 'https://grant-os-platform.netlify.app', desc: 'AI-Powered Grant Discovery' },
          { platform: 'ATLAS', url: 'https://unless-atlas-platform.netlify.app', desc: 'Financial Modeling' },
        ],
      }, 200);
    }

    // POST: Checkout or Webhook
    if (req.method === 'POST') {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      
      if (!stripeKey) {
        return jsonResponse({ 
          error: 'Payments not yet configured',
          message: 'Stripe integration pending. Contact admin.',
          setupRequired: 'STRIPE_SECRET_KEY env var',
        }, 503);
      }

      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(stripeKey);

      if (action === 'checkout') {
        const body = await req.json();
        const { tier, email } = body;

        if (!TIERS[tier] || tier === 'community') {
          return jsonResponse({ error: 'Invalid tier. Use: pro, institutional' }, 400);
        }

        const t = TIERS[tier];
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: { name: `PLE ${t.name}`, description: `Monthly ${tier} membership` },
              unit_amount: t.price,
              recurring: { interval: t.interval },
            },
            quantity: 1,
          }],
          mode: 'subscription',
          success_url: `${url.origin}/settings?membership=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${url.origin}/settings?membership=cancelled`,
          ...(email ? { customer_email: email } : {}),
          metadata: { platform: 'ple', tier },
        });

        return jsonResponse({ url: session.url, sessionId: session.id }, 200);
      }

      if (action === 'webhook') {
        const sig = req.headers.get('stripe-signature');
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        
        if (!webhookSecret) {
          return jsonResponse({ error: 'Webhook not configured' }, 503);
        }

        const rawBody = await req.text();
        let event;
        try {
          event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        } catch (err) {
          return jsonResponse({ error: 'Invalid signature' }, 400);
        }

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const { tier } = session.metadata;
          const customerId = session.customer;
          const subscriptionId = session.subscription;
          const email = session.customer_email;

          // Find user by email and create/update membership
          if (email) {
            const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
            if (user) {
              await sql`
                INSERT INTO memberships (user_id, tier, stripe_customer_id, stripe_subscription_id, status)
                VALUES (${user.id}, ${tier}, ${customerId}, ${subscriptionId}, 'active')
                ON CONFLICT (user_id) DO UPDATE SET 
                  tier = ${tier}, stripe_customer_id = ${customerId}, 
                  stripe_subscription_id = ${subscriptionId}, status = 'active',
                  updated_at = NOW()
              `;
            }
          }
        }

        if (event.type === 'customer.subscription.deleted') {
          const sub = event.data.object;
          await sql`
            UPDATE memberships SET tier = 'community', status = 'cancelled', updated_at = NOW()
            WHERE stripe_subscription_id = ${sub.id}
          `;
        }

        return jsonResponse({ received: true }, 200);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('Membership error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
};

export const config = {
  path: ['/api/membership'],
};
