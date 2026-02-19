'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { TopNav } from '@/components/TopNav';
import { ToastProvider, useToast } from '@/components/Toast';
import { buildEntitlementSet } from '@/lib/entitlements';
import { emailMask, phoneMask } from '@/lib/mask';
import type { Lead, UserProfile, CreditLedgerEntry, BusinessMode } from '@/types';
import {
  Download, Search, CreditCard, TrendingUp, Users,
  Loader2, RefreshCw, CheckSquare, Square, ToggleLeft,
  ToggleRight, Star, Lock, Unlock, Filter, SortAsc,
  FileText, ChevronDown, X, AlertCircle
} from 'lucide-react';

function DashboardInner() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();
  const { toast } = useToast();

  // Auth state
  const [userId, setUserId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [email, setEmail] = useState('');

  // Data
  const [leads, setLeads] = useState<Lead[]>([]);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [entitledIds, setEntitledIds] = useState<Set<string>>(new Set());
  const [claimsRollup, setClaimsRollup] = useState<Record<string, { claimants: number; is_premium: boolean }>>({});

  // Loading
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [updatingRule, setUpdatingRule] = useState(false);
  const [exportingLedger, setExportingLedger] = useState(false);

  // UI state
  const [search, setSearch] = useState('');
  const [filterIndustry, setFilterIndustry] = useState('All');
  const [filterState, setFilterState] = useState('All');
  const [sortBy, setSortBy] = useState<'newest' | 'score' | 'company'>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const balance = ledger.reduce((s, r) => s + r.delta, 0);

  // Init auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace('/'); return; }
      setUserId(data.session.user.id);
      setEmail(data.session.user.email ?? '');
      setAccessToken(data.session.access_token);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) { router.replace('/'); return; }
      setAccessToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load data when auth ready
  useEffect(() => {
    if (!userId || !accessToken) return;
    loadAll();
  }, [userId, accessToken]);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [
        { data: leadsData },
        { data: ledgerData },
        { data: accessData },
        { data: profileData },
        { data: rollupData },
      ] = await Promise.all([
        supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(250),
        supabase.from('credit_ledger').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
        supabase.from('dataset_access').select('record_id, dataset').eq('dataset', 'leads').eq('user_id', userId),
        supabase.from('user_profiles').select('*').eq('id', userId).single(),
        supabase.from('leads_claims_rollup').select('*'),
      ]);

      setLeads(leadsData ?? []);
      setLedger(ledgerData ?? []);
      setEntitledIds(buildEntitlementSet(accessData ?? [], 'leads'));
      if (profileData) setProfile(profileData as UserProfile);

      // Build rollup map
      const rollup: Record<string, { claimants: number; is_premium: boolean }> = {};
      (rollupData ?? []).forEach((r: { lead_id: string; claimants: number; is_premium: boolean }) => {
        rollup[r.lead_id] = { claimants: r.claimants, is_premium: r.is_premium };
      });
      setClaimsRollup(rollup);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Filter + sort leads
  const industries = ['All', ...Array.from(new Set(leads.map((l) => l.industry).filter(Boolean))) as string[]];
  const states = ['All', ...Array.from(new Set(leads.map((l) => l.state).filter(Boolean))) as string[]];

  const filtered = leads
    .filter((l) => {
      if (filterIndustry !== 'All' && l.industry !== filterIndustry) return false;
      if (filterState !== 'All' && l.state !== filterState) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.company.toLowerCase().includes(q) ||
          (l.contact_name ?? '').toLowerCase().includes(q) ||
          (l.email ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'score') return b.intelligence_score - a.intelligence_score;
      if (sortBy === 'company') return a.company.localeCompare(b.company);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  // Lead status logic
  const getLeadStatus = (lead: Lead): { status: 'downloaded' | 'available' | 'locked'; dlInfo: string } => {
    const entitled = entitledIds.has(lead.id);
    if (entitled) return { status: 'downloaded', dlInfo: 'unlocked' };

    const rollup = claimsRollup[lead.id] ?? { claimants: 0, is_premium: lead.is_premium };
    const mode = profile?.business_rule ?? 'hybrid';

    if (mode === 'exclusive_only') {
      if (rollup.claimants >= 1) return { status: 'locked', dlInfo: 'claimed' };
      return { status: 'available', dlInfo: `dl: 0/1` };
    }
    // hybrid
    if (lead.is_premium) {
      if (rollup.claimants >= 1) return { status: 'locked', dlInfo: 'exclusive claimed' };
      return { status: 'available', dlInfo: 'dl: 0/1' };
    }
    if (rollup.claimants >= 3) return { status: 'locked', dlInfo: 'dl: 3/3' };
    return { status: 'available', dlInfo: `dl: ${rollup.claimants}/3` };
  };

  // Selection
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(filtered.map((l) => l.id)));
  const clearSelection = () => setSelected(new Set());

  const selectedLeads = filtered.filter((l) => selected.has(l.id));
  const premiumInSelection = selectedLeads.filter((l) => l.is_premium).length;
  const newClaimsCount = selectedLeads.filter((l) => !entitledIds.has(l.id)).length;

  // Toggle business rule
  const toggleBusinessRule = async () => {
    if (!accessToken || !profile) return;
    setUpdatingRule(true);
    const newRule: BusinessMode = profile.business_rule === 'hybrid' ? 'exclusive_only' : 'hybrid';
    const res = await fetch('/api/profile/business-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ business_rule: newRule }),
    });
    if (res.ok) {
      setProfile((p) => p ? { ...p, business_rule: newRule } : p);
      toast(`Switched to ${newRule === 'hybrid' ? 'Hybrid' : 'Exclusive-only'} mode`);
    } else {
      toast('Failed to update business rule', 'error');
    }
    setUpdatingRule(false);
  };

  // Download CSV
  const handleDownload = async () => {
    if (!accessToken || selected.size === 0) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/leads/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast(err.error ?? 'Download failed', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `verifiedmeasure-leads-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Downloaded ${selected.size} leads`);
      await loadAll();
      clearSelection();
    } finally {
      setDownloading(false);
    }
  };

  // Export ledger
  const handleExportLedger = async () => {
    if (!accessToken) return;
    setExportingLedger(true);
    const res = await fetch('/api/ledger/export', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vm-credit-history.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast('Credit history exported');
    } else {
      toast('Export failed', 'error');
    }
    setExportingLedger(false);
  };

  // Admin grant credits
  const handleBuyTokens = async () => {
    if (!accessToken) return;
    if (profile?.role !== 'admin') {
      toast('Token purchase coming soon. Contact your administrator.', 'error');
      return;
    }
    const res = await fetch('/api/admin/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ amount: 100, reason: 'demo_purchase' }),
    });
    if (res.ok) {
      toast('100 tokens added!');
      await loadAll();
    } else {
      toast('Failed to grant tokens', 'error');
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#6b7280', marginBottom: '12px' }} />
          <p style={{ color: '#6b7280', fontSize: '13px' }}>Loading your workspace…</p>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <TopNav email={email} role={profile?.role ?? 'user'} currentPath="/dashboard" />

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.5rem', display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.25rem', alignItems: 'start' }}>

        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Token Balance Card */}
          <div className="vm-card" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <CreditCard size={15} color="#6b7280" />
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>Token Balance</span>
              </div>
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px',
                background: '#dcfce7', color: '#15803d', letterSpacing: '0.04em',
              }}>Active</span>
            </div>
            <p style={{ fontSize: '11.5px', color: '#9ca3af', marginBottom: '1rem', lineHeight: 1.4 }}>
              1 token = 1 new lead access. Re-downloads are free.
            </p>
            <div style={{ fontSize: '48px', fontWeight: 800, letterSpacing: '-0.03em', color: '#111827', marginBottom: '1rem' }}>
              {balance}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem' }}>
              <button
                onClick={handleBuyTokens}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  padding: '8px', background: '#111827', color: '#fff', border: 'none',
                  borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <CreditCard size={13} />
                Buy Tokens (demo)
              </button>
              <button
                onClick={handleExportLedger}
                disabled={exportingLedger}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  padding: '8px', background: '#fff', color: '#374151', border: '1px solid #e5e7eb',
                  borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {exportingLedger ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={12} />}
                Export History
              </button>
            </div>

            {/* Business Rules */}
            <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '1rem' }}>
              <p style={{ fontSize: '11.5px', fontWeight: 700, color: '#111827', marginBottom: '0.75rem', letterSpacing: '0.03em' }}>
                BUSINESS RULES
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '0.75rem' }}>
                {/* Hybrid */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12.5px', color: '#374151' }}>Hybrid model (recommended)</span>
                  <button
                    onClick={!updatingRule ? toggleBusinessRule : undefined}
                    style={{
                      width: '42px', height: '23px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                      background: profile?.business_rule === 'hybrid' ? '#111827' : '#e5e7eb',
                      position: 'relative', transition: 'background 0.2s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: '2px',
                      left: profile?.business_rule === 'hybrid' ? '21px' : '2px',
                      width: '19px', height: '19px', background: '#fff', borderRadius: '50%',
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }} />
                  </button>
                </div>
                {/* Exclusive */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12.5px', color: '#374151' }}>Exclusive-only model</span>
                  <button
                    onClick={!updatingRule ? toggleBusinessRule : undefined}
                    style={{
                      width: '42px', height: '23px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                      background: profile?.business_rule === 'exclusive_only' ? '#111827' : '#e5e7eb',
                      position: 'relative', transition: 'background 0.2s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: '2px',
                      left: profile?.business_rule === 'exclusive_only' ? '21px' : '2px',
                      width: '19px', height: '19px', background: '#fff', borderRadius: '50%',
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }} />
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
                {profile?.business_rule === 'hybrid'
                  ? 'Hybrid: premium leads are exclusive; standard leads allow up to 3 downloads.'
                  : 'Exclusive-only: every lead can only be claimed by one buyer.'}
              </p>
            </div>

            {/* Stats */}
            <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '0.875rem', marginTop: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>Visible pool (demo)</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#111827' }}>{leads.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>My downloaded leads</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#111827' }}>{entitledIds.size}</span>
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div className="vm-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
              <TrendingUp size={14} color="#6b7280" />
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>Transactions</span>
            </div>
            <p style={{ fontSize: '11.5px', color: '#9ca3af', marginBottom: '1rem' }}>Audit trail for token economy.</p>

            {ledger.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#9ca3af', fontSize: '12px' }}>
                No transactions yet
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {['Time', 'Type', 'Amount'].map((h) => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '5px 0', color: '#9ca3af',
                        fontWeight: 600, borderBottom: '1px solid #f3f4f6',
                        fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledger.slice(0, 10).map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ padding: '6px 0', color: '#6b7280' }}>
                        {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td style={{ padding: '6px 0', color: '#374151' }}>
                        {entry.reason}
                      </td>
                      <td style={{ padding: '6px 0', fontWeight: 600, color: entry.delta >= 0 ? '#15803d' : '#dc2626' }}>
                        {entry.delta >= 0 ? '+' : ''}{entry.delta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Lead Browser */}
        <div className="vm-card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f3f4f6' }}>
            <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#111827', marginBottom: '3px' }}>Lead Browser</h2>
            <p style={{ fontSize: '12px', color: '#9ca3af' }}>
              Filter/search the visible pool. Select leads and export CSV. Token deduction occurs only for first-time downloads.
            </p>
          </div>

          {/* Filters */}
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #f3f4f6', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            {/* Search */}
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '180px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, contact, email…"
                style={{
                  width: '100%', padding: '7px 10px 7px 30px',
                  border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12.5px',
                  outline: 'none', fontFamily: 'inherit', background: '#fafafa',
                }}
              />
            </div>

            {/* Industry */}
            <select
              value={filterIndustry} onChange={(e) => setFilterIndustry(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12.5px', fontFamily: 'inherit', background: '#fafafa', outline: 'none', cursor: 'pointer' }}
            >
              {industries.map((i) => <option key={i}>{i}</option>)}
            </select>

            {/* State */}
            <select
              value={filterState} onChange={(e) => setFilterState(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12.5px', fontFamily: 'inherit', background: '#fafafa', outline: 'none', cursor: 'pointer' }}
            >
              {states.map((s) => <option key={s}>{s}</option>)}
            </select>

            {/* Sort */}
            <select
              value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12.5px', fontFamily: 'inherit', background: '#fafafa', outline: 'none', cursor: 'pointer' }}
            >
              <option value="newest">Newest</option>
              <option value="score">Highest Score</option>
              <option value="company">Company A–Z</option>
            </select>

            <button onClick={selectAll} style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12.5px', fontFamily: 'inherit', background: '#fafafa', cursor: 'pointer', fontWeight: 500 }}>
              Select all ({filtered.length})
            </button>
            <button onClick={clearSelection} style={{ padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12.5px', fontFamily: 'inherit', background: '#fafafa', cursor: 'pointer', fontWeight: 500 }}>
              Clear
            </button>
            <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
              Showing <strong style={{ color: '#374151' }}>{filtered.length}</strong> leads
            </span>
          </div>

          {/* Selection bar */}
          <div style={{
            padding: '0.625rem 1.5rem',
            background: selected.size > 0 ? '#f8f9fa' : '#fafafa',
            borderBottom: '1px solid #f3f4f6',
            display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
          }}>
            <div style={{
              padding: '5px 12px', background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: '8px', fontSize: '12px',
            }}>
              <span style={{ color: '#6b7280' }}>Selected:</span>{' '}
              <strong style={{ color: '#111827' }}>{selected.size}</strong>
            </div>
            <div style={{
              padding: '5px 12px', background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: '8px', fontSize: '12px',
            }}>
              <span style={{ color: '#6b7280' }}>Premium in selection:</span>{' '}
              <strong style={{ color: '#111827' }}>{premiumInSelection}</strong>
            </div>
            <div style={{ fontSize: '12.5px', color: '#6b7280', flex: 1 }}>
              Token cost now: <strong style={{ color: '#111827' }}>{newClaimsCount}</strong> <span style={{ color: '#9ca3af' }}>(new claims only)</span>
            </div>
            <button
              onClick={handleDownload}
              disabled={selected.size === 0 || downloading}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', background: selected.size === 0 ? '#d1d5db' : '#111827',
                color: '#fff', border: 'none', borderRadius: '9px',
                fontSize: '12.5px', fontWeight: 600, cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'background 0.15s',
              }}
            >
              {downloading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
              Download Selected CSV
            </button>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
                <Search size={28} style={{ marginBottom: '8px', opacity: 0.4 }} />
                <p style={{ fontSize: '13px' }}>No leads match your filters.</p>
              </div>
            ) : (
              <table className="vm-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }}></th>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Industry</th>
                    <th>Location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((lead) => {
                    const { status, dlInfo } = getLeadStatus(lead);
                    const entitled = entitledIds.has(lead.id);
                    const isSelected = selected.has(lead.id);

                    return (
                      <tr key={lead.id} style={{ background: isSelected ? '#f0f9ff' : undefined }}>
                        <td style={{ paddingLeft: '1rem' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(lead.id)}
                            style={{ cursor: 'pointer', accentColor: '#111827', width: '14px', height: '14px' }}
                          />
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 600, color: '#111827', fontSize: '13.5px' }}>{lead.company}</span>
                              {lead.is_premium && <span className="premium-badge">Premium</span>}
                            </div>
                            <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
                              {lead.stage} · {entitled ? lead.website ?? '—' : '•••••••••••'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontWeight: 500, color: '#374151', fontSize: '13px' }}>
                              {entitled ? (lead.contact_name ?? '—') : `Contact ${lead.id.slice(0, 4)}`}
                            </span>
                            <span style={{ fontSize: '11.5px', color: '#9ca3af' }}>
                              {entitled ? phoneMask(lead.phone) : phoneMask(lead.phone)}
                            </span>
                            <span style={{ fontSize: '11.5px', color: '#6b7280' }}>
                              {entitled ? lead.email : emailMask(lead.email)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: '13px', color: '#374151' }}>{lead.industry ?? '—'}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: '13px', color: '#374151' }}>{lead.state ?? '—'}</span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <span className={`status-${status}`}>{status}</span>
                            <span style={{ fontSize: '10.5px', color: '#9ca3af' }}>{dlInfo}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}
