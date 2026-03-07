import { Callout, CodeBlock } from "@/components/docs/DocComponents";
import type { DocPage, DocCategory } from "./types";

// ── Content pages ──

const quickStart: DocPage = {
  slug: "quick-start",
  title: "Quick Start Guide",
  description: "Get up and running with Menerio in under 5 minutes.",
  category: "Getting Started",
  headings: [
    { id: "prerequisites", title: "Prerequisites" },
    { id: "create-account", title: "Create Your Account" },
    { id: "first-project", title: "Your First Project" },
    { id: "next-steps", title: "Next Steps" },
  ],
  searchText: "quick start guide getting started sign up create account project setup install",
  content: () => (
    <>
      <h2 id="prerequisites">Prerequisites</h2>
      <p>Before you begin, make sure you have:</p>
      <ul>
        <li>A modern web browser (Chrome, Firefox, Safari, or Edge)</li>
        <li>An email address for account creation</li>
      </ul>

      <h2 id="create-account">Create Your Account</h2>
      <p>Getting started is simple. Navigate to the sign-up page and create your account:</p>
      <CodeBlock code={`1. Visit menerio.com/auth\n2. Click "Sign Up"\n3. Enter your email and password\n4. Verify your email address`} language="text" title="Steps" />
      <Callout type="tip" title="Pro Tip">You can also sign up instantly using your Google or GitHub account.</Callout>

      <h2 id="first-project">Your First Project</h2>
      <p>Once signed in, you'll land on your dashboard. From here you can create your first project:</p>
      <CodeBlock code={`// Navigate to the dashboard\n// Click "New Project"\n// Choose a template or start from scratch`} language="javascript" title="Creating a project" />

      <h2 id="next-steps">Next Steps</h2>
      <p>Now that you're set up, explore these guides to get the most out of Menerio:</p>
      <ul>
        <li>Learn about the Dashboard Overview</li>
        <li>Set up your Profile Settings</li>
        <li>Invite Team Members</li>
      </ul>
    </>
  ),
};

const creatingAccount: DocPage = {
  slug: "creating-account",
  title: "Creating Your Account",
  description: "Step-by-step guide to creating and setting up your Menerio account.",
  category: "Getting Started",
  headings: [
    { id: "email-signup", title: "Email Sign Up" },
    { id: "social-login", title: "Social Login" },
    { id: "profile-setup", title: "Profile Setup" },
  ],
  searchText: "create account sign up register email password social login google github profile",
  content: () => (
    <>
      <h2 id="email-signup">Email Sign Up</h2>
      <p>Create an account using your email address and a secure password. Your password must be at least 8 characters and we recommend including uppercase letters, numbers, and special characters.</p>
      <Callout type="info">We'll send you a verification email. Please check your inbox and click the confirmation link to activate your account.</Callout>

      <h2 id="social-login">Social Login</h2>
      <p>For a faster experience, sign in with your existing Google or GitHub account. We'll automatically create your Menerio profile using your social account details.</p>

      <h2 id="profile-setup">Profile Setup</h2>
      <p>After signing in, visit your Settings page to complete your profile:</p>
      <ul>
        <li><strong>Display Name</strong> — How others will see you</li>
        <li><strong>Avatar</strong> — Upload a profile picture (max 2MB)</li>
        <li><strong>Bio</strong> — A short description (up to 160 characters)</li>
        <li><strong>Website</strong> — Your personal or company website</li>
      </ul>
    </>
  ),
};

const dashboardOverview: DocPage = {
  slug: "dashboard-overview",
  title: "Dashboard Overview",
  description: "Understanding the Menerio dashboard and its key components.",
  category: "Getting Started",
  headings: [
    { id: "layout", title: "Layout" },
    { id: "sidebar", title: "Sidebar Navigation" },
    { id: "metrics", title: "Key Metrics" },
  ],
  searchText: "dashboard overview layout sidebar navigation metrics cards analytics",
  content: () => (
    <>
      <h2 id="layout">Layout</h2>
      <p>The dashboard provides a clean, organized view of all your key information. It consists of a collapsible sidebar for navigation and a main content area displaying your data.</p>

      <h2 id="sidebar">Sidebar Navigation</h2>
      <p>The sidebar gives you quick access to all major sections:</p>
      <ul>
        <li><strong>Overview</strong> — Your main dashboard with key metrics</li>
        <li><strong>Projects</strong> — Manage all your projects</li>
        <li><strong>Analytics</strong> — Detailed analytics and reports</li>
        <li><strong>Team</strong> — Manage team members and roles</li>
        <li><strong>Settings</strong> — Account and profile settings</li>
      </ul>
      <Callout type="tip">Press <code>Ctrl+B</code> (or <code>⌘+B</code> on Mac) to toggle the sidebar.</Callout>

      <h2 id="metrics">Key Metrics</h2>
      <p>The overview page shows at-a-glance metrics including total projects, active tasks, and team member count. These update in real-time as your data changes.</p>
    </>
  ),
};

