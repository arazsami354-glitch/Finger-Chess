import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, Button, LoadingRow, EmptyState } from '../components/ui';

type KycDocumentStatus = 'pending' | 'needs_more_info' | 'approved' | 'rejected';

interface KycUser {
  id: string;
  email: string;
  fullName: string | null;
  dateOfBirth: string | null;
}

interface KycListItem {
  id: string;
  documentType: string;
  status: KycDocumentStatus;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  user: KycUser;
}

interface KycDetail {
  document: KycListItem & {
    notes: string | null;
    reviewer: { id: string; email: string } | null;
  };
  history: { id: string; action: string; createdAt: string; admin: { id: string; email: string } | null; newValue: string | null }[];
}

interface ListResponse {
  items: KycListItem[];
  nextCursor: string | null;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport',
  national_id: 'National ID',
  drivers_license: "Driver's License",
  health_card: 'Health Card',
};

const STATUS_BADGE_TONE: Record<KycDocumentStatus, 'default' | 'gain' | 'loss' | 'warn'> = {
  pending: 'warn',
  needs_more_info: 'warn',
  approved: 'gain',
  rejected: 'loss',
};

const STATUS_LABEL: Record<KycDocumentStatus, string> = {
  pending: 'Pending',
  needs_more_info: 'Needs info',
  approved: 'Approved',
  rejected: 'Rejected',
};

