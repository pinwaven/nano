# Local Testing & Simulators

The Nano AI project includes a suite of local simulators to test the full lifecycle of a user's health journey without requiring physical hardware or Aliyun deployment.

## Components

### 1. Local Backend (Express Bridge)
- **File**: `scripts/local-dev.js`
- **Port**: `3000`
- **Role**: Acts as a bridge for the Aliyun FC 3.0 `worker` function. It provides HTTP endpoints (`/chat`, `/ingest`) and connects to your local PostgreSQL database.
- **Run**: `node scripts/local-dev.js`

### 2. Chat Simulator (WeChat Clone)
- **Location**: `tests/chat-simulator/`
- **Port**: `5173`
- **Tech**: Electron + React + Vite
- **Role**: Simulates the user interface for interacting with Nano AI. It uses a Vite proxy (`/api`) to communicate securely with the local backend.
- **Run**: `cd tests/chat-simulator && npm run dev`

### 3. Kino Simulator (Device Clone)
- **Location**: `tests/kino-simulator/`
- **Port**: `5174`
- **Tech**: Electron + React + Vite
- **Role**: Simulates the Kino portable biomarker testing device. It provides a GUI with a circular screen and a "Start Test" button.
- **Run**: `cd tests/kino-simulator && npm run dev`

### 4. PHM App Simulator (Coach Mobile App)
- **Location**: `tests/phm-simulator/`
- **Port**: `5175`
- **Tech**: Electron + React + Vite
- **Role**: Simulates the mobile application used by Precision Health Managers (Health Coaches). It allows coaches to view customer biomarkers, BioAge, and send manual instructions to the user's Nano chat.
- **Run**: `cd tests/phm-simulator && npm run dev`

## Testing Workflow

1.  **Start Database**: Ensure PostgreSQL is running (`brew services start postgresql@16`).
2.  **Start Backend**: Launch the local Express bridge (`node scripts/local-dev.js`).
3.  **Run Simulators**: Open the Chat, Kino, and PHM simulators.
4.  **Simulate Test**: Click the Kino "Start Test" button.
5.  **Monitor Data**: Open the PHM App to see the updated biomarkers and calculated BioAge for the customer.
6.  **Coach Intervention**: Send an instruction from the PHM App (e.g., "Drink more water").
7.  **View Delivery**: Open the Chat Simulator to see the coach's instruction appear in the user's conversation window.

## Troubleshooting
- **Blank Window**: Usually means the Vite server hasn't started yet. Electron includes polling logic to wait for the server.
- **404 Errors**: Check the Vite proxy settings in `vite.config.js`.
- **Database Error**: Ensure the `DATABASE_URL` in your `.env` file points to `postgresql://localhost:5432/nano_ai_db`.
