'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { Shield, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';

export default function AuthPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/dashboard');
      } else {
        setCheckingSession(false);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        router.replace('/dashboard');
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        setMessage('Check your email to confirm your account before signing in.');
        setLoading(false);
      }
    }
  };

  if (checkingSession) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#6b7280' }} />
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f0f2f5 0%, #e8ecf0 50%, #f0f2f5 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none'%3E%3Cg fill='%23000000' fill-opacity='0.04'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }} />

      <div style={{
        width: '100%', maxWidth: '420px', position: 'relative', zIndex: 1,
        animation: 'fadeIn 0.3s ease',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            background: '#111827', color: '#fff', padding: '10px 18px',
            borderRadius: '12px', marginBottom: '1.25rem',
          }}>
            <Shield size={20} />
            <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.01em' }}>VerifiedMeasure</span>
          </div>
          <p style={{ color: '#6b7280', fontSize: '13px' }}>
            Governed access to curated data products
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '16px',
          padding: '2rem',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}>
          {/* Tab toggle */}
          <div style={{
            display: 'flex', background: '#f3f4f6', borderRadius: '10px',
            padding: '3px', marginBottom: '1.5rem',
          }}>
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); setMessage(''); }}
                style={{
                  flex: 1, padding: '7px 0', border: 'none', cursor: 'pointer',
                  borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  transition: 'all 0.15s',
                  background: mode === m ? '#fff' : 'transparent',
                  color: mode === m ? '#111827' : '#6b7280',
                  boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  fontFamily: 'inherit',
                }}
              >
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Email address
              </label>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                style={{
                  width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb',
                  borderRadius: '8px', fontSize: '13.5px', outline: 'none',
                  fontFamily: 'inherit', transition: 'border-color 0.15s',
                  background: '#fafafa',
                }}
                onFocus={(e) => e.target.style.borderColor = '#111827'}
                onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
              />
            </div>

            <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Minimum 8 characters' : 'Your password'}
                  style={{
                    width: '100%', padding: '9px 36px 9px 12px', border: '1px solid #e5e7eb',
                    borderRadius: '8px', fontSize: '13.5px', outline: 'none',
                    fontFamily: 'inherit', transition: 'border-color 0.15s',
                    background: '#fafafa',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#111827'}
                  onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                />
                <button
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af',
                    padding: '2px',
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
                padding: '10px 12px', marginBottom: '1rem',
                fontSize: '12.5px', color: '#dc2626',
              }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
                padding: '10px 12px', marginBottom: '1rem',
                fontSize: '12.5px', color: '#15803d',
              }}>
                {message}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', padding: '10px', background: '#111827', color: '#fff',
                border: 'none', borderRadius: '9px', fontSize: '13.5px', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                transition: 'opacity 0.15s',
              }}
            >
              {loading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
              {!loading && <ArrowRight size={15} />}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '11.5px', marginTop: '1.25rem' }}>
          By signing in you agree to VerifiedMeasure's terms of service.
        </p>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
