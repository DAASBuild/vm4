/**
 * Masking utilities for preview-mode sensitive fields.
 */

export function emailMask(email: string | null): string {
  if (!email) return '—';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.charAt(0);
  const masked = '•'.repeat(Math.min(local.length - 1, 5));
  return `${visible}${masked}@${domain}`;
}

export function phoneMask(phone: string | null): string {
  if (!phone) return '—';
  // Keep last 2 digits visible
  const digits = phone.replace(/\D/g, '');
  const last2 = digits.slice(-2);
  return `+1 (•••) •••-••${last2}`;
}

export function textBlur(_text: string | null): string {
  return '••••••••';
}

export function maskNpi(npi: string | null): string {
  if (!npi) return '—';
  return `••••${npi.slice(-3)}`;
}

export function maskInsurance(list: string[] | null): string {
  if (!list || list.length === 0) return '—';
  return `${list.length} plans`;
}