const feature1: DocPage = {
  slug: "ai-insights",
  title: "AI-Powered Insights",
  description: "Leverage machine learning for smarter decisions.",
  category: "Features",
  headings: [
    { id: "overview", title: "Overview" },
    { id: "how-it-works", title: "How It Works" },
    { id: "configuration", title: "Configuration" },
  ],
  searchText: "ai insights machine learning analytics predictions smart data",
  content: () => (
    <>
      <h2 id="overview">Overview</h2>
      <p>Menerio's AI engine analyzes your project data to surface actionable insights, predict bottlenecks, and recommend optimizations.</p>
      <Callout type="info">AI features are available on Premium plans and above.</Callout>

      <h2 id="how-it-works">How It Works</h2>
      <p>Our AI models process your project history, team activity patterns, and task completion rates to generate insights. All processing happens securely on our infrastructure — your data never leaves our platform.</p>
      <CodeBlock code={`// Example: Fetching AI insights via API\nconst insights = await menerio.ai.getInsights({\n  projectId: "proj_123",\n  timeRange: "30d"\n});\n\nconsole.log(insights.predictions);`} language="typescript" title="API Example" />

      <h2 id="configuration">Configuration</h2>
      <p>Configure AI insights from your project settings. You can adjust sensitivity, enable/disable specific insight categories, and set notification preferences.</p>
    </>
  ),
};

const feature2: DocPage = {
  slug: "collaboration",
  title: "Seamless Collaboration",
  description: "Work together with your team in real-time.",
  category: "Features",
  headings: [
    { id: "real-time", title: "Real-Time Editing" },
    { id: "comments", title: "Comments & Mentions" },
    { id: "sharing", title: "Sharing & Permissions" },
  ],
  searchText: "collaboration real-time editing comments mentions sharing permissions team",
  content: () => (
    <>
      <h2 id="real-time">Real-Time Editing</h2>
      <p>Multiple team members can work on the same project simultaneously. Changes sync instantly across all connected clients.</p>

      <h2 id="comments">Comments & Mentions</h2>
      <p>Leave comments on any item and mention team members using @mentions. They'll receive instant notifications.</p>
      <Callout type="tip">Use @channel to notify all project members at once.</Callout>

      <h2 id="sharing">Sharing & Permissions</h2>
      <p>Control who can view, edit, or manage your projects with granular permission settings. Share projects externally with read-only links.</p>
    </>
  ),
};

const feature3: DocPage = {
  slug: "integrations",
  title: "Integrations",
  description: "Connect Menerio with your favourite tools.",
  category: "Features",
  headings: [
    { id: "available", title: "Available Integrations" },
    { id: "setup", title: "Setting Up" },
    { id: "webhooks", title: "Webhooks" },
  ],
  searchText: "integrations connect tools slack github webhook api third-party",
  content: () => (
    <>
      <h2 id="available">Available Integrations</h2>
      <p>Menerio connects with 200+ tools including Slack, GitHub, Jira, Notion, and more. Browse the full catalog in your project settings.</p>

      <h2 id="setup">Setting Up</h2>
      <p>Most integrations require just a few clicks:</p>
      <CodeBlock code={`1. Go to Settings → Integrations\n2. Find your tool\n3. Click "Connect"\n4. Authorize access\n5. Configure sync options`} language="text" title="Integration setup" />

      <h2 id="webhooks">Webhooks</h2>
      <p>For custom integrations, use webhooks to receive real-time notifications when events happen in Menerio.</p>
      <CodeBlock code={`POST /api/webhooks\nContent-Type: application/json\n\n{\n  "url": "https://your-app.com/webhook",\n  "events": ["project.created", "task.completed"]\n}`} language="http" title="Webhook registration" />
      <Callout type="warning" title="Security">Always verify the webhook signature header to ensure requests are authentic.</Callout>
    </>
  ),
};

