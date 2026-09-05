import type { Metadata } from 'next';
import { TripReviewClient710G } from '@/components/booking/trip-review-client-710g';

export const metadata: Metadata = {
  title: 'Trip Review',
  description: 'Review a saved Globevoy trip, refresh supported price evidence and continue to external travel partners.'
};

export default function BookingPage() {
  return <TripReviewClient710G />;
}
