<div align="center">
  <h1>CivicSafe AI 🛡️</h1>
  <p><strong>Safer routes for citizens, smarter operations for cities.</strong></p>
</div>

CivicSafe AI is a comprehensive urban safety platform designed to bridge the gap between citizen navigation and city infrastructure planning. 

By ingesting real-world municipal data (such as historical crash reports and street-level infrastructure details) alongside real-time crowdsourced reports, CivicSafe provides a dynamic, data-driven approach to physical safety. 

## 🌟 Core Features & Modules

CivicSafe is split into three distinct role-based views:

### 1. Citizen Route Planner
Traditional navigation apps optimize purely for speed. The CivicSafe Citizen view optimizes for **survival and comfort**.
- **Custom Chicago Routing Engine:** We ingested real street segments and crash data from the Chicago Data Portal to build a local graph network (SQLite).
- **Fastest vs. Safest Paths:** Instead of just OSRM vectors, our custom Dijkstra algorithm calculates a "Safest Route" by heavily weighting well-lit streets, crosswalks, and avoiding high-crash/high-complaint intersections.
- **AI Safety Insights:** Powered by Gemini, the app generates a human-readable, reassuring explanation of *why* the Safest route was chosen based on the underlying infrastructure data.

### 2. Operator Triage Center
City dispatchers are often overwhelmed with a backlog of 311 calls and unstructured complaints.
- **AI Triage:** When a citizen reports an issue on the map, Gemini automatically categorizes the text, determines the urgency (High/Medium/Low), and summarizes the hazard.
- **Daily Briefs:** With one click, operators can generate an LLM-compiled Daily Safety Brief that identifies hotspot patterns and recommends 3 immediate dispatch actions for the day.

### 3. Urban Planner Workspace
City planners need to know where to allocate infrastructure budgets for maximum impact.
- **"What-If" Simulations:** Planners can click on any street segment in the city and digitally toggle on/off lighting or crosswalks.
- **ROI Analytics:** The platform recalculates the block's safety score dynamically, estimates the construction cost, and allows planners to save and compare "Investment Scenarios" by a strict *Safety-per-Dollar* efficiency metric.

---

## 🛠️ How it Works & Tech Stack

This project was hand-built during the hackathon using a modern JS stack.

* **Frontend:** React + Vite, styled with TailwindCSS (using advanced glassmorphism utilities) and Framer Motion for premium micro-animations. Mapping provided by `react-leaflet`.
* **Backend:** Express & Node.js
* **Routing Grapg:** We built our own local graph network using `better-sqlite3`. An ingestion script pulls down OSM boundaries and Chicago Crash Data, snaps them together, and runs a custom Dijkstra priority queue for pathfinding.
* **Database:** MongoDB (via native driver) stores the dynamic state like user-reported complaints and saved planner scenarios.
* **AI Integration:** Google Gemini (2.0-flash / 3-flash) handles the unstructured data analysis (Complaint Triaging, Daily Brief Generation, Route Explanations).

---

## 🚀 How to Run Locally

**Prerequisites:** Node.js (v18+)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Create a `.env.local` file in the root directory. You must provide a Google Gemini API key:
   ```env
   GEMINI_API_KEY=your_studio_key_here
   ```
   *(Note: The app is configured to use mock-authentication for the hackathon demo to allow judges to easily switch between the Citizen, Operator, and Planner modes)*

3. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   
4. **Access the App:**
   Open `http://localhost:3000` in your browser. Use the header dropdown to toggle between the three platform roles!
