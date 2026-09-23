import { defineTheme } from '@astryxdesign/core/theme';

export const bauhausTheme = defineTheme({
  name: 'noto-bauhaus',
  tokens: {
    '--color-accent': 'var(--bauhaus-blue)',
    '--color-on-accent': '#fff',
    '--color-accent-muted': 'var(--nt-tint)',
    '--color-text-accent': 'var(--nt-accent)',
    '--color-text-primary': 'var(--nt-text)',
    '--color-text-secondary': 'var(--nt-muted)',
    '--color-icon-primary': 'var(--nt-text)',
    '--color-icon-secondary': 'var(--nt-muted)',
    '--color-icon-accent': 'var(--nt-accent)',
    '--color-background-body': 'var(--nt-bg)',
    '--color-background-surface': 'var(--nt-paper)',
    '--color-background-card': 'var(--nt-paper)',
    '--color-background-popover': 'var(--nt-paper)',
    '--color-background-muted': 'var(--nt-hover)',
    '--color-border': 'var(--nt-line)',
    '--color-border-emphasized': 'var(--nt-text)',
    '--color-error': 'var(--nt-error)',
    '--radius-element': '0px',
    '--radius-container': '0px',
    '--font-family-body': "Arial, 'Segoe UI', sans-serif",
    '--font-family-heading': "'Arial Black', Arial, sans-serif",
  },
});
