# BreachLoop - Quick Start Guide

## 📁 Project Structure

```
breachloop-app/
├── README.md              # Project overview
├── package.json           # Root package with npm scripts
├── .gitignore            # Git ignore rules
│
├── frontend/             # React + TypeScript (✅ COMPLETE)
│   ├── src/
│   │   ├── components/   # 9 SOC console components
│   │   ├── types/        # TypeScript definitions
│   │   ├── api/          # API client
│   │   ├── styles/       # Dark SOC theme
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── dist/             # Production build
│   └── package.json
│
└── backend/              # FastAPI (⏳ TO BE IMPLEMENTED)
```

## 🚀 Getting Started

### Run the Frontend

```powershell
cd frontend
npm run dev
```

Open browser to `http://localhost:5173`

## 📝 Status

✅ **Frontend: 100% Complete**
- All 9 components built
- Dark SOC console theme
- Production build ready (60 KB gzipped)

⏳ **Backend: Not Yet Implemented**

## 🔧 Commands

```powershell
npm run frontend:dev      # Start dev server
npm run frontend:build    # Build production
npm run frontend:preview  # Preview build
```

## 📂 Key Files in VS Code

- `frontend/src/components/*.tsx` - UI components
- `frontend/src/App.tsx` - Main app
- `frontend/src/styles/index.css` - Theme
- `frontend/src/types/index.ts` - Types

---

**Run:** `npm run frontend:dev` then open `http://localhost:5173`
