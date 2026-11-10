import type { Metadata } from 'next';
import { TravelProfileClient } from '@/components/account/travel-profile-client';

export const metadata: Metadata = {
  title: 'Travel Profile',
  description: 'Private Globevoy travel preferences for signed-in personalization.'
};

export default function TravelProfilePage() {
  return (
    <div className="gv-travel-profile-page">
      <TravelProfileClient />
    </div>
  );
}
