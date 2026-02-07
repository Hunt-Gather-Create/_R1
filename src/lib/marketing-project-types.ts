import type { Status } from "./design-tokens";

export type MarketingProjectType =
  | "social-media"
  | "email"
  | "influencer"
  | "pr-communications";

export interface StarterIssue {
  title: string;
  description: string;
  status: Status;
}

export interface MarketingProjectTypeConfig {
  label: string;
  description: string;
  icon: string; // Lucide icon name
  starterIssues: StarterIssue[];
}

export const MARKETING_PROJECT_TYPES: Record<
  MarketingProjectType,
  MarketingProjectTypeConfig
> = {
  "social-media": {
    label: "Social Media Strategy",
    description: "Plan and execute social media campaigns",
    icon: "Share2",
    starterIssues: [
      {
        title: "Audit current social media presence",
        description:
          "Review all active social channels, follower counts, engagement rates, and posting frequency. Identify top-performing content.",
        status: "todo",
      },
      {
        title: "Define content pillars and posting calendar",
        description:
          "Establish 3-5 content themes that align with brand values. Create a weekly posting schedule for each platform.",
        status: "backlog",
      },
      {
        title: "Create first campaign brief",
        description:
          "Draft the brief for the first social media campaign including goals, target audience, key messages, and success metrics.",
        status: "backlog",
      },
      {
        title: "Set up social listening and analytics",
        description:
          "Configure tracking for brand mentions, hashtag performance, and competitor activity across platforms.",
        status: "backlog",
      },
    ],
  },
  email: {
    label: "Email Strategy",
    description: "Design email campaigns and nurture sequences",
    icon: "Mail",
    starterIssues: [
      {
        title: "Map customer journey and email touchpoints",
        description:
          "Identify key moments where email communication adds value: welcome, onboarding, re-engagement, post-purchase, etc.",
        status: "todo",
      },
      {
        title: "Design welcome email sequence",
        description:
          "Create a 3-5 email welcome series for new subscribers introducing the brand, key offerings, and a clear CTA.",
        status: "backlog",
      },
      {
        title: "Set up email templates and design system",
        description:
          "Build reusable email templates that reflect brand guidelines including header, footer, typography, and color palette.",
        status: "backlog",
      },
      {
        title: "Define segmentation strategy",
        description:
          "Plan audience segments based on behavior, demographics, and engagement level for targeted messaging.",
        status: "backlog",
      },
      {
        title: "Create first newsletter issue",
        description:
          "Draft and design the inaugural newsletter with curated content, brand story, and subscriber-exclusive value.",
        status: "backlog",
      },
    ],
  },
  influencer: {
    label: "Influencer Marketing",
    description: "Partner with influencers to amplify your brand",
    icon: "Users",
    starterIssues: [
      {
        title: "Define influencer partnership criteria",
        description:
          "Establish audience size ranges, engagement thresholds, content quality standards, and brand-fit requirements for potential partners.",
        status: "todo",
      },
      {
        title: "Research and shortlist potential influencers",
        description:
          "Identify 10-20 influencers across target platforms who align with brand values and reach the desired audience.",
        status: "backlog",
      },
      {
        title: "Create influencer outreach templates",
        description:
          "Draft personalized outreach messages for different influencer tiers (nano, micro, macro) with clear value propositions.",
        status: "backlog",
      },
      {
        title: "Design campaign brief for first collaboration",
        description:
          "Outline deliverables, timeline, creative guidelines, usage rights, and compensation structure for the pilot campaign.",
        status: "backlog",
      },
    ],
  },
  "pr-communications": {
    label: "PR & Communications",
    description: "Manage press releases and media relations",
    icon: "Newspaper",
    starterIssues: [
      {
        title: "Build media contact list",
        description:
          "Research and compile a targeted list of journalists, editors, and media outlets relevant to the brand's industry and story angles.",
        status: "todo",
      },
      {
        title: "Draft brand story and key messages",
        description:
          "Write the core brand narrative, elevator pitch, and 3-5 key messages that serve as the foundation for all PR materials.",
        status: "backlog",
      },
      {
        title: "Create press kit",
        description:
          "Assemble a digital press kit including company overview, founder bios, high-res logos, product images, and fact sheet.",
        status: "backlog",
      },
      {
        title: "Draft first press release",
        description:
          "Write a press release for the most newsworthy upcoming announcement following AP style and including quotes and contact info.",
        status: "backlog",
      },
      {
        title: "Plan media outreach calendar",
        description:
          "Map out key dates, industry events, and editorial calendars to time pitches for maximum coverage.",
        status: "backlog",
      },
    ],
  },
} as const;
