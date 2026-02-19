'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { checkIsAdmin } from '@/lib/is-admin';
import { TopNav } from '@/components/TopNav';
import { ToastProvider, useToast } from '@/components/Toast';
import type { LeadUploadBatch, LeadUploadStagingRow } from '@/types';
import {
  Upload, CheckCircle2, XCircle, Loader2, RotateCcw,
  Merge, Table, ClipboardList, ArrowRight, AlertTriangle,
} from 'lucide-react';

// ── CSV parser (client-side preview only) ─────────────────────
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
  return { headers, rows };
}

// ── Status badge ──────────────────────────────────────────────
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  uploaded:  { bg: '#eff6ff', color: '#2563eb' },
  validated: { bg: '#fefce8', color: '#ca8a04' },
  approved:  { bg: '#f0fdf4', color: '#16a34a' },
  merged:    { bg: '#dcfce7', color: '#15803d' },
  rejected:  { bg: '#fef2f2', color: '#dc2626' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: '#f3f4f6', color: '#6b7280' };
  return (
    <span style={{ fontSize: '10.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: s.bg, color: s.color, letterSpacing: '0.04em', textTransform: 'capitalize' }}>
      {status === 'merged' ? 'Merged ✓' : status}
    </span>
  );
}

// ── Card wrapper ──────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '1.25rem', ...style }}>
      {children}
    </div>
  );
}

function CardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '0.75rem' }}>
      {icon}
      <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>{children}</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
