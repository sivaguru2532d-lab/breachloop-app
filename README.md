# BreachLoop - AI-Assisted Cloud Incident-Response Simulator

A polished, cinematic incident-response console that demonstrates AI-assisted cloud security analysis with a digital twin validation system.

## 🎯 Overview

BreachLoop ingests synthetic CloudTrail audit events, reconstructs attack paths, proposes remediation actions, and tests each fix in an in-process digital twin before marking it verified. The system proves that broad fixes (like revoking all role sessions) can break critical business workflows, while narrow fixes (like scoped resource permissions) stop attackers without disruption.

## ✨ Key Features

- **100% Synthetic & Offline**: Zero cloud credentials required, zero external API calls
- **Digital Twin Validation**: Remediation candidates tested against cloned state before deployment
- **Cinematic SOC Console**: Dark theme with glassmorphism, semantic color coding, purposeful motion
- **Attack Path Visualization**: Interactive SVG graph showing compromise → escalation → exfiltration
- **Audit Timeline**: Expandable CloudTrail event inspector with attack/benign categorization
- **Remediation Laboratory**: Side-by-side comparison of broad vs narrow fixes with verification status
- **Workflow Health Matrix**: Business-critical workflow preservation validation
- **12-Scenario Benchmark**: Attack scenarios + benign workflows with ground-truth labels

## 🏗️ Architecture

```
breachloop-app/
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/   # SOC console UI components
│   │   ├── types/        # TypeScript type definitions
│   │   ├── api/          # API client
│   │   └── styles/       # Dark SOC theme CSS
│   └── dist/          # Production build
├── backend/           # FastAPI + Python (to be implemented)
│   ├── breachloop/
│   │   ├── api/       # REST endpoints
│   │   ├── models/    # Pydantic schemas
│   │   ├── engine/    # Graph analysis & digital twin
│   │   └── ingestion/ # CloudTrail normalization
│   └── tests/
├── scenarios/         # Synthetic CloudTrail scenarios
├── reports/           # Generated evidence reports
└── docs/             # Architecture & evaluation docs
```

## 🚀 Quick Start

### Frontend Development

```powershell
# Navigate to frontend
cd breachloop-app/frontend

# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

The frontend will be available at `http://localhost:5173`

## 🎨 Design Principles

### Dark SOC Console Aesthetic
- **Base**: `#0B0F17` (deep space navy)
- **Panels**: Frosted glass with subtle backdrop blur
- **Accents**:
  - 🔴 Critical/Attack: `#EF4444` (crimson)
  - 🟢 Verified/Safe: `#10B981` (emerald)
  - 🟡 Rejected/Warning: `#F59E0B` (amber)
  - 🔵 Benign/Info: `#06B6D4` (cyan)

## 📊 Frontend Components

1. **Header** - Navigation with scenario badge, provider toggle, action buttons
2. **Sidebar** - Scenario selector with attack/benign categorization
3. **HypothesisBar** - Incident summary with confidence scoring
4. **AttackGraph** - Interactive SVG visualization of attack path
5. **EventTimeline** - CloudTrail audit log with expandable event details
6. **RemediationLab** - Side-by-side comparison of broad vs narrow fixes
7. **TwinStateInspector** - Business workflow health matrix
8. **BenchmarkModal** - 12-scenario benchmark scorecard
9. **EvidenceReportView** - JSON report viewer with download

## 📦 Tech Stack

### Frontend
- React 18, TypeScript, Vite
- Lucide React icons
- CSS Variables theming

### Backend (Planned)
- FastAPI, Pydantic v2, SQLite
- Python 3.11+

## 📝 Development Status

- ✅ Frontend UI (100% complete)
- ✅ Production build ready
- ⏳ Backend API
- ⏳ Digital twin engine
- ⏳ Scenario data

---

**Built for security engineering education and portfolio demonstration**
