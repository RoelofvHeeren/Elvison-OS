# Elvison AI Dashboard - Complete Styling Guide

A modern, premium SaaS dashboard design system featuring glassmorphism, dark themes, and refined aesthetics.

---

## 🎨 Color Palette

### Primary Colors
| Token | Value | Usage |
|-------|-------|-------|
| `teal-accent` | `#139187` | Primary brand color, icons, active states, links |
| `primary` | `#000000` | Text, active nav items, strong emphasis |
| `primary-dim` | `#1a1a1a` | Dark backgrounds, gradients |
| `primary-glow` | `#333333` | Medium dark elements |

### Background Colors (Dark Theme)
```css
/* Page background - pure black for video overlay */
background-color: #000000;

/* Container backgrounds with glassmorphism */
background: rgba(255, 255, 255, 0.05);    /* bg-white/5 - subtle cards */
background: rgba(0, 0, 0, 0.20);          /* bg-black/20 - inner elements */
background: rgba(0, 0, 0, 0.30);          /* bg-black/30 - deeper nesting */
background: rgba(17, 24, 39, 0.50);       /* bg-gray-900/50 - muted cards */
background: rgba(31, 41, 55, 0.50);       /* bg-gray-800/50 - empty states */
```

### Text Colors
| Class | Color | Usage |
|-------|-------|-------|
| `text-white` | `#ffffff` | Headers, primary content |
| `text-gray-200` | `#e5e7eb` | Body text |
| `text-gray-300` | `#d1d5db` | Secondary text |
| `text-gray-400` | `#9ca3af` | Captions, labels |
| `text-gray-500` | `#6b7280` | Muted/tertiary text |
| `text-[#139187]` | `#139187` | Links, accent text |

### Status Colors
```jsx
// Success
'text-green-400'     // Completed, qualified
'bg-green-400'       // Status dots

// Warning / Partial
'text-orange-400'    // Partial completion
'text-yellow-400'    // In progress, costs

// Error / Danger
'text-red-400'       // Failed, delete actions
'bg-red-500/20'      // Error backgrounds
'border-red-500/30'  // Error borders

// Accent Gradients
'from-yellow-500/10 to-orange-500/10'   // Cost/money highlights
'from-teal-500/20'                       // Active tab backgrounds
```

---

## ✍️ Typography

### Font Stack
```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

:root {
  font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
}
```

### Font Families (Tailwind)
```javascript
fontFamily: {
  sans: ['"Plus Jakarta Sans"', '"Inter"', 'sans-serif'],  // Body text
  serif: ['"Instrument Serif"', 'serif'],                   // Headers, branding
  mono: ['"JetBrains Mono"', 'monospace'],                  // Code, IDs, tokens
}
```

### Typography Scale
```jsx
// Page Headers
<h1 className="font-serif text-3xl font-bold text-white">Page Title</h1>

// Section Headers
<h2 className="text-xl font-bold text-white">Section</h2>
<h3 className="font-semibold text-white text-lg">Card Title</h3>

// Labels & Captions
<p className="text-xs text-gray-400 uppercase tracking-wider">LABEL</p>
<p className="text-sm text-gray-400">Description text</p>

// Stats & Numbers
<p className="text-2xl font-bold text-white">42</p>
<p className="text-lg font-bold text-yellow-300">$1.23</p>

// Monospace (IDs, code)
<span className="font-mono text-xs text-gray-500">workflow_123456</span>
```

---

## 📦 Component Patterns

### Glass Card (Primary Container)
```jsx
<div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
  {/* Content */}
</div>
```

### Inner Card / Nested Element
```jsx
<div className="bg-black/20 rounded-lg p-4 border border-white/10">
  {/* Content */}
</div>
```

### Stat Card
```jsx
<div className="bg-black/20 rounded-lg p-4 border border-white/10">
  <IconComponent className="w-5 h-5 text-[#139187] mb-2" />
  <p className="text-2xl font-bold text-white">42</p>
  <p className="text-xs text-gray-400 uppercase tracking-wider">Label</p>
</div>
```

### Highlighted Stat Card (Cost/Money)
```jsx
<div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 rounded-lg p-4 border border-yellow-500/20">
  <DollarSign className="w-5 h-5 text-yellow-400 mb-2" />
  <p className="text-2xl font-bold text-yellow-300">$1.23</p>
  <p className="text-xs text-gray-400 uppercase tracking-wider">API Cost</p>
</div>
```

