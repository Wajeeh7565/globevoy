import type { Metadata } from 'next';
import { MyTripsRedirect } from '@/components/account/my-trips-redirect';

// GV-WEB-4: saved trips were removed from the website. The old address opens the Account page.
export const metadata: Metadata = {
  title: 'Account',
  description: 'Your GlobeVoy account.'
};

export default function MyTripsPage() {
  return <MyTripsRedirect />;
}
