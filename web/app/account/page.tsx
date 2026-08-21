import type { Metadata } from 'next';
import { AccountPageClient } from '@/components/account/account-page-client';

export const metadata: Metadata = {
  title: 'Account · Globevoy',
  description: 'Secure Globevoy account access.'
};

export default function AccountPage() {
  return (
    <div className="gv-account-page">
      <AccountPageClient />
    </div>
  );
}
