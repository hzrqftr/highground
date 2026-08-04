(function () {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  const setTheme = (mode) => {
    const isLight = mode === 'light';
    root.setAttribute('data-theme', isLight ? 'light' : 'dark');
    localStorage.setItem('hg-theme', isLight ? 'light' : 'dark');
    if (icon) icon.textContent = isLight ? '◉' : '○';
    if (label) label.textContent = isLight ? 'dark mode' : 'light mode';
  };

  const savedTheme = localStorage.getItem('hg-theme');
  if (savedTheme === 'light') {
    setTheme('light');
  } else {
    setTheme('dark');
  }

  button?.addEventListener('click', () => {
    const nextTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
  });

  sidebarToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
  });
})();
