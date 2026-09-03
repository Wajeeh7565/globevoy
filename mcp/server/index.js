// GV-DIST-709A MCPB launcher — Claude Desktop compatibility shim.
//
// The core MCP tool returns both `content` and `structuredContent`. MCP Inspector
// exposes both, but Claude Desktop currently surfaces only the text `content`
// to the model for this local extension flow. Preserve the reviewed tool logic
// in src/server.ts and augment only outbound tool-call results here so Claude
// receives the same price/evidence semantics that Inspector already sees.

const originalWrite = process.stdout.write.bind(process.stdout);
let pending = '';

function amountText(price) {
  if (!price || typeof price !== 'object') return 'not provided';
  const amount = Number(price.amount);
  const currency = String(price.currency || '').trim();
  const basis = String(price.basis || '').trim();
  if (!Number.isFinite(amount)) return 'not provided';
  return `${currency || 'currency?'} ${amount}${basis ? ` (${basis})` : ''}`;
}

function structuredSummary(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.recommendations)) return '';

  const lines = [
    `Globevoy structured trip details${data.version ? ` — ${data.version}` : ''}:`
  ];

  data.recommendations.forEach((trip, index) => {
    const pricing = trip?.pricing || {};
    const evidence = pricing.evidence || {};
    const budget = trip?.budget || {};
    const booking = trip?.booking || {};

    lines.push(
      `${index + 1}. ${trip?.title || 'Trip'} | ` +
      `route: ${trip?.route || 'not provided'} | ` +
      `nights: ${trip?.nights ?? 'not provided'} | ` +
      `total: ${amountText(pricing.total)} | ` +
      `flight: ${amountText(pricing.flightEstimate)} | ` +
      `hotel: ${amountText(pricing.hotelEstimate)} | ` +
      `evidence: ${evidence.state || 'unknown'}${evidence.label ? ` — ${evidence.label}` : ''} | ` +
      `fits requested budget: ${budget.withinRequestedBudget === true ? 'yes' : budget.withinRequestedBudget === false ? 'no' : 'unknown'} | ` +
      `booking mode: ${booking.mode || 'not provided'}; reservationCreated=${booking.reservationCreated === true}; paymentTaken=${booking.paymentTaken === true}`
    );
  });

  if (data.trust?.reminder) lines.push(`Trust reminder: ${data.trust.reminder}`);
  return lines.join('\n');
}

function augmentLine(line) {
  if (!line.trim()) return line;

  try {
    const message = JSON.parse(line);
    const result = message?.result;
    const summary = structuredSummary(result?.structuredContent);

    if (summary && Array.isArray(result.content)) {
      const alreadyPresent = result.content.some(
        (item) => item?.type === 'text' && String(item.text || '').includes('Globevoy structured trip details')
      );

      if (!alreadyPresent) {
        result.content.push({ type: 'text', text: summary });
      }
    }

    return JSON.stringify(message);
  } catch {
    return line;
  }
}

process.stdout.write = function patchedWrite(chunk, encoding, callback) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8') : String(chunk);
  pending += text;

  let newlineIndex;
  while ((newlineIndex = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newlineIndex);
    pending = pending.slice(newlineIndex + 1);
    originalWrite(`${augmentLine(line)}\n`);
  }

  if (typeof encoding === 'function') encoding();
  else if (typeof callback === 'function') callback();
  return true;
};

await import('../src/server.ts');
