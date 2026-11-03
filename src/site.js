// openstuff.dev: the theme switch and the copy buttons. The page works without it.

const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');

function stored() {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
}

function apply(theme) {
  root.dataset.theme = theme;
  const button = document.querySelector('[data-theme-toggle]');
  if (button) {
    button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
}

// Follow the system until the visitor picks a theme.
media.addEventListener('change', () => {
  if (!stored()) apply(media.matches ? 'dark' : 'light');
});

const toggle = document.querySelector('[data-theme-toggle]');
if (toggle) {
  toggle.hidden = false;
  apply(root.dataset.theme || (media.matches ? 'dark' : 'light'));
  toggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private windows can refuse storage; the switch still works for this visit.
    }
  });
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.hidden = false;
  const label = button.getAttribute('aria-label');
  let timer;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      return;
    }
    button.setAttribute('data-copied', '');
    button.setAttribute('aria-label', 'Copied');
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.removeAttribute('data-copied');
      button.setAttribute('aria-label', label);
    }, 1600);
  });
}
