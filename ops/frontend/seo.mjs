import fs from 'node:fs';
import path from 'node:path';

export const siteOrigin = 'https://globevoy.com';

// Only existing public information pages belong in the sitemap. All other
// classic pages remain reachable, including legacy entry points and drafts.
export const publicPages = new Map([
  ['/', {
    title: 'GlobeVoy | Budget Travel and Multi-City Trip Planner',
    description: 'Find single-city and multi-city trip ideas around your total travel budget. Compare routes, flights and stays, then book directly with travel partners.'
  }],
  ['/about.html', {
    title: 'About GlobeVoy | Budget-First Trip Planning',
    description: 'Learn how GlobeVoy brings routes, transport, stays and booking handoffs together around your group’s total travel budget.'
  }],
  ['/how-it-works.html', {
    title: 'How GlobeVoy Works | From Budget to Itinerary',
    description: 'See how GlobeVoy turns your departure city, budget and timing into trip options you can compare before booking with travel partners.'
  }],
  ['/trust.html', {
    title: 'Trust and Pricing | GlobeVoy',
    description: 'Learn how GlobeVoy describes travel prices and what flight and hotel partners confirm before you book.'
  }]
]);

const previewImage = '/assets/media/scenes/lisbon.jpg';
const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function publicMetadata(route, { title, description }) {
  const canonical = siteOrigin + route;
  const tags = [
    ['og:type', 'website'],
    ['og:site_name', 'GlobeVoy'],
    ['og:title', title],
    ['og:description', description],
    ['og:url', canonical],
    ['og:image', siteOrigin + previewImage],
    ['og:image:alt', 'Aerial view of Lisbon, Portugal'],
    ['twitter:card', 'summary_large_image']
  ];
  const social = tags.map(([key, value]) =>
    `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escapeAttribute(value)}">`
  );
  const metadata = [
    `<title>${title}</title>`,
    `<meta name="description" content="${escapeAttribute(description)}">`,
    `<link rel="canonical" href="${canonical}">`,
    ...social
  ];
  if (route === '/') {
    metadata.push('<script type="application/ld+json">' + JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'GlobeVoy',
      url: canonical
    }) + '</script>');
  }
  return metadata.join('\n');
}

export function withClassicSeo(html, route) {
  const page = publicPages.get(route);
  const head = /<head>([\s\S]*?)<\/head>/i;
  if (!head.test(html)) throw Error('Missing HTML head on ' + route);

  return html.replace(head, (_, original) => {
    const robots = /<meta\s+name=["']robots["'][^>]*>/i;
    const canonical = /<link\s+rel=["']canonical["'][^>]*>/i;
    if (!page) {
      const directives = robots.test(original) ? '' : '\n<meta name="robots" content="noindex">\n';
      return '<head>' + original.replace(canonical, '') + directives + '</head>';
    }
    const headWithoutMetadata = original
      .replace(/<title>[\s\S]*?<\/title>/i, '')
      .replace(/<meta\s+name=["']description["'][^>]*>/i, '')
      .replace(robots, '')
      .replace(canonical, '');
    return '<head>' + headWithoutMetadata + '\n' + publicMetadata(route, page) + '\n</head>';
  });
}

export function writeClassicSeo(output, publicPageSources) {
  for (const { to } of publicPageSources) {
    const name = path.basename(to);
    const file = path.join(output, name);
    const route = name === 'index.html' ? '/' : '/' + name;
    fs.writeFileSync(file, withClassicSeo(fs.readFileSync(file, 'utf8'), route));
  }

  if (!fs.existsSync(path.join(output, previewImage.slice(1)))) throw Error('Missing social preview image');
  for (const route of publicPages.keys()) {
    if (!fs.existsSync(path.join(output, route === '/' ? 'index.html' : route.slice(1)))) {
      throw Error('Missing sitemap destination: ' + route);
    }
  }
  const urls = [...publicPages.keys()].map(route => `  <url><loc>${siteOrigin + route}</loc></url>`);
  fs.writeFileSync(path.join(output, 'sitemap.xml'), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`);
}
