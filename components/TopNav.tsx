'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { Shield, LogOut, User, Activity, Upload } from 'lucide-react';

interface TopNavProps {
  email: string;
  role: string;
  currentPath?: string;
}

export function TopNav({ email, role, currentPath = '/dashboard' }: TopNavProps) {
  const router = useRouter();
  const supabase = getSupabaseBrowser();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace('/');
  };

  const NavBtn = ({ path, icon, label }: { path: string; icon: React.ReactNode; label: string }) => (
    <button
      onClick={() => router.push(path)}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '5px 10px', borderRadius: '7px',
        fontSize: '13px', fontWeight: 500, border: 'none', cursor: 'pointer',
        background: currentPath === path ? '#f3f4f6' : 'transparent',
        color: currentPath === path ? '#111827' : '#6b7280',
        fontFamily: 'inherit', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (currentPath !== path) e.currentTarget.style.background = '#f9fafb'; }}
      onMouseLeave={e => { if (currentPath !== path) e.currentTarget.style.background = 'transparent'; }}
    >
      {icon}{label}
    </button>
  );

  return (
    <nav style={{ height: '56px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '30px', height: '30px', background: '#111827', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '14.5px', letterSpacing: '-0.01em', color: '#111827' }}>VerifiedMeasure</span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <NavBtn path="/dashboard" icon={<Activity size={13} />} label="Lead Distribution" />
          {role === 'admin' && (
            <NavBtn path="/admin/upload" icon={<Upload size={13} />} label="Admin Upload" />
          )}
        </nav>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', letterSpacing: '0.05em', textTransform: 'capitalize', background: role === 'admin' ? '#111827' : '#f3f4f6', color: role === 'admin' ? '#fff' : '#374151' }}>
          {role}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', border: '1px solid #e5e7eb', borderRadius: '9px', padding: '5px 10px', background: '#fafafa' }}>
          <User size={13} color="#6b7280" />
          <span style={{ fontSize: '12.5px', color: '#374151', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
        </div>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff', cursor: 'pointer', fontSize: '12.5px', color: '#6b7280', fontFamily: 'inherit', transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#6b7280'; }}
        >
          <LogOut size={13} />Sign out
        </button>
      </div>
    </nav>
  );
}
