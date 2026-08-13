/**
 * Carrossel automático do dashboard gerencial Labor Rural.
 */
class DashboardCarousel {
  constructor(options = {}) {
    this.slideDuration = options.slideDuration || 30000;
    this.currentSlide = 0;
    this.slideNames = [
      'Visitas e cobertura',
      'Movimentações e vínculos',
      'Dados e consistência'
    ];
    this.totalSlides = this.slideNames.length;
    this.track = document.getElementById('carouselTrack');
    this.slides = [...document.querySelectorAll('.slide')];
    this.dots = [...document.querySelectorAll('.page-dot')];
    this.title = document.getElementById('currentSlideTitle');
    this.progressBar = document.getElementById('progressBarFill');
    this.prevButton = document.getElementById('prevSlide');
    this.nextButton = document.getElementById('nextSlide');
    this.navigation = document.querySelector('.carousel-navigation');
    this.startedAt = Date.now();
    this.progressTimer = null;
    this.mouseTimer = null;
    this.paused = false;
    this.init();
  }

  init() {
    if (!this.track) return;
    this.bindEvents();
    const hashPage = Number(window.location.hash.match(/pagina-(\d+)/)?.[1] || 1) - 1;
    this.goTo(Number.isInteger(hashPage) ? hashPage : 0, false);
    this.startProgress();
  }

  bindEvents() {
    this.navigation?.addEventListener('click', (event) => {
      const pageButton = event.target.closest('[data-slide]');
      if (!pageButton) return;
      event.preventDefault();
      event.stopPropagation();
      this.goTo(Number(pageButton.dataset.slide));
    });

    this.prevButton?.addEventListener('click', () => this.goTo(this.currentSlide - 1));
    this.nextButton?.addEventListener('click', () => this.goTo(this.currentSlide + 1));

    window.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') this.goTo(this.currentSlide + 1);
      if (event.key === 'ArrowLeft') this.goTo(this.currentSlide - 1);
    });

    window.addEventListener('hashchange', () => {
      const hashPage = Number(window.location.hash.match(/pagina-(\d+)/)?.[1]);
      if (hashPage >= 1 && hashPage <= this.totalSlides) this.goTo(hashPage - 1);
    });

    const interactiveArea = document.querySelector('.carousel-viewport');
    interactiveArea?.addEventListener('mouseenter', () => { this.paused = true; });
    interactiveArea?.addEventListener('mouseleave', () => {
      this.paused = false;
      this.resetProgress();
    });
    interactiveArea?.addEventListener('focusin', () => { this.paused = true; });
    interactiveArea?.addEventListener('focusout', () => {
      this.paused = false;
      this.resetProgress();
    });
  }

  goTo(index, reset = true) {
    const normalized = (index + this.totalSlides) % this.totalSlides;
    this.currentSlide = normalized;
    this.track.style.transform = `translate3d(-${normalized * 100}vw, 0, 0)`;

    this.dots.forEach((dot, dotIndex) => {
      const active = dotIndex === normalized;
      dot.classList.toggle('active', active);
      dot.setAttribute('aria-current', active ? 'page' : 'false');
    });

    this.slides.forEach((slide, slideIndex) => {
      slide.setAttribute('aria-hidden', slideIndex === normalized ? 'false' : 'true');
    });

    if (this.title) this.title.textContent = this.slideNames[normalized];
    window.history.replaceState(null, '', `#pagina-${normalized + 1}`);
    if (reset) this.resetProgress();
  }

  resetProgress() {
    this.startedAt = Date.now();
    if (this.progressBar) this.progressBar.style.width = '0%';
  }

  startProgress() {
    clearInterval(this.progressTimer);
    this.progressTimer = setInterval(() => {
      if (this.paused) return;
      const elapsed = Date.now() - this.startedAt;
      const percent = Math.min(100, (elapsed / this.slideDuration) * 100);
      if (this.progressBar) this.progressBar.style.width = `${percent}%`;
      if (elapsed >= this.slideDuration) this.goTo(this.currentSlide + 1);
    }, 100);
  }
}

window.DashboardCarousel = DashboardCarousel;
