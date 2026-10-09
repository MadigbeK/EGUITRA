import type { Config } from "tailwindcss";

/**
 * EGUITRA Finance design tokens — Apothicaire Scientifique
 *
 * Ancrés sur le nouveau logo EGUITRA GROUP (microscope + ADN + capsule).
 * Validés mockups pitch-10/11/12 (mai 2026).
 *
 * Palette OKLCH :
 *   • brand-navy        — microscope, cercle, "SOGUI"
 *   • brand-green-vif   — ADN, "PREM", success, active state client
 *   • brand-orange      — capsule, bulles, primary CTA, active state admin
 *
 * Polices : Outfit (display) + Source Sans 3 (body) + JetBrains Mono (data/code).
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ─── Brand EGUITRA GROUP (extrait logo) ──────────────────────
        brand: {
          navy: "oklch(30% 0.120 285)",
          "navy-deep": "oklch(22% 0.100 285)",
          "green-vif": "oklch(62% 0.110 195)",
          "green-deep": "oklch(48% 0.090 195)",
          orange: "oklch(75% 0.150 80)",
          "orange-2": "oklch(82% 0.140 80)",
        },

        // ─── Surfaces sombres ────────────────────────────────────
        bg: {
          DEFAULT: "oklch(18% 0.030 250)",
          2: "oklch(21% 0.030 250)",
        },
        panel: {
          DEFAULT: "oklch(25% 0.035 250)",
          2: "oklch(28% 0.040 250)",
        },
        line: {
          DEFAULT: "oklch(33% 0.030 250)",
          strong: "oklch(42% 0.030 250)",
        },

        // ─── Texte hiérarchique ──────────────────────────────────
        // Sur dark theme : ink (default) = quasi blanc, dégradés descendants
        // vers ink-4 = gris foncé. Les anciennes échelles Civic v2 (900/700/500/300)
        // sont mappées en alias pour la transition.
        ink: {
          DEFAULT: "oklch(96% 0.005 250)",
          2: "oklch(82% 0.010 250)",
          3: "oklch(62% 0.014 250)",
          4: "oklch(48% 0.014 250)",
          // Alias Civic v2 → dark theme
          900: "oklch(96% 0.005 250)",  // primary text (= ink)
          700: "oklch(82% 0.010 250)",  // secondary (= ink-2)
          500: "oklch(62% 0.014 250)",  // muted (= ink-3)
          300: "oklch(48% 0.014 250)",  // very muted / borders (= ink-4)
        },

        // ─── Sémantique ──────────────────────────────────────────
        success: "oklch(60% 0.180 145)",
        "success-2": "oklch(72% 0.180 145)",
        warn: "oklch(76% 0.135 80)",
        danger: "oklch(64% 0.180 25)",
        info: "oklch(70% 0.110 230)",
        violet: "oklch(70% 0.130 290)",

        // ─── ALIAS DE TRANSITION (Civic v2 → Apothicaire) ────────
        // Mappe les anciens tokens vers les nouveaux pour éviter
        // de casser les pages tant qu'elles ne sont pas refactorées
        // une à une. À supprimer une fois la migration finie.
        paper: {
          DEFAULT: "oklch(18% 0.030 250)", // = bg
          muted: "oklch(21% 0.030 250)",   // = bg-2
        },
        accent: {
          DEFAULT: "oklch(72% 0.180 55)",  // = brand-orange
          hover: "oklch(80% 0.165 55)",    // = brand-orange-2
        },

        // ─── TOKENS modern-animated-sign-in (Ripple + BoxReveal) ─
        background: "var(--background)",
        foreground: "var(--foreground)",
        skeleton: "var(--skeleton)",
        border: "var(--btn-border)",
        input: "var(--input)",
      },
      backgroundImage: {
        // Tints semi-transparents (pour bg pills, alert cards, etc.)
        "brand-orange-soft":
          "linear-gradient(135deg, oklch(72% 0.180 55 / .14) 0%, transparent 100%)",
        "brand-green-soft":
          "linear-gradient(135deg, oklch(60% 0.180 145 / .14) 0%, transparent 100%)",
        "danger-soft":
          "linear-gradient(135deg, oklch(64% 0.180 25 / .15) 0%, transparent 100%)",
      },
      fontFamily: {
        display: ["var(--font-outfit)", "system-ui", "sans-serif"],
        sans: ["var(--font-source-sans-3)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Échelle resserrée product register
        "2xs": ["10.5px", { lineHeight: "1.2" }],
      },
      borderRadius: {
        DEFAULT: "6px",
        lg: "12px",
        pill: "9999px",
      },
      boxShadow: {
        // Inset top highlight pour cards sombres (subtle bevel)
        "inset-top": "inset 0 1px 0 oklch(100% 0 0 / .04)",
        // Soft elevation
        soft: "0 1px 0 oklch(0% 0 0 / .35), 0 0 0 1px oklch(33% 0.030 250)",
        // Input shadow pour modern-animated-sign-in
        input: [
          "0px 2px 3px -1px rgba(0, 0, 0, 0.1)",
          "0px 1px 0px 0px rgba(25, 28, 33, 0.02)",
          "0px 0px 0px 1px rgba(25, 28, 33, 0.08)",
        ].join(", "),
      },
      animation: {
        "pulse-soft": "pulseSoft 2.4s ease-in-out infinite",
        ripple: "ripple 2s ease calc(var(--i, 0) * 0.2s) infinite",
        orbit: "orbit calc(var(--duration) * 1s) linear infinite",
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        ripple: {
          "0%, 100%": { transform: "translate(-50%, -50%) scale(1)" },
          "50%": { transform: "translate(-50%, -50%) scale(0.9)" },
        },
        orbit: {
          "0%": {
            transform:
              "rotate(0deg) translateY(calc(var(--radius) * 1px)) rotate(0deg)",
          },
          "100%": {
            transform:
              "rotate(360deg) translateY(calc(var(--radius) * 1px)) rotate(-360deg)",
          },
        },
      },
    },
  },
  plugins: [],
};

export default config;