### Page Header
```jsx
<div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
  <h1 className="font-serif text-3xl font-bold text-white flex items-center gap-3">
    <Icon className="w-8 h-8 text-[#139187]" />
    Page Title
  </h1>
  <p className="text-sm text-gray-400 mt-1">
    Description of what this page does
  </p>
</div>
```

---

## 🔘 Button Styles

### Primary Button
```jsx
<button className="px-6 py-3 bg-gradient-to-r from-[#139187] to-[#0d6b63] text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5">
  Primary Action
</button>
```

### Secondary / Ghost Button
```jsx
<button className="flex items-center gap-2 px-4 py-2 bg-black/20 hover:bg-white/5 text-gray-300 rounded-lg transition-colors border border-white/10">
  <Icon className="w-4 h-4" />
  Secondary
</button>
```

### Accent Button (Teal)
```jsx
<button className="px-4 py-2 bg-[#139187]/20 hover:bg-[#139187]/30 text-[#139187] rounded-lg transition-colors flex items-center gap-2 border border-[#139187]/30">
  <Check className="w-4 h-4" />
  Approve
</button>
```

### Danger Button
```jsx
<button className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors flex items-center gap-2 border border-red-500/30">
  <Trash2 className="w-4 h-4" />
  Delete
</button>
```

### Icon Button
```jsx
<button className="p-2 hover:bg-white/5 rounded-lg text-gray-400 transition-colors">
  <RefreshCw className="w-4 h-4" />
</button>
```

---

## 📑 Tab Navigation

```jsx
<div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
  <nav className="flex">
    <button
      className={`flex-1 py-4 px-6 font-medium text-sm transition-colors ${
        isActive
          ? 'bg-teal-500/20 text-teal-400 border-b-2 border-teal-400'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/30'
      }`}
    >
      <span className="flex items-center justify-center gap-2">
        <Icon className="w-4 h-4" />
        Tab Label
      </span>
    </button>
  </nav>
</div>
```

---

## 📊 Table Styles

```jsx
<div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-black/20 text-xs font-semibold uppercase tracking-wider text-gray-400">
        <tr>
          <th className="px-4 py-3 text-left">Column</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        <tr className="hover:bg-white/5 transition-colors">
          <td className="px-4 py-3 text-white font-medium">Value</td>
          <td className="px-4 py-3 text-gray-300">Secondary</td>
          <td className="px-4 py-3 text-gray-400">Muted</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

---

## 🔔 Status Indicators

### Status Badge Colors
```jsx
// Based on status string
const statusColor = 
  status === 'COMPLETED' ? 'text-green-400' :
  status === 'PARTIAL' ? 'text-orange-400' :
  status === 'FAILED' ? 'text-red-400' :
  status === 'RUNNING' ? 'text-yellow-400' :
  'text-gray-400';

const statusIcon = 
  status === 'COMPLETED' ? '✓' :
  status === 'PARTIAL' ? '⚠' :
  status === 'FAILED' ? '✗' :
  '';
```

### Status Dot
```jsx
<span className={`w-2 h-2 rounded-full ${success ? 'bg-green-400' : 'bg-red-400'}`}></span>
```

### Error Box
```jsx
<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
  <h4 className="text-sm font-semibold text-red-400 mb-2">Error Details:</h4>
  <p className="text-sm text-red-300 font-mono">{errorMessage}</p>
</div>
```

---

## 🖼️ Modal / Dialog

```jsx
<div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
  <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 max-w-md w-full">
    <h3 className="text-xl font-bold text-white mb-4">Modal Title</h3>
    <p className="text-sm text-gray-400 mb-4">Description text</p>
    
    {/* Form elements */}
    <textarea
      className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-3 text-white text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 transition-all resize-none"
      rows={4}
      placeholder="Placeholder text..."
    />
    
    {/* Actions */}
    <div className="flex gap-3 mt-6">
      <button className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
        Cancel
      </button>
      <button className="flex-1 px-4 py-2.5 bg-[#139187]/20 hover:bg-[#139187]/30 text-[#139187] rounded-lg transition-colors font-medium">
        Confirm
      </button>
    </div>
  </div>
</div>
```

---

## 🎥 Video Background

```jsx
// In App.jsx or layout
<video
  autoPlay
  muted
  loop
  playsInline
  className="bg-video"
>
  <source src="/background.mp4" type="video/mp4" />
</video>

// CSS
.bg-video {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
  opacity: 0.4;
}

body {
  background-color: #000000;
}

