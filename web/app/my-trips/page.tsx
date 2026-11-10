import type { Metadata } from 'next';
import { MyTripsClient } from '@/components/account/my-trips-client';

export const metadata: Metadata = {
  title: 'My Trips · Globevoy',
  description: 'Private Saved Trips in your Globevoy account.'
};

export default function MyTripsPage() {
  return (
    <div className="gv-my-trips-page">
      <MyTripsClient />
    </div>
  );
}
