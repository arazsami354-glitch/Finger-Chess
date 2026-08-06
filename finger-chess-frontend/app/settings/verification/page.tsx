'use client';

import { useEffect, useRef, useState, DragEvent, ChangeEvent } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';
import { statusTone } from '@/lib/status-tone';
import {
  KYC_DOCUMENT_TYPES,
  KYC_DOCUMENT_TYPE_LABELS,
  KYC_STATUS_META,
  formatFileSize,
  type KycDocument,
  type KycDocumentType,
  type KycStatus,
} from '@/lib/kyc';
import { compressImageFile, readFileAsDataUrl } from '@/lib/image-utils';
import {
  ShieldCheck,
  Clock,
  XCircle,
  UploadCloud,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ChevronRight,
  RotateCcw,
  Check,
} from 'lucide-react';

const DOC_STATUS_META: Record<string, { label: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Under review', icon: Clock },
  needs_more_info: { label: 'Needs more information', icon: AlertTriangle },
  approved: { label: 'Approved', icon: CheckCircle2 },
  rejected: { label: 'Rejected', icon: XCircle },
};

const WIZARD_STEPS = ['Document type', 'Upload', 'Confirm'] as const;

export default function VerificationPage() {
  const { refreshUser } = useAuth();
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [documents, setDocuments] = useState<KycDocument[]>([]);
  const [documentType, setDocumentType] = useState<KycDocumentType>('passport');
  const [step, setStep] = useState<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    api.get('/kyc/status').then(({ data }) => {
      setKycStatus(data.kycStatus);
      setDocuments(data.documents);
      if (data.preferredIdType && KYC_DOCUMENT_TYPE_LABELS[data.preferredIdType as KycDocumentType]) {
        setDocumentType(data.preferredIdType);
      }
    });
  }
  useEffect(load, []);

  async function acceptFile(selected: File) {
    if (!selected.type.startsWith('image/') && selected.type !== 'application/pdf') {
      toast.error('Please upload a JPEG, PNG, or PDF file');
      return;
    }
    if (selected.size > 8 * 1024 * 1024) {
      toast.error('File exceeds the 8MB limit');
      return;
    }
    setCompressing(true);
    try {
      const prepared = await compressImageFile(selected);
      setFile(prepared);
      setPreviewUrl(await readFileAsDataUrl(prepared));
      setStep(1);
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not process that file');
    } finally {
      setCompressing(false);
    }
  }

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) acceptFile(selected);
    e.target.value = '';
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const selected = e.dataTransfer.files?.[0];
    if (selected) acceptFile(selected);
  }

  function removeFile() {
    setFile(null);
    setPreviewUrl(null);
    setStep(1);
  }

  async function submit() {
    if (!file) return;
    setSubmitting(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', documentType);
      await api.post('/kyc/documents', formData, {
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      toast.success("Document submitted — we'll review it shortly");
      setFile(null);
      setPreviewUrl(null);
      setStep(0);
      await refreshUser();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Upload failed');
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  const canSubmit = kycStatus === 'not_submitted' || kycStatus === 'rejected' || kycStatus === 'needs_more_info';
  const latestDocument = documents[0];
  const isImage = file?.type.startsWith('image/') ?? false;

  if (kycStatus === null) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-32">
          <Spinner className="h-8 w-8" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          title="Identity Verification"
          description="Verify your identity to unlock deposits, withdrawals, and paid matches."
          backHref="/settings"
        />

        <Card className="animate-fade-up">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <StatusIcon status={kycStatus} />
              <div>
                <div className="text-sm font-medium">{KYC_STATUS_META[kycStatus]?.label ?? kycStatus}</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {kycStatus === 'needs_more_info' && latestDocument?.rejectionReason
                    ? `"${latestDocument.rejectionReason}"`
                    : KYC_STATUS_META[kycStatus]?.description}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {canSubmit && (
          <Card className="animate-fade-up [animation-delay:60ms] [animation-fill-mode:backwards]">
            <CardHeader>
              <CardTitle className="text-base">{kycStatus === 'not_submitted' ? 'Get verified' : 'Resubmit a document'}</CardTitle>
              <CardDescription>
                Accepted: passport, national ID, driver&apos;s license, or health card. JPEG, PNG, or PDF, up to 8MB — photos are compressed
                on-device before upload.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <WizardSteps step={step} />

              {step === 0 && (
                <div className="space-y-3 animate-fade-up">
                  {KYC_DOCUMENT_TYPES.map((doc) => (
                    <button
                      key={doc.value}
                      type="button"
                      onClick={() => setDocumentType(doc.value)}
                      className={cn(
                        'w-full text-left rounded-xl border p-4 transition-all duration-200 ease-premium flex items-start gap-3',
                        documentType === doc.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40 hover:bg-secondary/30',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
                          documentType === doc.value ? 'border-primary bg-primary' : 'border-border',
                        )}
                      >
                        {documentType === doc.value && <Check className="h-3 w-3 text-primary-foreground" />}
                      </span>
                      <span>
                        <span className="text-sm font-medium block">{doc.label}</span>
                        <span className="text-xs text-muted-foreground block mt-0.5">{doc.hint}</span>
                      </span>
                    </button>
                  ))}
                  <Button className="w-full mt-2" onClick={() => setStep(1)}>
                    Continue <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-4 animate-fade-up">
                  {compressing ? (
                    <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
                      <Spinner className="h-5 w-5" /> Compressing your photo…
                    </div>
                  ) : file && previewUrl ? (
                    <div className="rounded-xl border border-border overflow-hidden">
                      {isImage ? (
                        <img src={previewUrl} alt="Document preview" className="max-h-72 w-full object-contain bg-muted/40" />
                      ) : (
                        <div className="flex flex-col items-center gap-2 py-10">
                          <FileText className="h-10 w-10 text-primary" />
                          <span className="text-sm font-medium">{file.name}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-secondary/30">
                        <div className="text-xs text-muted-foreground truncate">
                          <span className="font-medium text-foreground">{file.name}</span> · {formatFileSize(file.size)}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button type="button" variant="outline" size="sm" onClick={removeFile}>
                            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Replace
                          </Button>
                          <Button type="button" size="sm" onClick={() => setStep(2)}>
                            Continue <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'relative rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-200 ease-premium',
                        dragActive ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/40 hover:bg-secondary/30',
                      )}
                    >
                      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleFileSelected} />
                      <div className="space-y-2">
                        <UploadCloud className={cn('h-8 w-8 mx-auto transition-colors', dragActive ? 'text-primary' : 'text-muted-foreground')} />
                        <p className="text-sm font-medium">Drag &amp; drop your document here</p>
                        <p className="text-xs text-muted-foreground">or click to browse</p>
                      </div>
                    </div>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStep(0)} className="w-full">
                    Back to document type
                  </Button>
                </div>
              )}

              {step === 2 && file && (
                <div className="space-y-4 animate-fade-up">
                  <div className="rounded-xl border border-border divide-y divide-border">
                    <div className="flex justify-between px-4 py-3 text-sm">
                      <span className="text-muted-foreground">Document</span>
                      <span className="font-medium">{KYC_DOCUMENT_TYPE_LABELS[documentType] ?? documentType}</span>
                    </div>
                    <div className="flex justify-between px-4 py-3 text-sm">
                      <span className="text-muted-foreground">File</span>
                      <span className="font-medium truncate max-w-[220px]">{file.name}</span>
                    </div>
                    <div className="flex justify-between px-4 py-3 text-sm">
                      <span className="text-muted-foreground">Size</span>
                      <span className="font-medium">{formatFileSize(file.size)}</span>
                    </div>
                  </div>

                  {uploadProgress !== null ? (
                    <div className="space-y-3">
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-200 ease-premium rounded-full" style={{ width: `${uploadProgress}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground font-mono text-center">{uploadProgress}% uploaded</p>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Button type="button" variant="outline" onClick={removeFile} disabled={submitting} className="flex-1">
                        Back
                      </Button>
                      <Button type="button" onClick={submit} disabled={submitting} className="flex-1">
                        {submitting ? <Spinner className="h-4 w-4 mr-2" /> : null}
                        Submit for review
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {documents.length > 0 && (
          <Card className="animate-fade-up [animation-delay:120ms] [animation-fill-mode:backwards]">
            <CardHeader>
              <CardTitle className="text-base">Verification Timeline</CardTitle>
              <CardDescription>Every submission in your verification journey, most recent first.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative space-y-0">
                {documents.map((d, i) => {
                  const meta = DOC_STATUS_META[d.status] ?? DOC_STATUS_META.pending;
                  const tone = statusTone(d.status);
                  const isLast = i === documents.length - 1;
                  return (
                    <div key={d.id} className="relative flex gap-4 pb-8 last:pb-0">
                      {!isLast && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-border" />}
                      <div
                        className={cn(
                          'relative z-10 h-8 w-8 rounded-full flex items-center justify-center shrink-0 border-2',
                          tone === 'gain' && 'bg-gain/15 border-gain text-gain',
                          tone === 'warn' && 'bg-warn/15 border-warn text-warn',
                          tone === 'destructive' && 'bg-destructive/15 border-destructive text-destructive',
                        )}
                      >
                        <meta.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 pt-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{KYC_DOCUMENT_TYPE_LABELS[d.documentType] ?? d.documentType}</span>
                          <Badge variant={tone}>{meta.label}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">Submitted {new Date(d.submittedAt).toLocaleString()}</div>
                        {d.reviewedAt && <div className="text-xs text-muted-foreground">Reviewed {new Date(d.reviewedAt).toLocaleString()}</div>}
                        {d.rejectionReason && <div className="text-xs text-destructive mt-1">&quot;{d.rejectionReason}&quot;</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function WizardSteps({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {WIZARD_STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'h-6 w-6 rounded-full border-2 flex items-center justify-center text-[11px] font-semibold transition-all duration-200 ease-premium',
                  done && 'border-gain bg-gain/15 text-gain',
                  active && 'border-primary bg-primary/15 text-primary',
                  !done && !active && 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn('text-xs font-medium hidden sm:inline', active ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
            </div>
            {i < WIZARD_STEPS.length - 1 && <span className={cn('flex-1 h-px', done ? 'bg-gain' : 'bg-border')} />}
          </div>
        );
      })}
    </div>
  );
}

function StatusIcon({ status }: { status: KycStatus | null }) {
  if (status === 'verified') return <ShieldCheck className="h-8 w-8 text-gain" />;
  if (status === 'pending') return <Clock className="h-8 w-8 text-warn" />;
  if (status === 'needs_more_info') return <AlertTriangle className="h-8 w-8 text-warn" />;
  if (status === 'rejected') return <XCircle className="h-8 w-8 text-destructive" />;
  return <Circle className="h-8 w-8 text-muted-foreground" />;
}
