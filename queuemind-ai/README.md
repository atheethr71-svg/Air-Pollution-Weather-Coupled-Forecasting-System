# QueueMind AI – Smart Queue Monitoring & Predictive Management System
### *Track 2: Beyond the Browser – Reimagine How We Use the Web*

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-black.svg?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB.svg?logo=python&logoColor=white)](https://python.org)
[![AWS Integration](https://img.shields.io/badge/AWS-S3%20%7C%20SNS%20%7C%20CloudWatch-FF9900.svg?logo=amazon-aws&logoColor=white)](https://aws.amazon.com)
[![Computer Vision](https://img.shields.io/badge/Vision-OpenCV%20%7C%20YOLO-blue.svg)](https://opencv.org)
[![Queueing Theory](https://img.shields.io/badge/Model-Erlang--C%20Multi--Server-indigo.svg)]()

---

## 🚀 Executive Summary & Track Alignment

Crowded public environments such as **college canteens, hospitals, ambulatory clinics, retail banks, and civic licensing centres** routinely suffer from unpredictable waiting times, queue bottlenecks, and manual staff allocation. Traditional queue dashboards are passive: an administrator must continually stare at charts or refresh tables.

**QueueMind AI** re-envisions the browser as an **autonomous operational agent**:
1. **Perceives** live queue conditions via computer vision (OpenCV / YOLO person bounding boxes and density grading).
2. **Predicts** future waiting time horizons and accumulation velocity using multi-server Erlang-C ($M/M/c$) queuing theory.
3. **Simulates** counter allocations through an interactive what-if optimization engine that computes Pareto-efficient staffing.
4. **Acts Safely**: An embedded AI Copilot reasons over live facility metrics in natural language, formulates actionable proposals, and executes counter reallocations upon explicit administrator confirmation.
5. **Alerts & Scales**: Dispatches multi-tiered alerts (Info, Warning, Critical) over real-time WebSockets and AWS SNS push messaging.

---

## 🌟 Key Functional Modules

### 1. 🏢 Multi-Location Enterprise Management
Switch instantly between diverse facilities with custom queue SLAs, thresholds, and operational rules:
- **University Tech Canteen**: High-frequency, meal-time rush curves (target SLA: 10 mins).
- **Metro General Hospital**: Outpatient triage, emergency prioritization, and diagnostic lab intake (target SLA: 15 mins).
- **City Health Clinic**: Prescription dispensing and pharmacy consultation (target SLA: 12 mins).
- **Apex National Bank**: Cash deposits vs commercial accounts with VIP routing (target SLA: 8 mins).
- **Civic Service Centre**: Citizen licensing, biometrics, and permit verification (target SLA: 20 mins).

### 2. 👁️ Real-Time Computer Vision Crowd Detection
- Upload queue snapshots (JPG/PNG) or stream live browser webcam video.
- Person bounding boxes with detection confidence percentages and polygon zone tracking (*Main Waiting Area*, *Counter Corridor*, *Entrance Triage*).
- Crowd density classification: **Low**, **Moderate**, **High**, **Critical**.
- Privacy-conscious design: spatial torso detection without facial recognition or identity tracking.
- Pre-built high-fidelity synthetic simulation demo mode for evaluation without physical hardware.

### 3. ⏱️ Intelligent Waiting-Time Prediction Engine
- Grounded in Erlang-C multi-server queueing formulation:
  $$\rho = \frac{\lambda}{c \mu}, \quad W_q = \frac{C(c, \lambda/\mu)}{c\mu - \lambda}$$
- Dynamic fluid approximation for overloaded queues ($\rho \ge 1$).
- Empirical peak hour multipliers (lunch rush, morning clinic intake).
- Outputs 90% confidence intervals, queue accumulation velocity ($\Delta \text{people}/\text{min}$), and SLA violation risk.

### 4. 🎛️ Smart Counter Allocation Simulator
- Sliders to test what-if scenarios: Queue size, proposed active counters, incoming arrival flow, average transaction duration.
- **Side-by-side comparison**: Current Configuration vs Proposed Configuration.
- Calculates exact percentage of client time saved, counter utilization, and congestion reduction.
- Generates Pareto-optimal counter staffing recommendations.
- **One-Click Deploy**: Apply the recommended counter count directly to live production desks.

### 5. 🤖 Autonomous Browser AI Agent ("QueueMind Copilot")
- Floating assistant on every dashboard view + dedicated full-screen AI Operations Console.
- Responds to natural-language queries:
  - *"Should I open another counter right now?"*
  - *"Why is the waiting time increasing?"*
  - *"Predict the waiting time for the next 30 minutes"*
  - *"Which counter has the slowest service rate?"*
- Autonomous tool execution: queries database state, runs mathematical simulations, explains root causes, and proposes administrative actions with confirmation safety.

### 6. 🚨 Congestion Alerts & AWS SNS Push Notifications
- Triggers on critical queue surges, SLA breaches, and counter stalls.
- In-app notification center with sound, badge count, and user acknowledgment audit trails.
- **AWS SNS Integration**: Dispatches SMS/Email alerts for critical incidents (with resilient local fallback).

### 7. 📊 Historical Analytics & Audit CSV Export
- Hourly crowd trend distributions and peak congestion heatmaps.
- Counter operator throughput and efficiency metrics.
- One-click CSV audit report download formatted for facility management.

---

## ☁️ AWS Cloud Integration Architecture

| AWS Service | Production Purpose | Graceful Local Fallback |
| :--- | :--- | :--- |
| **AWS S3** | Encrypted object storage for queue surveillance snapshots and CSV audits | Local resilient file storage (`/uploads`) |
| **AWS SNS** | Emergency SMS/Email push notifications for critical queue surges | Structured in-app real-time dispatcher |
| **AWS CloudWatch** | Production operational logs, error tracking, and custom metric data | Local structured logging |
| **AWS RDS** | Managed PostgreSQL relational database with automated backups | Embedded SQLite database with auto-seeding |
| **AWS App Runner / ECS** | Serverless container deployment with auto-scaling | Local Docker Compose |

---

## 🔑 Pre-Seeded Demo Credentials

Three role-based test accounts are pre-seeded in the database:

| Role | Email Address | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@queuemind.ai` | `Admin@123` | Full system access, all facilities, AWS status, audit logs |
| **Facility Administrator** | `manager@queuemind.ai` | `Manager@123` | Counter allocation, SLA settings, simulator, AI actions |
| **Counter Operator** | `operator@queuemind.ai` | `Operator@123` | Call next token, toggle counter status (Break/Active) |

*You can also register a new account at `/login` or use the one-click demo login buttons.*

---

## 🛠️ Quickstart Guide

### Option 1: One-Click Startup (Windows)
Double-click `run-all.bat` in the root folder. It will automatically:
1. Start the FastAPI backend on `http://127.0.0.1:8000`.
2. Start the Next.js frontend on `http://localhost:3000`.

### Option 2: Manual Terminal Execution

#### 1. Start the Backend API:
```bash
cd queuemind-ai/backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
- Interactive Swagger API Documentation: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/api/health`

#### 2. Start the Frontend Application:
```bash
npm run dev
```
- Web Application: `http://localhost:3000`

### Option 3: Docker Compose
```bash
cd queuemind-ai
docker-compose up --build
```

---

## 🧪 Automated Test Suite

Run the comprehensive pytest test suite covering authentication, Erlang-C math, counter simulations, computer vision, AI agent tool calling, alerts, and CSV exports:

```bash
python -m pytest queuemind-ai/tests/test_api.py -v
```

Output:
```
queuemind-ai/tests/test_api.py::test_health_endpoint PASSED              [ 10%]
queuemind-ai/tests/test_api.py::test_auth_login_known_demo_user PASSED   [ 20%]
queuemind-ai/tests/test_api.py::test_auth_invalid_credentials PASSED     [ 30%]
queuemind-ai/tests/test_api.py::test_list_facilities PASSED              [ 40%]
queuemind-ai/tests/test_api.py::test_erlang_c_prediction_math PASSED     [ 50%]
queuemind-ai/tests/test_api.py::test_counter_simulation_engine PASSED    [ 60%]
queuemind-ai/tests/test_api.py::test_computer_vision_detector PASSED     [ 70%]
queuemind-ai/tests/test_api.py::test_operations_agent_chat PASSED        [ 80%]
queuemind-ai/tests/test_api.py::test_alerts_list_and_acknowledge PASSED  [ 90%]
queuemind-ai/tests/test_api.py::test_analytics_csv_export PASSED         [100%]
============================= 10 passed in 4.06s ==============================
```

---

## 📁 Repository Structure

```
queuemind-ai/
├── backend/
│   ├── app/
│   │   ├── ai_engine/
│   │   │   ├── agent/           # Autonomous Operations Agent & Tools
│   │   │   ├── detection/       # OpenCV & YOLO Person Vision Engine
│   │   │   └── prediction/      # Erlang-C Multi-Server Prediction Model
│   │   ├── api/                 # REST & WebSocket route handlers
│   │   ├── core/                # JWT Security, Bcrypt, Settings
│   │   ├── database/            # SQLAlchemy Engine & Session
│   │   ├── models/              # Relational models (Facilities, Counters, Queues, Alerts)
│   │   ├── schemas/             # Pydantic V2 validation schemas
│   │   ├── services/            # Simulation, AWS Boto3, Alerting, WebSockets
│   │   └── main.py              # FastAPI Application Entrypoint & Lifespan
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── app/                     # Next.js 15 App Router pages
│   ├── components/              # Navbar, Sidebar, AIAssistantWidget
│   ├── lib/                     # API client, WebSocket manager, types
│   ├── Dockerfile
│   ├── package.json
│   ├── tailwind.config.js
│   └── tsconfig.json
├── tests/                       # Pytest automated test suite
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🏆 Hackathon Submission Highlights

1. **Light Theme by Default**: Clean, enterprise-grade aesthetic with soft off-white canvas (`#f8fafc`), dark navy typography (`#0f172a`), subtle indigo accents (`#4f46e5`), and rounded cards.
2. **Optional Dark Mode**: Seamlessly toggled and persisted in `localStorage`.
3. **No Dead Buttons**: Every action (calling tokens, acknowledging alerts, running simulations, deploying counter allocations, downloading CSVs, chatting with agent) is connected to a live backend endpoint.
4. **Resilient Local Demo Mode**: Automatic background stochastic queue event ticker emits live updates via WebSockets every few seconds so judges experience real-time surveillance without physical sensors.
