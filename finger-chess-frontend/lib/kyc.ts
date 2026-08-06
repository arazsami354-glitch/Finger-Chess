export type KycStatus = 'not_submitted' | 'pending' | 'needs_more_info' | 'verified' | 'rejected';

export type KycDocumentType = 'passport' | 'national_id' | 'drivers_license' | 'health_card';

export type KycDocumentStatus = 'pending' | 'needs_more_info' | 'approved' | 'rejected';

export interface KycDocument {
  id: string;
  documentType: KycDocumentType;
  status: KycDocumentStatus;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

export const KYC_DOCUMENT_TYPES: { value: KycDocumentType; label: string; hint: string }[] = [
  { value: 'passport', label: 'Passport', hint: 'Photo page — your face and details must be fully readable.' },
  { value: 'national_id', label: 'National ID', hint: 'Front and back in a single scan or clear photo.' },
  { value: 'drivers_license', label: "Driver's License", hint: 'Front and back in a single scan or clear photo.' },
  { value: 'health_card', label: 'Health Card', hint: 'A government-issued card with your name and date of birth.' },
];

export const KYC_DOCUMENT_TYPE_LABELS: Record<KycDocumentType, string> = Object.fromEntries(
  KYC_DOCUMENT_TYPES.map((d) => [d.value, d.label]),
) as Record<KycDocumentType, string>;

export interface KycStatusMeta {
  label: string;
  description: string;
}

export const KYC_STATUS_META: Record<KycStatus, KycStatusMeta> = {
  not_submitted: {
    label: 'Not submitted',
    description: 'Deposits, withdrawals, and paid matches require a verified identity. Free matches remain available either way.',
  },
  pending: {
    label: 'Under review',
    description: "Our team is reviewing your document. This usually takes 1–2 business days.",
  },
  needs_more_info: {
    label: 'Needs more information',
    description: 'Your document was flagged — review the note below and submit a clearer copy to continue.',
  },
  verified: {
    label: 'Verified',
    description: 'Deposits, withdrawals, and paid matches are all available to you.',
  },
  rejected: {
    label: 'Rejected',
    description: 'Your submission was declined — review the reason below and resubmit with a valid document.',
  },
};

export function kycStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Not submitted';
  return KYC_STATUS_META[status as KycStatus]?.label ?? status.replaceAll('_', ' ');
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