const FILTERS: { value: 'pending' | 'needs_more_info' | 'all'; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'needs_more_info', label: 'Needs more info' },
  { value: 'all', label: 'All submissions' },
];

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function VerificationPage() {
  const [filter, setFilter] = useState<'pending' | 'needs_more_info' | 'all'>('pending');
  const [documents, setDocuments] = useState<KycListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KycDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  function load(resetCursor: string | null = null) {
    setLoading(true);
    const cursor = resetCursor === null ? null : (resetCursor === '' ? null : resetCursor);
    api
      .get('/admin/kyc/documents', {
        params: {
          status: filter === 'all' ? undefined : filter,
          limit: 50,
          cursor: cursor ?? undefined,
        },
      })
      .then(({ data }: { data: ListResponse }) => {
        setDocuments((prev) => (resetCursor ? prev.concat(data.items) : data.items));
        setNextCursor(data.nextCursor);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [filter]);

  async function openDetail(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setLoadingDetail(true);
    setReason('');
    try {
      const { data } = await api.get(`/admin/kyc/documents/${id}`);
      setDetail(data);
      setNotesDraft(data.document.notes ?? '');
    } finally {
      setLoadingDetail(false);
    }
  }

  async function viewDocument(id: string) {
    const { data } = await api.get(`/admin/kyc/documents/${id}/view-url`);
    window.open(data.url, '_blank', 'noopener,noreferrer');
  }

  async function saveNotes() {
    if (!expandedId) return;
    setBusy(true);
    try {
      await api.put(`/admin/kyc/documents/${expandedId}/notes`, { notes: notesDraft });
      await openDetail(expandedId);
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    try {
      await api.post(`/admin/kyc/documents/${id}/approve`);
      await refreshAfterAction(id);
    } finally {
      setBusy(false);
    }
  }

  async function reject(id: string) {
    if (reason.trim().length < 5) return;
    setBusy(true);
    try {
      await api.post(`/admin/kyc/documents/${id}/reject`, { reason: reason.trim() });
      setReason('');
      await refreshAfterAction(id);
    } finally {
      setBusy(false);
    }
  }

  async function requestInfo(id: string) {
    if (reason.trim().length < 5) return;
    setBusy(true);
    try {
      await api.post(`/admin/kyc/documents/${id}/request-info`, { note: reason.trim() });
      setReason('');
      await refreshAfterAction(id);
    } finally {
      setBusy(false);
    }
  }

  async function refreshAfterAction(id: string) {
    setDetail(null);
    setExpandedId(null);
    if (filter === 'all') {
      const { data } = await api.get(`/admin/kyc/documents/${id}`);
      setDetail(data);
      setExpandedId(id);
      setNotesDraft(data.document.notes ?? '');
    }
    load('');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Identity Verification</h1>
        <div className="flex items-center gap-1 border border-border rounded-lg p-1 bg-surface-raised">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                filter === f.value ? 'bg-brass text-canvas font-medium' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Panel title={filter === 'pending' ? `Pending Review (${documents.length})` : filter === 'needs_more_info' ? 'Needs More Information' : 'All Submissions'}>
        {loading && documents.length === 0 ? (
          <LoadingRow />
        ) : documents.length === 0 ? (
          <EmptyState message="No documents in this view — clean queue." />
        ) : (
          <div className="-m-5">
            <table className="w-[calc(100%+2.5rem)]">
              <thead>
                <tr>
                  <th className="th">User</th>
                  <th className="th">Document</th>
                  <th className="th">Status</th>
                  <th className="th">Submitted</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td className="td">
                      <div className="text-sm">{d.user.fullName || d.user.email}</div>
                      <div className="text-xs text-ink-faint">{d.user.email}</div>
                    </td>
                    <td className="td">
                      <Badge>{DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType}</Badge>
                    </td>
                    <td className="td">
                      <Badge tone={STATUS_BADGE_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                    </td>
                    <td className="td text-xs text-ink-faint font-mono">{new Date(d.submittedAt).toLocaleString()}</td>
                    <td className="td text-right">
                      <Button onClick={() => openDetail(d.id)}>{expandedId === d.id ? 'Close' : 'Review'}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {expandedId && (
              <div className="border-t border-border bg-surface-raised">
                {loadingDetail ? (
                  <div className="p-6">
                    <LoadingRow />
                  </div>
                ) : detail ? (
                  <div className="p-5 space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <DetailCell label="Full name" value={detail.document.user.fullName || '—'} />
                      <DetailCell label="Email" value={detail.document.user.email} />
                      <DetailCell label="Date of birth" value={detail.document.user.dateOfBirth || '—'} />
                      <DetailCell label="User ID" value={detail.document.user.id.slice(0, 8)} />
                      <DetailCell label="File" value={detail.document.fileName || '—'} sub={formatBytes(detail.document.fileSize)} />
                      <DetailCell label="Type" value={detail.document.mimeType || '—'} />
                      <DetailCell label="Submitted" value={new Date(detail.document.submittedAt).toLocaleString()} />
                      <DetailCell label="Reviewed" value={detail.document.reviewedAt ? new Date(detail.document.reviewedAt).toLocaleString() : '—'} />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button tone="brass" onClick={() => viewDocument(expandedId)}>
                        View Document
                      </Button>
                      <Button tone="brass" disabled={busy} onClick={() => approve(expandedId)}>
                        Approve
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <p className="text-xs text-ink-faint uppercase tracking-wider">Internal review notes (never shown to the user)</p>
                        <textarea
                          className="w-full min-h-24 rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink"
                          placeholder="e.g. name on document matches account email…"
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                        />
                        <Button disabled={busy || notesDraft === (detail.document.notes ?? '')} onClick={saveNotes}>
                          Save notes
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs text-ink-faint uppercase tracking-wider">Reject or request more info</p>
                        <textarea
                          className="w-full min-h-24 rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink"
                          placeholder="e.g. the photo is too blurry to read the document number… (shown to the user)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <div className="flex items-center gap-3">
                          <Button disabled={busy || reason.trim().length < 5} onClick={() => requestInfo(expandedId)}>
                            Request More Info
                          </Button>
                          <Button tone="danger" disabled={busy || reason.trim().length < 5} onClick={() => reject(expandedId)}>
                            Reject
                          </Button>
                        </div>
                      </div>
                    </div>

                    {detail.history.length > 0 && (
                      <div className="border-t border-border pt-4">
                        <p className="text-xs text-ink-faint uppercase tracking-wider mb-3">Decision history</p>
                        <div className="space-y-2">
                          {detail.history.map((h) => (
                            <div key={h.id} className="flex items-start gap-3 text-xs">
                              <Badge tone="info">{h.action}</Badge>
                              <div className="text-ink-muted">
                                <span className="text-ink">{h.admin?.email ?? 'system'}</span>
                                {' · '}
                                {new Date(h.createdAt).toLocaleString()}
                                {h.newValue && <span className="block text-ink-faint mt-0.5">{h.newValue}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6">
                    <EmptyState message="Could not load this document." />
                  </div>
                )}
              </div>
            )}

            {nextCursor && (
              <div className="border-t border-border p-4 text-center">
                <Button onClick={() => load(nextCursor)} disabled={loading}>
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function DetailCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-ink-faint uppercase tracking-wider">{label}</div>
      <div className="text-sm text-ink truncate" title={value}>
        {value}
      </div>
      {sub && <div className="text-xs text-ink-faint">{sub}</div>}
    </div>
  );
}
