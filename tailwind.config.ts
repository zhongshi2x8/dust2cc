import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CS2 inspired palette
        cs2: {
          gold: '#FFD700',
          red: '#EB4B4B',
          green: '#4CAF50',
          blue: '#5C6BC0',
          purple: '#8847FF',
          bg: {
            dark: '#1a1a2e',
            card: '#242442',
            hover: '#2d2d52',
          },
          text: {
            primary: '#E0E0E0',
            secondary: '#A0A0B0',
            muted: '#6B6B80',
          },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
