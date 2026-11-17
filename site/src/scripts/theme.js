// Effective colour theme: the visitor's choice (html[data-theme], set by the nav button) wins over the system setting.
const system = matchMedia('(prefers-color-scheme: dark)');
export const isDark = () => (document.documentElement.dataset.theme || (system.matches ? 'dark' : 'light')) === 'dark';
export const onTheme = fn => { system.addEventListener('change', fn); addEventListener('themechange', fn); };