#root {
  position: relative;
  z-index: 1;
}
```

---

## 🧭 Sidebar Navigation

```jsx
<aside className={`sticky top-0 h-screen shrink-0 flex flex-col border-r-2 border-teal-accent bg-white px-6 py-8 shadow-2xl z-50 ${collapsed ? 'w-20' : 'w-72'} transition-all duration-500`}>
  
  {/* Logo */}
  <div className="mb-10 flex items-center gap-3 px-2">
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-black shadow-luxury group overflow-hidden">
      <img src="/logo.png" alt="Logo" className="h-8 w-8 object-contain opacity-90" />
    </div>
    {!collapsed && (
      <span className="font-serif text-2xl font-bold tracking-tight text-primary">Brand</span>
    )}
  </div>

  {/* Nav Items */}
  <nav className="flex flex-1 flex-col gap-2">
    <NavLink
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg py-3.5 text-sm font-medium transition-all duration-300 ${
          isActive
            ? 'bg-primary text-white shadow-3d translate-x-1'
            : 'text-muted hover:bg-surface hover:text-primary hover:translate-x-1'
        }`
      }
    >
      <Icon className="h-5 w-5 shrink-0 text-teal-accent group-hover:scale-110 transition-transform" />
      <span>Label</span>
    </NavLink>
  </nav>
</aside>
```

---

## 📐 Layout & Spacing

### Page Container
```jsx
<div className="min-h-screen p-6 lg:p-8">
  <div className="max-w-[1400px] mx-auto space-y-6">
    {/* Page content */}
  </div>
</div>
```

### Common Spacing Classes
```
p-6         // Standard padding
p-4         // Compact padding
gap-2       // Tight spacing
gap-3       // Standard gap
gap-4       // Comfortable gap
space-y-4   // Vertical rhythm
space-y-6   // Section spacing
mb-4        // Margin bottom standard
mt-6        // Margin top sections
```

### Grid Systems
```jsx
// Stats grid (responsive)
<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
  {/* Stat cards */}
</div>

// 5-column grid
<div className="grid grid-cols-2 lg:grid-cols-5 gap-4">

// Cards grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

---

## 🔧 Tailwind Config

```javascript
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        main: '#ffffff',
        surface: '#f5f5f5',
        primary: '#000000',
        'primary-dim': '#1a1a1a',
        'primary-glow': '#333333',
        accent: '#000000',
        'teal-accent': '#139187',
        muted: '#666666',
        outline: '#e0e0e0',
        glass: 'rgba(255, 255, 255, 0.95)',
        'glass-border': 'rgba(0, 0, 0, 0.1)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Inter"', 'sans-serif'],
        serif: ['"Instrument Serif"', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'luxury': '0 20px 40px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
        'sharp': '0 0 0 1px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.1)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.1)',
        '3d': '0 10px 20px -5px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08)',
        'lifted': '0 20px 40px -10px rgba(0, 0, 0, 0.25), 0 10px 20px -5px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.08)',
      },
      backgroundImage: {
        'gradient-luxury': 'linear-gradient(135deg, #ffffff 0%, #f5f5f5 100%)',
        'gradient-dark': 'linear-gradient(135deg, #1a1a1a 0%, #000000 100%)',
      }
    },
  },
  plugins: [],
}
```

---

## 🎯 Quick Reference Cheat Sheet

| Element | Classes |
|---------|---------|
| Glass card | `bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl` |
| Inner card | `bg-black/20 rounded-lg border border-white/10` |
| Page header | `font-serif text-3xl font-bold text-white` |
| Accent color | `text-[#139187]` or `text-teal-accent` |
| Label | `text-xs text-gray-400 uppercase tracking-wider` |
| Hover effect | `hover:bg-white/5 transition-colors` |
| Active tab | `bg-teal-500/20 text-teal-400 border-b-2 border-teal-400` |
| Button hover | `hover:-translate-y-0.5 transition-all duration-300` |
| Icon size | `w-5 h-5` (standard), `w-4 h-4` (small), `w-8 h-8` (large) |

---

## 📁 File Structure

```
src/
├── index.css                 # Font imports, video background styles
├── styles/
│   └── tailwind.css          # Tailwind directives, component classes
├── components/
│   └── Sidebar.jsx           # Navigation sidebar
└── routes/
    └── *.jsx                 # Page components using patterns above

tailwind.config.js            # Theme extensions, colors, fonts, shadows
```

---

Copy this guide to any new project and you'll have the complete Elvison AI design system!
