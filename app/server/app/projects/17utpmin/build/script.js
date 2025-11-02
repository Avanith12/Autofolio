// Mobile menu toggle
const navToggle = document.querySelector('.nav-toggle');
const navMenu = document.querySelector('.nav-menu');

navToggle.addEventListener('click', () => {
  navMenu.classList.toggle('active');
  navToggle.setAttribute('aria-expanded', navMenu.classList.contains('active'));
});

// Smooth scrolling for anchor links
const links = document.querySelectorAll('a[href^="#"]');

links.forEach(link => {
  link.addEventListener('click', (e) => {
    if (link.hash && link.pathname === window.location.pathname) {
      e.preventDefault();
      
      const target = document.querySelector(link.hash);
      if (target) {
        if ('scrollBehavior' in document.documentElement.style) {
          // Smooth scroll if supported and not reduced motion
          const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          
          if (!prefersReducedMotion) {
            window.scrollTo({
              top: target.offsetTop - 80,
              behavior: 'smooth'
            });
          } else {
            window.scrollTo(0, target.offsetTop - 80);
          }
        } else {
          // Fallback for older browsers
          window.scrollTo(0, target.offsetTop - 80);
        }
      }
      
      // Close mobile menu if open
      if (navMenu.classList.contains('active')) {
        navMenu.classList.remove('active');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    }
  });
});

// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();