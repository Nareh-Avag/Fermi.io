# Fermi.io
## Tech Stack

*   Frontend Framework: React (bootstrapped with [Vite](https://vitejs.dev/))
*   Database & Authentication: [Supabase](https://supabase.com/)
*   Deployment Platform: [Vercel](https://vercel.com/)

---

## Key Capabilities

*   Custom Interface Panels: Tailored dashboard views engineered to display multi-variable computations, data metrics, and technical graphs seamlessly at a glance.
*   Decoupled Architecture: Organized via a dedicated sub-workspace layout, keeping production deployment pipelines lightning-fast, predictable, and isolated from top-level version control configurations.

---

## Project Structure

The project repository is configured with the core React application decoupled into its own workspace directory for structured environment builds:

```text
├── .gitignore               # Root git ignore patterns
├── README.md                # Project documentation
├── vercel.json              # Global Vercel deployment & root directory routing overrides
└── fermi-io/                # Main Application Workspace
    ├── index.html           # Vite entry-point HTML document
    ├── package.json         # Project metadata, dependencies, and compilation scripts
    ├── vite.config.js       # Vite bundler definitions and path mapping
    ├── public/              # Static assets, branding items, and icons
    └── src/                 # Application source logic (Components, Hooks, Styles, Auth)