const profileSettings: DocPage = {
  slug: "profile-settings",
  title: "Profile Settings",
  description: "Manage your profile, avatar, and account security.",
  category: "Account",
  headings: [
    { id: "profile-info", title: "Profile Information" },
    { id: "avatar", title: "Avatar Upload" },
    { id: "password", title: "Password Management" },
    { id: "delete-account", title: "Delete Account" },
  ],
  searchText: "profile settings avatar upload password change delete account security",
  content: () => (
    <>
      <h2 id="profile-info">Profile Information</h2>
      <p>Update your display name, bio, and website from the Settings page in your dashboard. Changes are saved instantly and reflected across the platform.</p>

      <h2 id="avatar">Avatar Upload</h2>
      <p>Upload a profile picture in JPG, PNG, GIF, or WebP format (max 2MB). Click your avatar in the Avatar tab to open the file picker.</p>

      <h2 id="password">Password Management</h2>
      <p>Change your password from the Account tab. We recommend using a strong password with at least 8 characters including uppercase, numbers, and symbols.</p>
      <Callout type="info">If you signed up with a social account, you can set a password to also enable email login.</Callout>

      <h2 id="delete-account">Delete Account</h2>
      <p>You can permanently delete your account from the Danger Zone tab. This action is irreversible and will remove all your data.</p>
      <Callout type="warning" title="Warning">Account deletion is permanent. Please export any data you wish to keep before proceeding.</Callout>
    </>
  ),
};

const teamMembers: DocPage = {
  slug: "team-members",
  title: "Team Members",
  description: "Invite and manage team members.",
  category: "Account",
  headings: [
    { id: "inviting", title: "Inviting Members" },
    { id: "roles", title: "Roles & Permissions" },
    { id: "removing", title: "Removing Members" },
  ],
  searchText: "team members invite roles permissions manage remove",
  content: () => (
    <>
      <h2 id="inviting">Inviting Members</h2>
      <p>Invite team members by email from your Team page. They'll receive an invitation to join your workspace.</p>
      <Callout type="info">Team management features are coming soon. Stay tuned for updates!</Callout>

      <h2 id="roles">Roles & Permissions</h2>
      <p>Assign roles to control what team members can access. Available roles include Admin, Member, and Viewer.</p>

      <h2 id="removing">Removing Members</h2>
      <p>Admins can remove team members at any time. Removed members lose access immediately but their contributions remain.</p>
    </>
  ),
};

const apiAuth: DocPage = {
  slug: "api-authentication",
  title: "Authentication",
  description: "Authenticate with the Menerio API.",
  category: "API Reference",
  headings: [
    { id: "api-keys", title: "API Keys" },
    { id: "bearer-tokens", title: "Bearer Tokens" },
    { id: "oauth", title: "OAuth 2.0" },
  ],
  searchText: "api authentication api key bearer token oauth authorization header",
  content: () => (
    <>
      <h2 id="api-keys">API Keys</h2>
      <p>Generate API keys from your Settings page. Each key has configurable permissions and can be revoked at any time.</p>
      <CodeBlock code={`curl -H "Authorization: Bearer mk_live_abc123..." \\\n  https://api.menerio.com/v1/projects`} language="bash" title="Using an API key" />

      <h2 id="bearer-tokens">Bearer Tokens</h2>
      <p>Include your API key as a Bearer token in the Authorization header of every request.</p>
      <Callout type="warning" title="Security">Never expose your API keys in client-side code. Use environment variables or a backend proxy.</Callout>

      <h2 id="oauth">OAuth 2.0</h2>
      <p>For applications that act on behalf of users, we support the OAuth 2.0 authorization code flow.</p>
    </>
  ),
};

const apiEndpoints: DocPage = {
  slug: "api-endpoints",
  title: "Endpoints",
  description: "Available API endpoints and usage examples.",
  category: "API Reference",
  headings: [
    { id: "base-url", title: "Base URL" },
    { id: "projects-api", title: "Projects" },
    { id: "tasks-api", title: "Tasks" },
  ],
  searchText: "api endpoints rest projects tasks crud create read update delete",
  content: () => (
    <>
      <h2 id="base-url">Base URL</h2>
      <CodeBlock code="https://api.menerio.com/v1" language="text" title="Base URL" />
      <p>All API endpoints are relative to this base URL. Responses are returned in JSON format.</p>

      <h2 id="projects-api">Projects</h2>
      <CodeBlock code={`GET    /projects          # List all projects\nPOST   /projects          # Create a project\nGET    /projects/:id      # Get a project\nPATCH  /projects/:id      # Update a project\nDELETE /projects/:id      # Delete a project`} language="http" title="Project endpoints" />

      <h2 id="tasks-api">Tasks</h2>
      <CodeBlock code={`GET    /projects/:id/tasks       # List tasks\nPOST   /projects/:id/tasks       # Create a task\nPATCH  /projects/:id/tasks/:tid  # Update a task\nDELETE /projects/:id/tasks/:tid  # Delete a task`} language="http" title="Task endpoints" />
    </>
  ),
};

