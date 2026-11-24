(function () {
  'use strict';

  const form = document.querySelector('#search');
  const origin = document.querySelector('#from');
  const budget = document.querySelector('#budget');
  const currency = document.querySelector('#currency');
  const travellers = document.querySelector('#travelers');
  const month = document.querySelector('#dates');
  const pace = document.querySelector('#pace');
  const status = document.querySelector('#search-note');
  const registry = window.GlobevoySupportedOrigins;
  const previous = new URLSearchParams(location.search);

  for (const [input, key] of [[origin, 'origin'], [budget, 'budget'], [currency, 'currency'], [travellers, 'adults'], [month, 'preferredMonth'], [pace, 'travelPace']]) {
    if (previous.has(key)) input.value = previous.get(key);
  }
  origin.dispatchEvent(new Event('input'));
  travellers.dispatchEvent(new Event('input'));

  origin.addEventListener('input', () => {
    const matches = registry.matching(origin.value).slice(0, 8);
    const options = matches.map(item => new Option(registry.label(item)));
    document.querySelector('#cities').replaceChildren(...options);
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!origin.value.trim()) {
      status.textContent = 'Enter a departure city or airport.';
      origin.focus();
      return;
    }
    const adults = Number(travellers.value);
    const query = new URLSearchParams({
      mode: 'generated-tour', recommendationScope: 'generated-multicity-tour', generated: 'true',
      origin: origin.value.trim(), budget: budget.value, currency: currency.value,
      passengers: String(adults), adults: String(adults), children: '0',
      travellers: adults + (adults === 1 ? ' adult' : ' adults'),
      tripLength: 'auto', adaptiveDuration: 'true', dateMode: 'flexible', flexible: 'true',
      travelPace: pace.value, region: 'All continents',
    });
    if (month.value) {
      query.set('month', month.value);
      query.set('preferredMonth', month.value);
      query.set('flexibility', 'month');
    }
    query.set('returnTo', 'index.html?' + query.toString());
    location.assign('multicity-visualizer.html?' + query.toString());
  });

  const locate = document.querySelector('#locate');
  locate.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Location is unavailable. Enter a departure city.';
      return;
    }
    locate.disabled = true;
    status.textContent = 'Finding an airport near you…';
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      // Compare on the sphere so the same search works across the date line.
      const radians = Math.PI / 180;
      const latitude = coords.latitude * radians;
      let best = null;
      let bestScore = -Infinity;
      for (const item of registry.all()) {
        if (!Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lng))) continue;
        const itemLatitude = Number(item.lat) * radians;
        const score = Math.sin(latitude) * Math.sin(itemLatitude) + Math.cos(latitude) *
          Math.cos(itemLatitude) * Math.cos((Number(item.lng) - coords.longitude) * radians);
        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
      if (best) {
        origin.value = registry.label(best);
        origin.dispatchEvent(new Event('input'));
        status.textContent = 'Using ' + origin.value + ' as your departure city.';
      } else {
        status.textContent = 'No nearby airport found. Enter a departure city.';
      }
      locate.disabled = false;
    }, () => {
      locate.disabled = false;
      status.textContent = 'Location is unavailable. Enter a departure city.';
    }, { timeout: 7000, maximumAge: 300000 });
  });

  const signIn = document.querySelector('#signin');
  const auth = window.GlobevoyAuth705B;
  if (auth?.getSession?.()) {
    signIn.textContent = 'My trips';
    signIn.addEventListener('click', () => location.assign('react/my-trips/'));
  } else {
    signIn.addEventListener('click', () => {
      if (auth?.authEnabled?.()) void auth.beginSignIn({ returnTo: location.pathname + location.search });
      else location.assign('sign-in.html');
    });
  }
})();
