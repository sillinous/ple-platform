# Post-Labor Economics Platform

**Prosperity Beyond Work** — Building frameworks for a world where human dignity and economic security exist independent of labor markets.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Netlify CLI (`npm install -g netlify-cli`)
- A Netlify account

### Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Login to Netlify**
   ```bash
   netlify login
   ```

3. **Link or create a site**
   ```bash
   netlify init
   ```

4. **Run database migrations**
   ```bash
   npm run db:migrate
   ```

5. **Start development server**
   ```bash
   netlify dev
   ```

   The app will be available at `http://localhost:8888`

## 📁 Project Structure

```
ple-app/
├── index.html              # Homepage
├── login.html              # Login page
├── register.html           # Registration page
├── dashboard.html          # User dashboard
├── proposals.html          # Proposals list
├── proposal-create.html    # Create new proposal
├── proposal-view.html      # View proposal details
├── architecture.html       # Architecture explorer
├── discussions.html        # Community discussions
├── about.html              # About page
├── netlify/
│   └── functions/          # Serverless API functions
│       ├── auth.mjs        # Authentication endpoints
│       ├── proposals.mjs   # Proposals CRUD
│       ├── architecture.mjs # Architecture elements
│       ├── votes.mjs       # Voting system
│       ├── discussions.mjs # Discussions/comments
│       └── activity.mjs    # Activity feed
├── scripts/
│   └── migrate.js          # Database migration script
├── src/
│   ├── scripts/
│   │   └── api.js          # Client-side API module
│   └── styles/
│       ├── brand.css       # Brand design system
│       └── app.css         # Application styles
├── netlify.toml            # Netlify configuration
├── vite.config.js          # Vite bundler config
└── package.json
```

## 🔧 Tech Stack

- **Frontend**: Vanilla JS + Vite (static HTML pages)
- **Backend**: Netlify Functions (serverless)
- **Database**: Netlify DB (PostgreSQL via Neon)
- **Styling**: Custom CSS with design tokens
- **Icons**: Lucide Icons

## 📡 API Endpoints

All API endpoints are available under `/api/`:

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/auth` | POST, GET | Authentication (login, register, logout, me) |
| `/api/proposals` | GET, POST, PUT, DELETE | Proposals CRUD |
| `/api/architecture` | GET | Architecture elements |
| `/api/votes` | GET, POST, DELETE | Voting on proposals |
| `/api/discussions` | GET, POST, PUT, DELETE | Discussions/comments |
| `/api/activity` | GET | Activity feed |

## 🗃️ Database Schema

The platform uses PostgreSQL with the following main tables:

- `users` - User accounts and profiles
- `sessions` - Authentication sessions
- `architecture_elements` - Goals, strategies, capabilities, principles
- `element_relationships` - Relationships between elements
- `proposals` - Governance proposals
- `votes` - Votes on proposals
- `discussions` - Comments and discussions
- `content` - Articles, research, media
- `activity_log` - Platform activity tracking

## 🚢 Deployment

### Deploy to Netlify

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Connect to Netlify**
   - Go to [Netlify](https://app.netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Connect your GitHub repository
   - Build settings will be auto-detected from `netlify.toml`

3. **Database Setup**
   - Netlify DB is automatically provisioned on first deploy
   - Run migrations via the Netlify CLI or add to build command

### Environment Variables

No environment variables are required for basic setup. Netlify DB connection is handled automatically.

Optional variables:
- `JWT_SECRET` - Custom JWT secret (auto-generated if not set)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📜 License

Open source under the MIT License.

## 🔗 Links

- [Website](https://postlaboreconomics.org)
- [Discord](https://discord.gg/postlabor)
- [Newsletter](https://daveshap.substack.com)
- [GitHub](https://github.com/daveshap)

---

**L/0** — The threshold between Labor and Zero. Not the end of work, but the beginning of choice.
