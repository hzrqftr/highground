(function () {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  sidebarToggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('collapsed');
  });
})();
