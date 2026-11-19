'use strict';
// Deterministic teaching/demo command. No AWS SDK or provider network requests.
const {fixture}=require('../../tests/backend/fare-map-fixtures.cjs');
const optimizer=require('../../backend/services/domain/fare-map/fare-map-optimizer');
global.fetch=()=>{throw Error('Network forbidden in offline demonstration');};
(async()=>{
 const f=fixture(12);
 if(process.argv.includes('--missing-return'))for(const [key,rows]of f.map)f.map.set(key,rows.filter(r=>r.destination!==f.originCode));
 const result=await optimizer.search({origin:'LHR',budget:5000,travelers:2},{...f.options,rows:f.rows});
 console.log(JSON.stringify({mode:'SYNTHETIC OFFLINE DEMONSTRATION; no bookable inventory',clock:new Date(f.options.now).toISOString(),requested:result.requested,reason:result.reason,
 itineraries:result.tours.map(t=>({role:t.tourRoleLabel,durationNights:t.tripDurationNights,flights:t.legs.map(l=>({from:l.from.airportCode,to:l.to.airportCode,date:l.departureDate,partyEstimateUsd:l.estimatedTransportUsd,evidence:l.providerDateEvidence.sourceType})),
 stays:t.stops.map(s=>({city:s.city,nights:s.nights,rooms:s.hotel.rooms,estimateUsd:s.hotel.estimatedStayUsd,source:s.hotel.costEvidence.source,availabilityVerified:false})),
 totals:{flightsUsd:t.totalFlightEstimateUsd,hotelsUsd:t.totalHotelEstimateUsd,reserveUsd:t.reserveAmountUsd,tripUsd:t.estimatedTotalUsd,budgetUsd:t.totalBudgetUsd,remainingAfterReserveUsd:t.amountLeftUsd}})),diagnostics:result.diagnostics},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
