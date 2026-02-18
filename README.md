# Post-Labor Economics Platform

**Prosperity Beyond Work** — Building frameworks for a world where human dignity and economic security exist independent of labor markets.

## 🚀 Zero-Config Deployment

This platform is designed to deploy automatically with no manual configuration required.

### Option 1: Deploy via Netlify UI (Easiest)

1. Push this code to a GitHub repository
2. Go to [app.netlify.com](https://app.netlify.com)
3. Click **"Add new site"** → **"Import an existing project"**
4. Connect your GitHub repo
5. Click **"Deploy"**

That's it! Netlify will:
- ✅ Install dependencies
- ✅ Build the frontend
- ✅ Deploy serverless functions
- ✅ Auto-provision PostgreSQL database
- ✅ Run database migrations on first API call

### Option 2: Deploy via CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy (creates new site automatically)
netlify deploy --prod
```

### Option 3: Drag & Drop

1. Run `npm install && npm run build` locally
2. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
3. Drag the `dist` folder to deploy

> **Note:** Drag & drop only deploys static files. For full functionality with database, use Options 1 or 2.

## ✨ Features

- **User Authentication** - Register, login, secure sessions
- **Architecture Framework** - Goals, strategies, capabilities, principles
- **Proposal System** - Create, vote, discuss governance proposals
- **Voting** - Approve, reject, or abstain on proposals
- **Discussions** - Threaded comments and conversations
- **Activity Feed** - Track all platform activity

## 🗃️ Database

The database is automatically provisioned and initialized:

- **Netlify DB** (PostgreSQL via Neon) - auto-provisioned
- **Migrations** - run automatically on first API call
- **Seed Data** - 33 architecture elements pre-loaded

No database setup required!

## 📁 Project Structure

```
ple-app/
├── *.html                      # Frontend pages (10 pages)
├── netlify/
│   └── functions/              # Serverless API
│       ├── lib/db.mjs          # Database module (auto-migration)
│       ├── auth.mjs            # Authentication
│       ├── proposals.mjs       # Proposals CRUD
│       ├── architecture.mjs    # Architecture elements
│       ├── votes.mjs           # Voting system
│       ├── discussions.mjs     # Comments/discussions
│       └── activity.mjs        # Activity feed
├── src/
│   ├── scripts/api.js          # Frontend API client
│   └── styles/                 # CSS design system
├── netlify.toml                # Netlify configuration
├── package.json
└── vite.config.js
```

## 🔧 Local Development

```bash
# Install dependencies
npm install

# Start dev server (includes local database emulation)
netlify dev
```

The app will be available at `http://localhost:8888`

## 🌐 API Endpoints

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/auth` | POST, GET | Authentication |
| `/api/proposals` | GET, POST, PUT, DELETE | Proposals |
| `/api/architecture` | GET | Architecture elements |
| `/api/votes` | GET, POST, DELETE | Voting |
| `/api/discussions` | GET, POST, PUT, DELETE | Discussions |
| `/api/activity` | GET | Activity feed |

## 🎨 Design System

The platform uses the **Structured Optimism** brand identity:

- **Primary**: Horizon (#1B4D3E) - Deep forest green
- **Accent**: Dawn (#F4A261) - Warm amber
- **Typography**: Fraunces (display) + Inter (body)

## 📜 License

Open source under the MIT License.

---

**L/0** — The threshold between Labor and Zero. Not the end of work, but the beginning of choice.
# Triggered rebuild Wed Feb 18 14:23:09 UTC 2026
