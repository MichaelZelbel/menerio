export type GroupTemplateType =
  | "outreach"
  | "relationship_care"
  | "sales"
  | "investors"
  | "hiring"
  | "research"
  | "community"
  | "learning"
  | "creators"
  | "other";

export type GroupTemplateStage = {
  id: string;
  label: string;
  color: string;
};

export type GroupTemplateAttribute = {
  type: "number" | "text" | "select";
  label: string;
  options?: string[];
  min?: number;
  max?: number;
};

export interface GroupTemplate {
  id: string;
  name: string;
  description: string;
  purpose: string;
  type: GroupTemplateType;
  icon: string;
  color: string;
  stages: GroupTemplateStage[];
  attributesSchema: Record<string, GroupTemplateAttribute>;
  successCriteriaDefaults: {
    label: string;
    target: number;
    kind: "manual" | "interaction_count";
  }[];
}

type ContactGroupInsertFromTemplate = {
  name: string;
  description: string;
  purpose: string;
  type: GroupTemplateType;
  template: string;
  success_criteria: {
    label: string;
    target: number;
    current: number;
    kind: "manual" | "interaction_count";
  }[];
  stages: GroupTemplateStage[];
  attributes_schema: Record<string, GroupTemplateAttribute>;
  icon: string;
  color: string;
};

const pipelineColors = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-accent text-accent-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  success: "bg-success/10 text-success border-success/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
};

