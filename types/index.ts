export type UserRole = 'user' | 'admin';
export type BusinessMode = 'hybrid' | 'exclusive_only';
export type DatasetKey = 'leads';
export type WorkflowStatus = 'new' | 'triaged' | 'qualified' | 'in_sequence' | 'engaged' | 'won' | 'lost' | 'do_not_contact';

export interface UserProfile {
  id: string;
  role: UserRole;
  business_rule: BusinessMode;
  created_at: string;
}

export interface Lead {
  id: string;
  company: string;
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  state: string | null;
  city: string | null;
  stage: string | null;
  workflow: WorkflowStatus;
  intelligence_score: number;
  is_premium: boolean;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreditLedgerEntry {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface DatasetAccess {
  id: string;
  user_id: string;
  dataset: DatasetKey;
  record_id: string;
  granted_at: string;
}

export interface UnlockResult {
  newly_granted: number;
  cost_charged: number;
  balance_after: number;
}

// Admin upload types
export interface LeadUploadBatch {
  id: string;
  filename: string | null;
  source: string;
  total_rows: number;
  inserted_rows: number;
  skipped_rows: number;
  status: 'uploaded' | 'validated' | 'approved' | 'merged' | 'rejected';
  uploaded_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  merged_at: string | null;
  created_at: string;
}

export interface LeadUploadStagingRow {
  id: string;
  batch_id: string;
  full_contact_name: string | null;
  title_role: string | null;
  validated_corporate_email: string | null;
  phone_number: string | null;
  company_name: string | null;
  website: string | null;
  state: string | null;
  regulation_type: string | null;
  filing_date: string | null;
  sec_filing_url: string | null;
  email_norm: string | null;
  company_norm: string | null;
  validation_errors: string | null;
  is_valid: boolean;
  created_at: string;
}
