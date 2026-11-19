(function () {
  var saved = null, dark = false;
  try { saved = localStorage.getItem('veli.theme.v1'); } catch (_) {}
  try { dark = matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) {}
  var theme = saved === 'dark' || saved === 'light' ? saved : dark ? 'dark' : 'light';
  var root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#0b1712' : '#f6f8f7';
  var meta = document.createElement('meta');
  meta.name = 'theme-color';meta.content = root.style.backgroundColor;
  document.head.appendChild(meta);
}());
