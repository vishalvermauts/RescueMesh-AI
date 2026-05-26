/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: '#0F172A',
        surface: 'rgba(30, 41, 59, 0.7)',
        primary: '#38BDF8',
        secondary: '#818CF8',
        danger: '#F43F5E',
      }
    },
  },
  plugins: [],
}
