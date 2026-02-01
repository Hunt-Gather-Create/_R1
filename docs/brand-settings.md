# Brand Settings

The Brand Settings page allows users to configure their workspace's brand identity, including logo, colors, and AI-researched brand guidelines.

## Page Location

`src/app/w/[slug]/settings/brand/page.tsx`

## Features

### Brand Research & Setup

When adding a brand, users can:
1. **Search by name** - AI researches the brand and returns matching results
2. **Enter website URL** - AI extracts brand information from the website
3. **Create from scratch** - Manually enter brand details

The research flow uses `/api/brand/research` endpoint which leverages AI to gather brand information.

### Brand Overview

Displays core brand information:
- Logo (stored in R2, with automatic background detection)
- Website URL
- Industry
- Primary and secondary colors

### Brand Guidelines (Editable)

AI-researched brand guidelines that can be manually edited:

| Section | Fields | Component |
|---------|--------|-----------|
| Summary | Text description | `EditableField` (multiline) |
| Logo Usage | Clear space, minimum size, rules | `EditableField`, `ListField` |
| Typography | Primary font, secondary font | `EditableField` |
| Voice & Tone | Characteristics, do's, don'ts | `TagListField`, `ListField` |
| Imagery | Style description, guidelines | `EditableField`, `ListField` |
| Sources | Research URLs (read-only) | Static list |

Guidelines are stored as JSON in the `brands.guidelines` column.

## Components

### GuidelinesPreview

`src/app/w/[slug]/settings/brand/_components/GuidelinesPreview.tsx`

Editable form for brand guidelines using shared field components:

```tsx
import { EditableField, ListField, TagListField } from "@/components/ui/editable-field";

<GuidelinesPreview
  guidelines={editedGuidelines}
  onGuidelinesChange={setEditedGuidelines}
  onSave={handleSaveGuidelines}
  isSaving={isSavingGuidelines}
/>
```

### Shared Editable Field Components

`src/components/ui/editable-field.tsx`

Reusable components for inline editing:

```tsx
// Single-line or multiline text
<EditableField
  label="Summary"
  value={value}
  onChange={onChange}
  placeholder="Enter text..."
  multiline
/>

// List with add/remove
<ListField
  label="Rules"
  items={items}
  onChange={onChange}
  placeholder="Add item..."
  emptyText="No items yet."
  variant="success" // or "destructive" for colored labels
/>

// Tags with add/remove
<TagListField
  label="Characteristics"
  items={items}
  onChange={onChange}
  placeholder="Add tag..."
  emptyText="No tags yet."
/>
```

## Server Actions

`src/lib/actions/brand.ts`

| Action | Description |
|--------|-------------|
| `getUserBrands()` | Get all brands owned by current user |
| `getBrandById(id)` | Get a specific brand |
| `createBrand(input)` | Create new brand with optional logo processing |
| `updateBrand(id, input)` | Update brand details |
| `deleteBrand(id)` | Delete brand and cleanup R2 logo |
| `getWorkspaceBrand(workspaceId)` | Get brand linked to workspace |
| `setWorkspaceBrand(workspaceId, brandId)` | Link brand to workspace |
| `unlinkWorkspaceBrand(workspaceId)` | Remove brand from workspace |
| `updateBrandGuidelines(brandId, guidelines)` | Save edited guidelines |

## Background Jobs

Brand guidelines research runs as a background job via Inngest:

`src/lib/inngest/functions/brand-guidelines-research.ts`

Event: `brand/guidelines.research`

The job:
1. Searches for brand guidelines online
2. Extracts structured data using AI
3. Updates `brands.guidelines` and `brands.guidelinesStatus`

Status values: `pending` | `processing` | `completed` | `failed` | `not_found`

## Database Schema

```sql
brands (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  logo_url TEXT,
  logo_storage_key TEXT,      -- R2 key for stored logo
  logo_background TEXT,        -- "light" | "dark"
  website_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  industry TEXT,
  guidelines TEXT,             -- JSON: BrandGuidelines
  guidelines_status TEXT,      -- Research status
  guidelines_updated_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
)
```

## Types

`src/lib/types.ts`

```typescript
interface BrandGuidelines {
  summary?: string;
  logo?: {
    rules?: string[];
    clearSpace?: string;
    minimumSize?: string;
  };
  typography?: {
    primaryFont?: string;
    secondaryFont?: string;
  };
  voiceAndTone?: {
    characteristics?: string[];
    doUse?: string[];
    dontUse?: string[];
  };
  imagery?: {
    style?: string;
    guidelines?: string[];
  };
  sources?: Array<{ url: string; title?: string; fetchedAt: string }>;
  lastUpdated: string;
  confidence: "high" | "medium" | "low";
}

type GuidelinesStatus = "pending" | "processing" | "completed" | "failed" | "not_found";
```

## Page States

The brand page manages multiple states:

| State | Description |
|-------|-------------|
| `loading` | Initial data fetch |
| `empty` | No brand linked to workspace |
| `search` | Brand search form visible |
| `searching` | Search in progress |
| `disambiguation` | Multiple results, user selects one |
| `researching` | AI researching selected brand |
| `preview` | Review/edit brand before saving |
| `linked` | Brand linked, showing details |

## Polling

When viewing the Guidelines tab with `pending` or `processing` status, the page polls every 3 seconds for updates until research completes.
