/* GV-UI-631B-R3 — faster, smoother background-only slideshow. */
(function () {
  'use strict';

  const slides = Array.from(document.querySelectorAll('.gv-home-slide'));
  if (slides.length < 2) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ROTATION_MS = 4000;
  let activeIndex = Math.max(0, slides.findIndex((slide) => slide.classList.contains('is-active')));
  let timer = null;

  // Warm the browser cache before later slides are shown. The slideshow does not wait on
  // network completion, so a slow image host cannot block the homepage.
  slides.forEach(function (slide) {
    const match = String(slide.style.backgroundImage || '').match(/url\\(["']?(.*?)["']?\\)/);
    if (!match || !match[1]) return;
    const image = new Image();
    image.decoding = 'async';
    image.src = match[1];
  });

  function setActive(index) {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach(function (slide, slideIndex) {
      const active = slideIndex === activeIndex;
      slide.classList.toggle('is-active', active);
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  function stopTimer() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function restartTimer() {
    stopTimer();
    if (reduceMotion.matches || document.hidden) return;
    timer = window.setInterval(function () {
      setActive(activeIndex + 1);
    }, ROTATION_MS);
  }

  document.addEventListener('visibilitychange', restartTimer);
  if (typeof reduceMotion.addEventListener === 'function') {
    reduceMotion.addEventListener('change', restartTimer);
  } else if (typeof reduceMotion.addListener === 'function') {
    reduceMotion.addListener(restartTimer);
  }

  setActive(activeIndex);
  restartTimer();
})();