export const GROUP_TEMPLATES: GroupTemplate[] = [
  {
    id: "dream100",
    name: "Dream 100",
    description: "A focused list of high-value people to research, approach, and build warm relationships with.",
    purpose: "Build meaningful relationships with the people who could most shape your work, network, or opportunities.",
    type: "outreach",
    icon: "Sparkles",
    color: "text-primary",
    stages: [
      { id: "identified", label: "Identified", color: pipelineColors.neutral },
      { id: "researching", label: "Researching", color: pipelineColors.info },
      { id: "first_outreach", label: "First Outreach", color: pipelineColors.primary },
      { id: "in_conversation", label: "In Conversation", color: pipelineColors.warning },
      { id: "warm_relationship", label: "Warm Relationship", color: pipelineColors.success },
      { id: "activated", label: "Activated", color: pipelineColors.success },
    ],
    attributesSchema: {
      relevance_score: { type: "number", label: "Relevance Score", min: 1, max: 10 },
      relationship_strength: { type: "number", label: "Relationship Strength", min: 1, max: 10 },
      best_channel: { type: "select", label: "Best Channel", options: ["Email", "LinkedIn", "Intro", "Event", "Other"] },
      shared_context: { type: "text", label: "Shared Context" },
    },
    successCriteriaDefaults: [
      { label: "Warm relationships", target: 25, kind: "manual" },
      { label: "Meaningful interactions", target: 100, kind: "interaction_count" },
    ],
  },
  {
    id: "investor_pipeline",
    name: "Investor Pipeline",
    description: "Track investor conversations from research through commitment or pass.",
    purpose: "Maintain a clear fundraising process with context, status, and follow-up discipline for each investor.",
    type: "investors",
    icon: "Landmark",
    color: "text-primary",
    stages: [
      { id: "researched", label: "Researched", color: pipelineColors.neutral },
      { id: "first_meeting", label: "First Meeting", color: pipelineColors.primary },
      { id: "due_diligence", label: "Due Diligence", color: pipelineColors.warning },
      { id: "term_sheet", label: "Term Sheet", color: pipelineColors.info },
      { id: "committed", label: "Committed", color: pipelineColors.success },
      { id: "passed", label: "Passed", color: pipelineColors.destructive },
    ],
    attributesSchema: {
      fund_name: { type: "text", label: "Fund Name" },
      ticket_size: { type: "number", label: "Potential Ticket Size", min: 0 },
      investor_fit: { type: "number", label: "Investor Fit", min: 1, max: 10 },
      thesis_match: { type: "select", label: "Thesis Match", options: ["Strong", "Medium", "Weak", "Unknown"] },
    },
    successCriteriaDefaults: [
      { label: "Committed investors", target: 5, kind: "manual" },
      { label: "Investor interactions", target: 40, kind: "interaction_count" },
    ],
  },
  {
    id: "creator_collabs",
    name: "Creator Collaborations",
    description: "Manage potential creator partners from discovery to completed collaborations.",
    purpose: "Coordinate creator relationships and keep collaboration opportunities moving without losing context.",
    type: "creators",
    icon: "Clapperboard",
    color: "text-primary",
    stages: [
      { id: "identified", label: "Identified", color: pipelineColors.neutral },
      { id: "outreach", label: "Outreach", color: pipelineColors.primary },
      { id: "in_talks", label: "In Talks", color: pipelineColors.warning },
      { id: "collaboration_live", label: "Collaboration Live", color: pipelineColors.success },
      { id: "completed", label: "Completed", color: pipelineColors.success },
    ],
    attributesSchema: {
      platform: { type: "select", label: "Platform", options: ["YouTube", "TikTok", "Instagram", "LinkedIn", "Newsletter", "Podcast", "Other"] },
      audience_size: { type: "number", label: "Audience Size", min: 0 },
      audience_fit: { type: "number", label: "Audience Fit", min: 1, max: 10 },
      collaboration_angle: { type: "text", label: "Collaboration Angle" },
    },
    successCriteriaDefaults: [
      { label: "Live collaborations", target: 10, kind: "manual" },
      { label: "Creator touchpoints", target: 50, kind: "interaction_count" },
    ],
  },
  {
    id: "customer_pipeline",
    name: "Customer Pipeline",
    description: "A lightweight sales pipeline for leads, demos, proposals, negotiations, and outcomes.",
    purpose: "Turn promising contacts into customers with clear status, priority, and next-step visibility.",
    type: "sales",
    icon: "Handshake",
    color: "text-primary",
    stages: [
      { id: "lead", label: "Lead", color: pipelineColors.neutral },
      { id: "qualified", label: "Qualified", color: pipelineColors.info },
      { id: "demo", label: "Demo", color: pipelineColors.primary },
      { id: "proposal", label: "Proposal", color: pipelineColors.warning },
      { id: "negotiation", label: "Negotiation", color: pipelineColors.warning },
      { id: "won", label: "Won", color: pipelineColors.success },
      { id: "lost", label: "Lost", color: pipelineColors.destructive },
    ],
    attributesSchema: {
      company: { type: "text", label: "Company" },
      deal_value: { type: "number", label: "Deal Value", min: 0 },
      probability: { type: "number", label: "Probability", min: 0, max: 100 },
      need: { type: "text", label: "Customer Need" },
    },
    successCriteriaDefaults: [
      { label: "Won customers", target: 10, kind: "manual" },
      { label: "Sales interactions", target: 80, kind: "interaction_count" },
    ],
  },
  {
    id: "podcast_guests",
    name: "Podcast Guests",
    description: "Plan guest outreach and production from identification through publication.",
    purpose: "Keep a reliable guest pipeline with topic fit, scheduling status, and publishing progress.",
    type: "outreach",
    icon: "Podcast",
    color: "text-primary",
    stages: [
      { id: "identified", label: "Identified", color: pipelineColors.neutral },
      { id: "invited", label: "Invited", color: pipelineColors.primary },
      { id: "scheduled", label: "Scheduled", color: pipelineColors.info },
      { id: "recorded", label: "Recorded", color: pipelineColors.warning },
      { id: "published", label: "Published", color: pipelineColors.success },
    ],
    attributesSchema: {
      topic_fit: { type: "number", label: "Topic Fit", min: 1, max: 10 },
      proposed_topic: { type: "text", label: "Proposed Topic" },
      audience_relevance: { type: "number", label: "Audience Relevance", min: 1, max: 10 },
      booking_channel: { type: "select", label: "Booking Channel", options: ["Direct", "Intro", "Agency", "Event", "Other"] },
    },
    successCriteriaDefaults: [
      { label: "Published episodes", target: 12, kind: "manual" },
      { label: "Guest interactions", target: 60, kind: "interaction_count" },
    ],
  },
  {
    id: "hiring_candidates",
    name: "Hiring Candidates",
    description: "Track candidates through sourcing, screening, interviews, offers, and outcomes.",
    purpose: "Run a structured hiring process while preserving context about each candidate and role fit.",
    type: "hiring",
    icon: "UserSearch",
    color: "text-primary",
    stages: [
      { id: "sourced", label: "Sourced", color: pipelineColors.neutral },
      { id: "screening", label: "Screening", color: pipelineColors.info },
      { id: "interview", label: "Interview", color: pipelineColors.primary },
      { id: "offer", label: "Offer", color: pipelineColors.warning },
      { id: "hired", label: "Hired", color: pipelineColors.success },
      { id: "rejected", label: "Rejected", color: pipelineColors.destructive },
    ],
    attributesSchema: {
      role: { type: "text", label: "Role" },
      seniority: { type: "select", label: "Seniority", options: ["Junior", "Mid", "Senior", "Lead", "Executive"] },
      fit_score: { type: "number", label: "Fit Score", min: 1, max: 10 },
      source: { type: "select", label: "Source", options: ["Referral", "Inbound", "Outbound", "Agency", "Event", "Other"] },
    },
    successCriteriaDefaults: [
      { label: "Hires", target: 3, kind: "manual" },
      { label: "Candidate interactions", target: 45, kind: "interaction_count" },
    ],
  },
  {
    id: "advisors_mentors",
    name: "Advisors & Mentors",
    description: "Nurture advisory and mentoring relationships from first contact to recurring support.",
    purpose: "Build a trusted circle of advisors with clear context, cadence, and areas of guidance.",
    type: "relationship_care",
    icon: "Compass",
    color: "text-primary",
    stages: [
      { id: "identified", label: "Identified", color: pipelineColors.neutral },
      { id: "first_meeting", label: "First Meeting", color: pipelineColors.primary },
      { id: "recurring", label: "Recurring", color: pipelineColors.warning },
      { id: "core_advisor", label: "Core Advisor", color: pipelineColors.success },
    ],
    attributesSchema: {
      guidance_area: { type: "text", label: "Guidance Area" },
      cadence: { type: "select", label: "Cadence", options: ["Ad hoc", "Monthly", "Quarterly", "Weekly"] },
      trust_level: { type: "number", label: "Trust Level", min: 1, max: 10 },
      mutual_value: { type: "text", label: "Mutual Value" },
    },
    successCriteriaDefaults: [
      { label: "Core advisors", target: 5, kind: "manual" },
      { label: "Advisor interactions", target: 30, kind: "interaction_count" },
    ],
  },
  {
    id: "community_members",
    name: "Community Members",
    description: "Understand and support members as they become engaged contributors and champions.",
    purpose: "Grow a healthier community by tracking member engagement, contribution, and advocacy.",
    type: "community",
    icon: "UsersRound",
    color: "text-primary",
    stages: [
      { id: "new", label: "New", color: pipelineColors.neutral },
      { id: "engaged", label: "Engaged", color: pipelineColors.info },
      { id: "active_contributor", label: "Active Contributor", color: pipelineColors.primary },
      { id: "champion", label: "Champion", color: pipelineColors.success },
    ],
    attributesSchema: {
      community_role: { type: "select", label: "Community Role", options: ["Member", "Contributor", "Moderator", "Partner", "Champion"] },
      engagement_score: { type: "number", label: "Engagement Score", min: 1, max: 10 },
      interests: { type: "text", label: "Interests" },
      preferred_space: { type: "select", label: "Preferred Space", options: ["Discord", "Slack", "Forum", "Events", "Newsletter", "Other"] },
    },
    successCriteriaDefaults: [
      { label: "Active contributors", target: 25, kind: "manual" },
      { label: "Community interactions", target: 150, kind: "interaction_count" },
    ],
  },
];

export function getTemplateById(id: string): GroupTemplate | undefined {
  return GROUP_TEMPLATES.find((template) => template.id === id);
}

export function instantiateTemplate(template: GroupTemplate, name = template.name): ContactGroupInsertFromTemplate {
  return {
    name,
    description: template.description,
    purpose: template.purpose,
    type: template.type,
    template: template.id,
    success_criteria: template.successCriteriaDefaults.map((criterion) => ({
      ...criterion,
      current: 0,
    })),
    stages: template.stages,
    attributes_schema: template.attributesSchema,
    icon: template.icon,
    color: template.color,
  };
}