function AdminUploadInner() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [notAdmin, setNotAdmin] = useState(false);

  // File & preview
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [dragging, setDragging] = useState(false);

  // Upload state
  const [uploading, setUploading] = useState(false);

  // Active batch
  const [activeBatch, setActiveBatch] = useState<LeadUploadBatch | null>(null);
  const [stagingRows, setStagingRows] = useState<LeadUploadStagingRow[]>([]);
  const [loadingStaging, setLoadingStaging] = useState(false);

  // Result panels
  const [uploadResult, setUploadResult] = useState<{ batch_id: string; total_rows: number } | null>(null);
  const [validateResult, setValidateResult] = useState<{ total_rows: number; valid_rows: number; invalid_rows: number } | null>(null);
  const [mergeResult, setMergeResult] = useState<{ inserted_rows: number; skipped_rows: number; valid_rows: number } | null>(null);
  const [validating, setValidating] = useState(false);
  const [merging, setMerging] = useState(false);

  // Batch history
  const [batches, setBatches] = useState<LeadUploadBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);

  // ── Auth ──
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace('/'); return; }
      setEmail(data.session.user.email ?? '');
      setAccessToken(data.session.access_token);
      const { isAdmin } = await checkIsAdmin(supabase);
      if (!isAdmin) { setNotAdmin(true); setReady(true); return; }
      setReady(true);
      loadBatches();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setAccessToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadBatches = async () => {
    setLoadingBatches(true);
    const { data } = await supabase
      .from('lead_upload_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    setBatches((data ?? []) as LeadUploadBatch[]);
    setLoadingBatches(false);
  };

  // ── File handling ──
  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv')) { toast('Please select a .csv file', 'error'); return; }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, rows } = parseCSV(e.target?.result as string);
      setParsedHeaders(headers);
      setParsedRows(rows);
    };
    reader.readAsText(file);
    // Reset results when new file picked
    setUploadResult(null); setValidateResult(null); setMergeResult(null);
    setActiveBatch(null); setStagingRows([]);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Upload to staging (via server API route) ──
  const handleUpload = async () => {
    if (!csvFile || !accessToken) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', csvFile);
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) { toast(json.error ?? 'Upload failed', 'error'); return; }
      setUploadResult(json as { batch_id: string; total_rows: number });
      toast(`${json.total_rows} rows staged successfully`);
      await loadBatches();
      // Auto-load the new batch staging rows
      const { data: nb } = await supabase.from('lead_upload_batches').select('*').eq('id', json.batch_id).single();
      if (nb) { setActiveBatch(nb as LeadUploadBatch); await loadStagingRows(json.batch_id); }
    } finally {
      setUploading(false);
    }
  };

  // ── Validate ──
  const handleValidate = async () => {
    if (!activeBatch || !accessToken) return;
    setValidating(true);
    try {
      const res = await fetch('/api/admin/upload/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ batchId: activeBatch.id }),
      });
      const json = await res.json();
      if (!res.ok) { toast(json.error ?? 'Validation failed', 'error'); return; }
      setValidateResult(json as { total_rows: number; valid_rows: number; invalid_rows: number });
      toast('Validation complete');
      await loadBatches();
      await loadStagingRows(activeBatch.id);
      const { data: nb } = await supabase.from('lead_upload_batches').select('*').eq('id', activeBatch.id).single();
      if (nb) setActiveBatch(nb as LeadUploadBatch);
    } finally {
      setValidating(false);
    }
  };

  // ── Merge ──
  const handleMerge = async () => {
    if (!activeBatch || !accessToken) return;
    if (!confirm(`Merge ${activeBatch.total_rows} validated rows into production leads? This cannot be undone.`)) return;
    setMerging(true);
    try {
      const res = await fetch('/api/admin/upload/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ batchId: activeBatch.id }),
      });
      const json = await res.json();
      if (!res.ok) { toast(json.error ?? 'Merge failed', 'error'); return; }
      setMergeResult(json as { inserted_rows: number; skipped_rows: number; valid_rows: number });
      toast(`Merged! ${json.inserted_rows} new leads added`);
      await loadBatches();
      const { data: nb } = await supabase.from('lead_upload_batches').select('*').eq('id', activeBatch.id).single();
      if (nb) setActiveBatch(nb as LeadUploadBatch);
    } finally {
      setMerging(false);
    }
  };

  const loadStagingRows = async (batchId: string) => {
    setLoadingStaging(true);
    const { data } = await supabase
      .from('lead_upload_staging')
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true })
      .limit(200);
    setStagingRows((data ?? []) as LeadUploadStagingRow[]);
    setLoadingStaging(false);
  };

  const openBatch = async (b: LeadUploadBatch) => {
    setActiveBatch(b);
    setValidateResult(null); setMergeResult(null);
    await loadStagingRows(b.id);
  };

  // ── Loading / Not admin ──
  if (!ready) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <Loader2 size={24} color="#6b7280" style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (notAdmin) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5', flexDirection: 'column', gap: '12px' }}>
      <AlertTriangle size={32} color="#dc2626" />
      <p style={{ fontSize: '15px', fontWeight: 700, color: '#111827' }}>Not authorized</p>
      <p style={{ fontSize: '13px', color: '#6b7280' }}>Admin role required to access this page.</p>
      <button onClick={() => router.push('/dashboard')} style={{ marginTop: '8px', padding: '8px 18px', background: '#111827', color: '#fff', border: 'none', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit' }}>
        Back to Dashboard
      </button>
    </div>
  );

  const invalidCount = stagingRows.filter(r => !r.is_valid).length;
  const validCount = stagingRows.filter(r => r.is_valid).length;

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', paddingBottom: '3rem' }}>
      <TopNav email={email} role="admin" currentPath="/admin/upload" />

      <div style={{ maxWidth: '1320px', margin: '0 auto', padding: '1.5rem', display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.25rem', alignItems: 'start' }}>

        {/* ──────── LEFT COLUMN ──────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Upload card */}
          <Card>
            <CardTitle icon={<Upload size={14} color="#6b7280" />}>Upload CSV</CardTitle>
            <p style={{ fontSize: '11.5px', color: '#9ca3af', marginBottom: '1rem', lineHeight: 1.5 }}>
              Expected columns: Full Contact Name, Title/Role, Validated Corporate Email, Phone Number, Company Name, Website, State, Regulation Type, Filing Date (YYYY-MM-DD), SEC Filing URL
            </p>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              style={{ border: `2px dashed ${dragging ? '#111827' : '#e5e7eb'}`, borderRadius: '10px', padding: '1.25rem', textAlign: 'center', cursor: 'pointer', background: dragging ? '#f9fafb' : '#fafafa', transition: 'all 0.15s', marginBottom: '1rem' }}
            >
              <Upload size={18} color={dragging ? '#111827' : '#9ca3af'} style={{ margin: '0 auto 8px', display: 'block' }} />
              <p style={{ fontSize: '12.5px', fontWeight: 600, color: csvFile ? '#111827' : '#6b7280' }}>
                {csvFile ? csvFile.name : 'Drop CSV here or click to browse'}
              </p>
              {parsedRows.length > 0 && <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px' }}>{parsedRows.length} rows detected</p>}
              <input ref={fileRef} type="file" accept=".csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} style={{ display: 'none' }} />
            </div>

            {/* Detected headers */}
            {parsedHeaders.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '5px' }}>Detected headers ({parsedHeaders.length})</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {parsedHeaders.map(h => (
                    <span key={h} style={{ fontSize: '10.5px', padding: '1px 7px', background: '#f3f4f6', color: '#374151', borderRadius: '4px', border: '1px solid #e5e7eb' }}>{h}</span>
                  ))}
                </div>
              </div>
            )}

            {parsedRows.length > 0 && (
              uploading ? (
                <div style={{ textAlign: 'center', padding: '8px' }}>
                  <Loader2 size={18} color="#6b7280" style={{ animation: 'spin 1s linear infinite', display: 'inline' }} />
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>Uploading to staging…</p>
                </div>
              ) : (
                <button onClick={handleUpload} style={{ width: '100%', padding: '9px', background: '#111827', color: '#fff', border: 'none', borderRadius: '9px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  <ArrowRight size={13} /> Upload {parsedRows.length} rows to Staging
                </button>
              )
            )}
          </Card>

          {/* Results panel */}
          {(uploadResult || validateResult || mergeResult) && (
            <Card>
              <CardTitle icon={<ClipboardList size={14} color="#6b7280" />}>Results</CardTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {uploadResult && (
                  <>
                    <ResultRow label="Batch ID" val={uploadResult.batch_id.slice(0, 8) + '…'} />
                    <ResultRow label="Total rows" val={uploadResult.total_rows} />
                  </>
                )}
                {validateResult && (
                  <>
                    <ResultRow label="Valid rows" val={validateResult.valid_rows} color="#15803d" />
                    <ResultRow label="Invalid rows" val={validateResult.invalid_rows} color={validateResult.invalid_rows > 0 ? '#dc2626' : undefined} />
                  </>
                )}
                {mergeResult && (
                  <>
                    <ResultRow label="Inserted (new)" val={mergeResult.inserted_rows} color="#15803d" />
                    <ResultRow label="Skipped (dupes)" val={mergeResult.skipped_rows} color="#9ca3af" />
                  </>
                )}
              </div>
            </Card>
          )}

          {/* Batch history */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <CardTitle icon={<ClipboardList size={14} color="#6b7280" />}>Batch History (last 20)</CardTitle>
              <button onClick={loadBatches} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0 }}><RotateCcw size={13} /></button>
            </div>
            {loadingBatches ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: '#9ca3af' }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /></div>
            ) : batches.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', padding: '0.75rem 0' }}>No batches yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {batches.map(b => (
                  <div key={b.id} onClick={() => openBatch(b)} style={{ padding: '0.625rem 0.75rem', borderRadius: '8px', cursor: 'pointer', border: `1px solid ${activeBatch?.id === b.id ? '#111827' : '#f3f4f6'}`, background: activeBatch?.id === b.id ? '#f9fafb' : '#fafafa', transition: 'all 0.12s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#111827', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.filename ?? 'Unnamed'}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#9ca3af' }}>{b.total_rows} rows</span>
                      {b.status === 'merged' && <span style={{ fontSize: '11px', color: '#15803d' }}>+{b.inserted_rows} new</span>}
                      <span style={{ fontSize: '11px', color: '#d1d5db', marginLeft: 'auto' }}>{new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ──────── RIGHT COLUMN ──────── */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' }}>

          {!activeBatch ? (
            <div style={{ padding: '5rem', textAlign: 'center', color: '#9ca3af' }}>
              <Table size={30} style={{ marginBottom: '12px', opacity: 0.3, display: 'block', margin: '0 auto 12px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>No batch selected</p>
              <p style={{ fontSize: '12.5px' }}>Upload a CSV or click a batch from the history to preview staging rows.</p>
            </div>
          ) : (
            <>
              {/* Batch header + actions */}
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <h2 style={{ fontSize: '15px', fontWeight: 800, color: '#111827' }}>{activeBatch.filename ?? 'Batch'}</h2>
                      <StatusBadge status={activeBatch.status} />
                    </div>
                    <p style={{ fontSize: '11.5px', color: '#9ca3af' }}>
                      ID: <code style={{ fontSize: '11px' }}>{activeBatch.id}</code> · {activeBatch.total_rows} rows · {new Date(activeBatch.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    {(activeBatch.status === 'uploaded' || activeBatch.status === 'validated') && (
                      <button onClick={handleValidate} disabled={validating} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' }}>
                        {validating ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={12} />}
                        Validate
                      </button>
                    )}
                    {activeBatch.status === 'validated' && (
                      <button onClick={handleMerge} disabled={merging || invalidCount > 0} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', border: 'none', borderRadius: '8px', background: invalidCount > 0 ? '#f3f4f6' : '#111827', color: invalidCount > 0 ? '#9ca3af' : '#fff', fontSize: '12.5px', fontWeight: 700, cursor: invalidCount > 0 || merging ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: merging ? 0.7 : 1 }}>
                        {merging ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Merge size={12} />}
                        Approve & Merge
                      </button>
                    )}
                    {activeBatch.status === 'merged' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '8px', background: '#f0fdf4', color: '#15803d', fontSize: '12.5px', fontWeight: 700 }}>
                        <CheckCircle2 size={12} />
                        {activeBatch.inserted_rows} merged · {activeBatch.skipped_rows} dupes skipped
                      </div>
                    )}
                  </div>
                </div>

                {/* Validate result inline */}
                {validateResult && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ padding: '5px 12px', borderRadius: '7px', background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '12px', color: '#15803d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <CheckCircle2 size={12} />{validateResult.valid_rows} valid
                    </div>
                    {validateResult.invalid_rows > 0 && (
                      <div style={{ padding: '5px 12px', borderRadius: '7px', background: '#fef2f2', border: '1px solid #fecaca', fontSize: '12px', color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <XCircle size={12} />{validateResult.invalid_rows} invalid — fix before merging
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Row stats */}
              <div style={{ padding: '0.5rem 1.5rem', background: '#fafafa', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: '1.25rem' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>Showing <strong style={{ color: '#111827' }}>{stagingRows.length}</strong> rows</span>
                {validCount > 0 && <span style={{ fontSize: '12px', color: '#15803d', fontWeight: 600 }}>{validCount} valid</span>}
                {invalidCount > 0 && <span style={{ fontSize: '12px', color: '#dc2626', fontWeight: 600 }}>{invalidCount} invalid</span>}
              </div>

              {/* Preview: first 10 rows table */}
              {!activeBatch && parsedRows.length > 0 && (
                <PreviewTable headers={parsedHeaders} rows={parsedRows.slice(0, 10)} />
              )}

              {loadingStaging ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}><Loader2 size={20} color="#9ca3af" style={{ animation: 'spin 1s linear infinite' }} /></div>
              ) : (
                <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                      <tr>
                        {['', 'Company', 'Email', 'Contact', 'Title', 'Phone', 'State', 'Regulation', 'Filing Date', 'Errors'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9ca3af', background: '#f9fafb', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stagingRows.map(row => (
                        <tr key={row.id} style={{ background: row.is_valid ? '#fff' : '#fff9f9' }}>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb' }}>
                            {row.is_valid ? <CheckCircle2 size={12} color="#16a34a" /> : <XCircle size={12} color="#dc2626" />}
                          </td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', fontWeight: 600, color: '#111827', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.company_name ?? <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', color: '#374151', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.validated_corporate_email ?? <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', color: '#374151', whiteSpace: 'nowrap' }}>{row.full_contact_name ?? <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', color: '#6b7280', whiteSpace: 'nowrap', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title_role ?? <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', color: '#6b7280', whiteSpace: 'nowrap' }}>{row.phone_number ?? <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', color: '#374151' }}>{row.state ?? <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', color: '#6b7280', whiteSpace: 'nowrap' }}>{row.regulation_type ?? <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb', color: '#6b7280', whiteSpace: 'nowrap' }}>{row.filing_date ? new Date(row.filing_date).toLocaleDateString() : <Dash />}</td>
                          <td style={{ padding: '6px 10px', borderBottom: '1px solid #f9fafb' }}>
                            {row.validation_errors
                              ? <span style={{ fontSize: '10px', color: '#dc2626', background: '#fef2f2', padding: '1px 5px', borderRadius: '4px' }}>{row.validation_errors.replace(/;$/, '')}</span>
                              : <Dash />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* File preview (before upload) */}
          {!activeBatch && parsedRows.length > 0 && (
            <div style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid #f3f4f6' }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '0.625rem' }}>Preview (first 10 rows)</p>
              <PreviewTable headers={parsedHeaders} rows={parsedRows.slice(0, 10)} />
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Dash() {
  return <span style={{ color: '#d1d5db' }}>—</span>;
}

function ResultRow({ label, val, color }: { label: string; val: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '12px', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '12.5px', fontWeight: 700, color: color ?? '#111827', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
    </div>
  );
}

function PreviewTable({ headers, rows }: { headers: string[]; rows: Record<string, string>[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '5px 8px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9ca3af', background: '#f9fafb', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {headers.map(h => (
                <td key={h} style={{ padding: '5px 8px', borderBottom: '1px solid #f9fafb', color: '#374151', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row[h] || <span style={{ color: '#d1d5db' }}>—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminUploadPage() {
  return (
    <ToastProvider>
      <AdminUploadInner />
    </ToastProvider>
  );
}
