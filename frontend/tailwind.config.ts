import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#5b6cff',
          50: '#eef0ff',
          100: '#e0e4ff',
          400: '#7e8aff',
          500: '#5b6cff',
          600: '#4956d6',
          700: '#3a45ad',
        },
        accept: '#16a34a',
        reject: '#dc2626',
        escalate: '#d97706',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
