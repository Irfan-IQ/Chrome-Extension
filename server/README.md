# Redact Agent — Backend Gateway (Part 1)

FastAPI-based, privacy-preserving backend server for **Redact Agent** (Smart India Hackathon Problem Statement ID: **SIH26171 / ISRO**).

Designed to run natively on **any device**:
* **macOS (Apple Silicon M1/M2/M3/M4 or Intel)**
* **Windows (PowerShell or Command Prompt)**
* **Linux (Ubuntu / Debian / RHEL)**

---

## 🚀 Quick Setup Guide

### 1. Create a Virtual Environment (Recommended)

#### On macOS / Linux:
```bash
python3 -m venv venv
source venv/bin/activate
```

#### On Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

---

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

---

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(On Windows PowerShell: `Copy-Item .env.example .env`)*

Configure your settings in `.env`:
* `BACKEND_MODE=gemini_cloud` (Default for prototype demonstration)
* `GEMINI_API_KEY=your_gemini_api_key_here` (Required for Gemini cloud mode)
* `BACKEND_MODE=local_vlm` (For offline open-weights deployment via Ollama/vLLM)

---

### 4. Run the Server

#### Using Uvicorn:
```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

#### Or directly via Python:
```bash
python main.py
```

---

### 5. Verify the Gateway

Open your browser or run curl:

* **Interactive Swagger UI:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* **Health Check:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)
* **Models Discovery:** [http://127.0.0.1:8000/v1/models](http://127.0.0.1:8000/v1/models)

#### Test Chat Completion via Curl:
```bash
curl -X POST http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{"role": "user", "content": "Hello Redact Agent!"}]
  }'
```