const apiRateLimits: DocPage = {
  slug: "api-rate-limits",
  title: "Rate Limits",
  description: "Understanding API rate limits and quotas.",
  category: "API Reference",
  headings: [
    { id: "limits", title: "Default Limits" },
    { id: "headers", title: "Rate Limit Headers" },
    { id: "handling", title: "Handling Limits" },
  ],
  searchText: "rate limits throttle quota api requests per minute second",
  content: () => (
    <>
      <h2 id="limits">Default Limits</h2>
      <p>API rate limits depend on your plan:</p>
      <ul>
        <li><strong>Free</strong> — 60 requests/minute</li>
        <li><strong>Premium</strong> — 600 requests/minute</li>
        <li><strong>Enterprise</strong> — Custom limits</li>
      </ul>

      <h2 id="headers">Rate Limit Headers</h2>
      <p>Every API response includes rate limit headers:</p>
      <CodeBlock code={`X-RateLimit-Limit: 60\nX-RateLimit-Remaining: 45\nX-RateLimit-Reset: 1709827200`} language="http" title="Response headers" />

      <h2 id="handling">Handling Rate Limits</h2>
      <p>When you exceed the limit, you'll receive a <code>429 Too Many Requests</code> response. Implement exponential backoff to handle this gracefully.</p>
      <Callout type="tip">Use the <code>X-RateLimit-Reset</code> header to know when you can retry.</Callout>
    </>
  ),
};

const faq: DocPage = {
  slug: "faq",
  title: "Frequently Asked Questions",
  description: "Common questions about Menerio.",
  category: "FAQ",
  headings: [
    { id: "general", title: "General" },
    { id: "billing", title: "Billing" },
    { id: "technical", title: "Technical" },
  ],
  searchText: "faq questions answers help support billing pricing free trial data export",
  content: () => (
    <>
      <h2 id="general">General</h2>
      <h3>What is Menerio?</h3>
      <p>Menerio is a modern platform for project management, team collaboration, and workflow automation — powered by AI.</p>
      <h3>Is there a free plan?</h3>
      <p>Yes! Our free plan includes all core features with generous limits. No credit card required.</p>
      <h3>Can I self-host Menerio?</h3>
      <p>We're exploring self-hosting options. Join our community to stay updated on the roadmap.</p>

      <h2 id="billing">Billing</h2>
      <h3>How do I upgrade to Premium?</h3>
      <p>Visit the Subscription tab in your Settings to upgrade. We accept all major credit cards.</p>
      <h3>Can I cancel anytime?</h3>
      <p>Yes, you can cancel your subscription at any time. You'll retain access until the end of your billing period.</p>

      <h2 id="technical">Technical</h2>
      <h3>What browsers are supported?</h3>
      <p>We support the latest versions of Chrome, Firefox, Safari, and Edge.</p>
      <h3>Can I export my data?</h3>
      <p>Yes, you can export all your data in JSON or CSV format from your Settings page.</p>
      <Callout type="info">Data export is available on all plans, including the free tier.</Callout>
    </>
  ),
};

// ── Registry ──

export const allDocs: DocPage[] = [
  quickStart,
  creatingAccount,
  dashboardOverview,
  feature1,
  feature2,
  feature3,
  profileSettings,
  teamMembers,
  apiAuth,
  apiEndpoints,
  apiRateLimits,
  faq,
];

export const docCategories: DocCategory[] = [
  {
    name: "Getting Started",
    slug: "getting-started",
    pages: [
      { slug: "quick-start", title: "Quick Start Guide" },
      { slug: "creating-account", title: "Creating Your Account" },
      { slug: "dashboard-overview", title: "Dashboard Overview" },
    ],
  },
  {
    name: "Features",
    slug: "features",
    pages: [
      { slug: "ai-insights", title: "AI-Powered Insights" },
      { slug: "collaboration", title: "Seamless Collaboration" },
      { slug: "integrations", title: "Integrations" },
    ],
  },
  {
    name: "Account",
    slug: "account",
    pages: [
      { slug: "profile-settings", title: "Profile Settings" },
      { slug: "team-members", title: "Team Members" },
    ],
  },
  {
    name: "API Reference",
    slug: "api-reference",
    pages: [
      { slug: "api-authentication", title: "Authentication" },
      { slug: "api-endpoints", title: "Endpoints" },
      { slug: "api-rate-limits", title: "Rate Limits" },
    ],
  },
  {
    name: "FAQ",
    slug: "faq",
    pages: [{ slug: "faq", title: "FAQ" }],
  },
];

export function getDoc(slug: string): DocPage | undefined {
  return allDocs.find((d) => d.slug === slug);
}

export function getAdjacentDocs(slug: string): { prev?: { slug: string; title: string }; next?: { slug: string; title: string } } {
  const flat = docCategories.flatMap((c) => c.pages);
  const idx = flat.findIndex((p) => p.slug === slug);
  return {
    prev: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
  };
}
