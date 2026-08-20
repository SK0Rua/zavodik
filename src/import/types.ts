/**
 * Phase F — legacy `website-offers` import.
 *
 * Shapes of the legacy on-disk package (see docs/IMPORT.md for the full mapping).
 * The legacy tree is READ-ONLY: nothing in this module ever writes to it.
 */

/** A legacy fact envelope: `{ value, source_ids, confidence, verified_at }`. */
export interface LegacyField<T = unknown> {
  value: T | null;
  source_ids?: string[];
  confidence?: 'high' | 'medium' | 'low' | string;
  verified_at?: string | null;
}

export interface LegacyAddress {
  full?: string | null;
  street?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface LegacyCoordinates {
  lat?: number | null;
  lng?: number | null;
}

export interface LegacyLead {
  schema_version?: number;
  client_id?: string;
  created_at?: string;
  updated_at?: string;
  campaign_ids?: string[];
  identity?: {
    display_name?: LegacyField<string>;
    legal_name?: LegacyField<string>;
    previous_names?: unknown[];
    brand_notes?: unknown;
  };
  classification?: {
    category?: LegacyField<string>;
    subcategories?: unknown[];
    business_status?: LegacyField<string>;
    chain?: LegacyField<string>;
  };
  location?: {
    address?: LegacyField<LegacyAddress>;
    coordinates?: LegacyField<LegacyCoordinates>;
    service_area?: unknown;
    maps_url?: LegacyField<string>;
    place_id?: LegacyField<string>;
  };
  contact?: {
    phones?: LegacyField<string[] | string>;
    website?: LegacyField<string>;
    emails?: LegacyField<string[] | string>;
    contact_form_url?: unknown;
    messengers?: unknown[];
    contact_person?: LegacyField<string>;
  };
  presence?: {
    rating?: LegacyField<number>;
    reviews_count?: LegacyField<number>;
    hours?: LegacyField<unknown>;
    languages?: LegacyField<unknown>;
    socials?: LegacyField<unknown>;
  };
  offering?: {
    services?: LegacyField<unknown[]>;
    price_level?: unknown;
    description?: unknown;
  };
  media_summary?: {
    photos_count?: number;
    has_logo?: boolean;
    primary_photo_ref?: string | null;
  };
  site_state?: {
    has_website?: boolean | null;
    audit_ref?: string | null;
  };
}

export interface LegacyGap {
  field?: string;
  problem?: string;
  blocking?: boolean;
}

export interface LegacyStatus {
  schema_version?: number;
  client_id?: string;
  status?: string;
  status_since?: string;
  owner?: string;
  qualification?: {
    score?: number | null;
    components?: Record<string, unknown>;
    reasons?: string[];
    hard_filters_passed?: boolean | null;
    rejected_reason?: string | null;
  };
  gates?: Record<string, boolean | null>;
  gaps?: LegacyGap[];
  qa?: { reviewed_by?: string | null; reviewed_at?: string | null; notes?: string | null };
  history?: Array<{ at?: string; from?: string | null; to?: string; by?: string; note?: string }>;
}

export interface LegacySource {
  source_id: string;
  source_type?: string;
  url?: string;
  captured_at?: string;
  captured_by?: string;
  method?: string;
  /** Relative to the campaign dir, e.g. `raw/google-maps/search-...html`. */
  raw_ref?: string | null;
  notes?: string | null;
}

export interface LegacySourcesFile {
  schema_version?: number;
  client_id?: string;
  sources?: LegacySource[];
}

export interface LegacyAsset {
  asset_id?: string;
  path?: string;
  kind?: string;
  source_id?: string;
  source_url?: string;
  captured_at?: string;
  width?: number | null;
  height?: number | null;
  content_type?: string | null;
  sha256?: string | null;
  rights?: string | null;
  [k: string]: unknown;
}

export interface LegacyAssetsManifest {
  schema_version?: number;
  client_id?: string;
  assets?: LegacyAsset[];
}

/** Legacy audit blob (`research/site-audit.json` and friends). Shape is loose by design. */
export interface LegacyAudit {
  verdict?: string;
  best_endpoint?: string | null;
  endpoints?: unknown;
  endpoint_matrix?: unknown;
  meaningful_content?: boolean | null;
  notes?: string | null;
  audited_at?: string | null;
  [k: string]: unknown;
}

/** Everything read off disk for one legacy client, before any DB work. */
export interface LegacyClient {
  clientId: string;
  /** Absolute path of the client dir (read-only). */
  dir: string;
  lead: LegacyLead;
  status: LegacyStatus;
  sources: LegacySource[];
  assets: LegacyAsset[];
  audits: Array<{ relPath: string; audit: LegacyAudit }>;
  /** Relative path of an existing demo site dir, if the legacy package has real site files. */
  websiteDir: string | null;
  /** Files under the client dir that carry evidence, relative to LEGACY_DIR. */
  evidenceFiles: string[];
}
