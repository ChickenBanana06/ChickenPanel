# ChickenPanel 🐤

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10%2B-orange.svg)](https://pnpm.io/)
[![Platform](https://img.shields.io/badge/Platform-Ubuntu%20%7C%20Debian%20%7C%20Windows-blue.svg)]()
[![Security](https://img.shields.io/badge/Security-Hardened%20Multi--Tenant-success.svg)]()

**ChickenPanel** is a modern, high-performance, AI-powered server management platform. Host and control game servers (Minecraft, etc.), Discord bots, Python apps, web services, and databases across multiple nodes and VPS instances from a single centralized web dashboard with a built-in AI assistant.

---

## 📑 Table of Contents

- [Features](#-features)
- [System Architecture & Ports](#-system-architecture--ports)
- [Quick Start: 1-Line Installers](#-quick-start-1-line-installers)
  - [Ubuntu / Debian / Linux](#1-linux-ubuntu--debian-quick-install)
  - [Windows (PowerShell)](#2-windows-powershell-quick-install)
- [Complete Installation Guide: Ubuntu / Debian](#-complete-installation-guide-ubuntu--debian)
  - [Prerequisites & System Preparation](#step-1-system-update--dependencies)
  - [Setting Up a Non-Root User (Crucial)](#step-2-create-a-non-root-user)
  - [Node.js 20 & pnpm 10 Installation](#step-3-install-nodejs-20--pnpm-10)
  - [Cloning, Building & Setup](#step-4-clone-build-and-initialize)
  - [Firewall Configuration (UFW)](#step-5-configure-firewall-ufw)
  - [Running as a Systemd Service (Autostart on Boot)](#step-6-configure-systemd-service-optional-recommended)
- [Complete Installation Guide: Windows](#-complete-installation-guide-windows)
  - [Prerequisites & Package Manager Installation](#step-1-install-prerequisites-via-winget)
  - [Cloning, Building & CLI Setup](#step-2-clone-build--configure-cli)
  - [Firewall Configuration (PowerShell)](#step-3-configure-windows-firewall)
  - [Running on Boot (Task Scheduler)](#step-4-run-on-boot-optional)
- [ChickenPanel CLI Reference](#-chickenpanel-cli-reference)
- [Connecting & Managing Nodes](#-connecting--managing-nodes)
  - [What is a Node?](#what-is-a-node)
  - [Registering an Ubuntu Node](#registering-an-ubuntu-node)
  - [Registering a Windows Node](#registering-a-windows-node)
- [Deploying Applications & Servers](#-deploying-applications--servers)
  - [Minecraft Servers](#minecraft-servers)
  - [Discord Bots & Python Apps](#discord-bots--python-apps)
  - [Custom Web Services](#custom-web-services)
  - [Using the AI Operator](#using-the-ai-operator)
- [Security & Isolation Features](#-security--isolation-features)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Development & Testing](#-development--testing)

---

## ✨ Features

- **🎮 1-Click Game & App Deployments:** Deploy Vanilla, Paper, Purpur, Fabric Minecraft servers, Discord bots, Python scripts, Node.js servers, and PostgreSQL/Redis instances.
- **🤖 Built-in AI Operator:** Ask your panel assistant to inspect logs, troubleshoot crashes, edit config files, or trigger backups with per-action confirmation prompts.
- **🌐 Distributed Multi-Node Management:** Connect multiple VPS instances or dedicated machines across the globe back to one central control panel.
- **🔒 Hardened Multi-Tenant Isolation:** Complete server-side resource ownership verification (IDOR protection) on all apps, files, consoles, tasks, backups, and AI tools.
- **🛡️ Sandbox & Process Isolation:** Path traversal prevention, symlink containment, Zip Slip / Tar Slip protection, and Linux `prlimit` enforcement (memory and thread caps).
- **📡 Live Real-Time WebSockets:** Real-time console streaming, CPU/RAM telemetry graphs, and live task progress.
- **📦 Embedded Zero-Config Database:** Ships with an embedded PostgreSQL database engine—no external database servers required.

---

## 🏛️ System Architecture & Ports

ChickenPanel consists of 4 lightweight services coordinated by the `chickenpanel` CLI:

| Service | Port | Description |
| :--- | :--- | :--- |
| **Web UI** (`web`) | **`3000`** | Next.js responsive control panel dashboard. |
| **API Server** (`api`) | **`4000`** | Fastify REST API and WebSocket Gateway for clients and remote nodes. |
| **Database** (`db`) | **`5490`** | Embedded PostgreSQL instance (can also use an external DB via `DATABASE_URL`). |
| **Node Agent** (`agent`) | Outbound | Background daemon running on each machine that executes server tasks and monitors resources. |

---

## ⚡ Quick Start: 1-Line Installers

### 1. Linux (Ubuntu / Debian) Quick Install
> [!IMPORTANT]
> If you are on a VPS logged in as `root`, create a non-root user first before running this script (see [Creating Non-Root User](#step-2-create-a-non-root-user)), because PostgreSQL blocks root execution.

```bash
curl -fsSL https://raw.githubusercontent.com/ChickenBanana06/ChickenPanel/main/scripts/bootstrap.sh | sh
```

Once installed, start the panel:
```bash
cd ~/chickenpanel
node apps/cli/dist/index.js install   # Initializes database & schema
node apps/cli/dist/index.js start     # Starts DB, API, and Web dashboard
```
Open **`http://<SERVER_IP>:3000`** in your browser.

---

### 2. Windows (PowerShell) Quick Install

Open **PowerShell as Administrator** and execute:

```powershell
irm https://raw.githubusercontent.com/ChickenBanana06/ChickenPanel/main/scripts/bootstrap.ps1 | iex
```

Once completed, open standard PowerShell and start the panel:
```powershell
cd $HOME\chickenpanel
chickenpanel install
chickenpanel start
```
Open **`http://localhost:3000`** (or your LAN IP) in your browser.

---

## 🐧 Complete Installation Guide: Ubuntu / Debian

This section provides a step-by-step walkthrough for setting up ChickenPanel on Ubuntu 20.04, 22.04, or 24.04 LTS.

### Step 1: System Update & Dependencies

Log in to your VPS and update package lists:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git build-essential ufw software-properties-common
```

---

### Step 2: Create a Non-Root User

> [!CAUTION]
> **Why is this required?** PostgreSQL's core engine contains a security check that refuses to initialize or run as user `root` (UID 0). Running the panel under a dedicated `chickenpanel` user avoids permission errors.

1. Create a user named `chickenpanel`:
   ```bash
   sudo adduser --disabled-password --gecos "" chickenpanel
   ```

2. Grant `sudo` privileges to this user (for package management and firewall setup):
   ```bash
   sudo usermod -aG sudo chickenpanel
   ```

3. Switch to the `chickenpanel` user:
   ```bash
   sudo su - chickenpanel
   ```

4. Confirm you are in `/home/chickenpanel`:
   ```bash
   pwd
   ```

---

### Step 3: Install Node.js 20 & pnpm 10

ChickenPanel requires Node.js version 20 LTS or higher.

1. **Install Node.js 20 via NodeSource:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

2. **Verify Node.js and npm versions:**
   ```bash
   node -v   # Should output v20.x or higher
   npm -v
   ```

3. **Install pnpm 10 globally:**
   ```bash
   sudo npm install -g pnpm@10
   pnpm -v   # Should output 10.x
   ```

4. **(Optional) Install Java 21 for Minecraft Servers:**
   ```bash
   sudo apt install -y openjdk-21-jre-headless
   java -version
   ```
   *(Note: The panel's node agent can also download JRE automatically if Java is not installed).*

---

### Step 4: Clone, Build, and Initialize

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ChickenBanana06/ChickenPanel.git ~/chickenpanel
   cd ~/chickenpanel
   ```

2. **Install monorepo dependencies:**
   ```bash
   pnpm install
   ```

3. **Build all packages:**
   ```bash
   pnpm -r --workspace-concurrency=1 build
   ```

4. **Create a global `chickenpanel` CLI symlink:**
   ```bash
   sudo ln -sf /home/chickenpanel/chickenpanel/apps/cli/dist/index.js /usr/local/bin/chickenpanel
   sudo chmod +x /home/chickenpanel/chickenpanel/apps/cli/dist/index.js
   ```

5. **Initialize the embedded database:**
   ```bash
   chickenpanel install
   ```
   *(This launches PostgreSQL, creates the database schema, and runs Prisma migrations).*

6. **Start all services:**
   ```bash
   chickenpanel start
   ```

7. **Verify service status:**
   ```bash
   chickenpanel status
   ```
   Expected output:
   ```text
   db     running (pid 12345)
   api    running (pid 12346)
   web    running (pid 12347)
   agent  stopped
   ```

---

### Step 5: Configure Firewall (UFW)

Open the required ports so you can access the dashboard and connect nodes:

```bash
# Allow SSH first so you don't get locked out!
sudo ufw allow 22/tcp

# ChickenPanel Web UI
sudo ufw allow 3000/tcp

# ChickenPanel API & Node Gateway
sudo ufw allow 4000/tcp

# Default Minecraft Server Port (if hosting Minecraft)
sudo ufw allow 25565/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status verbose
```

Access the panel by opening **`http://<YOUR_VPS_IP>:3000`** in your browser. Register your admin user (the first user created is automatically granted administrator privileges).

---

### Step 6: Configure Systemd Service (Optional, Recommended)

To ensure ChickenPanel starts automatically whenever your VPS reboots:

1. Create a systemd unit file:
   ```bash
   sudo nano /etc/systemd/system/chickenpanel.service
   ```

2. Paste the following configuration:
   ```ini
   [Unit]
   Description=ChickenPanel Control Plane
   After=network.target

   [Service]
   Type=forking
   User=chickenpanel
   WorkingDirectory=/home/chickenpanel/chickenpanel
   ExecStart=/usr/local/bin/chickenpanel start
   ExecStop=/usr/local/bin/chickenpanel stop
   Restart=on-failure
   RestartSec=10
   LimitNOFILE=65535

   [Install]
   WantedBy=multi-user.target
   ```

3. Reload systemd and enable the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable chickenpanel
   ```

---

## 🪟 Complete Installation Guide: Windows

This section covers setting up ChickenPanel on Windows 10, Windows 11, or Windows Server 2022.

### Step 1: Install Prerequisites via Winget

Open **PowerShell as Administrator** and install Git and Node.js 20 LTS:

```powershell
# 1. Allow running local scripts in PowerShell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force

# 2. Install Node.js LTS
winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements

# 3. Install Git
winget install Git.Git --silent --accept-package-agreements --accept-source-agreements

# 4. (Optional) Install Java 21 for Minecraft hosting
winget install EclipseAdoptium.Temurin.21.JDK --silent --accept-package-agreements --accept-source-agreements
```

> [!NOTE]
> Close and reopen PowerShell (or run `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`) to refresh your PATH variables.

Verify installations:
```powershell
node -v    # Must be v20 or higher
git --version
```

Install **pnpm 10**:
```powershell
npm install -g pnpm@10
pnpm -v
```

---

### Step 2: Clone, Build & Configure CLI

1. **Clone the repository:**
   ```powershell
   git clone https://github.com/ChickenBanana06/ChickenPanel.git $HOME\chickenpanel
   cd $HOME\chickenpanel
   ```

2. **Install dependencies:**
   ```powershell
   pnpm install
   ```

3. **Build the packages:**
   ```powershell
   pnpm -r --workspace-concurrency=1 build
   ```

4. **Create the global `chickenpanel` CLI command:**
   ```powershell
   $npmBin = Join-Path $env:APPDATA 'npm'
   if (-not (Test-Path $npmBin)) { New-Item -ItemType Directory -Path $npmBin -Force }
   "@echo off`r`nnode `"$HOME\chickenpanel\apps\cli\dist\index.js`" %*" | Out-File -FilePath (Join-Path $npmBin "chickenpanel.cmd") -Encoding ascii
   ```

5. **Initialize the database:**
   ```powershell
   chickenpanel install
   ```
   *(Or run: `node apps\cli\dist\index.js install`)*

6. **Start ChickenPanel services:**
   ```powershell
   chickenpanel start
   ```

7. **Check service status:**
   ```powershell
   chickenpanel status
   ```

Open **`http://localhost:3000`** in your browser to create your administrator account.

---

### Step 3: Configure Windows Firewall

If you plan to access the panel from another computer or run game servers reachable by others, allow inbound traffic through Windows Defender Firewall:

Run the following in **PowerShell as Administrator**:

```powershell
# Web UI (Port 3000)
New-NetFirewallRule -DisplayName "ChickenPanel Web (3000)" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow

# API Gateway (Port 4000)
New-NetFirewallRule -DisplayName "ChickenPanel API (4000)" -Direction Inbound -LocalPort 4000 -Protocol TCP -Action Allow

# Default Minecraft Game Server Port (Port 25565)
New-NetFirewallRule -DisplayName "Minecraft Server (25565)" -Direction Inbound -LocalPort 25565 -Protocol TCP -Action Allow
```

---

### Step 4: Run on Boot (Optional)

To start ChickenPanel automatically when Windows logs in, create a Windows Scheduled Task:

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c chickenpanel start" -WorkingDirectory "$HOME\chickenpanel"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "ChickenPanel" -Action $action -Trigger $trigger -Description "Autostarts ChickenPanel on user logon"
```

---

## 💻 ChickenPanel CLI Reference

The `chickenpanel` CLI provides unified control for managing all services, viewing logs, updating the codebase, and linking nodes.

```text
Usage: chickenpanel <command> [arguments]
```

| Command | Arguments | Description | Example |
| :--- | :--- | :--- | :--- |
| `install` | *none* | Runs initial database migration and seeds system tables. | `chickenpanel install` |
| `start` | `[service]` | Starts specified services (defaults to `db,api,web`). | `chickenpanel start` or `chickenpanel start agent` |
| `stop` | `[service]` | Stops specified services (defaults to stopping all). | `chickenpanel stop` or `chickenpanel stop api` |
| `restart` | `[service]` | Restarts specified services (defaults to `web,api`). | `chickenpanel restart` |
| `status` | *none* | Displays running state and PID for each service. | `chickenpanel status` |
| `logs` | `<service>` | Tails the last 100 log lines (`db`, `api`, `web`, `agent`). | `chickenpanel logs api` |
| `update` | *none* | Pulls latest code, rebuilds, and applies database migrations. | `chickenpanel update` |
| `node register` | `<url> <token>` | Connects this machine's agent to a central panel. | `chickenpanel node register http://1.2.3.4:4000 tok_xyz` |

### Service Target Examples:
- Start only the Node Agent:
  ```bash
  chickenpanel start agent
  ```
- Start the entire stack on one machine (database, API, web frontend, and agent):
  ```bash
  chickenpanel start db,api,web,agent
  ```
- View real-time agent output:
  ```bash
  chickenpanel logs agent
  ```

---

## 🌐 Connecting & Managing Nodes

### What is a Node?
A **Node** is any physical machine, VM, or VPS running the `chickenpanel agent`. It receives deployment tasks from the central panel over a secure WebSocket, executes application processes, manages sandbox storage, and reports health metrics.

```
┌─────────────────────────────────┐
│     Central Control Panel       │
│   Web (3000)  +  API (4000)     │
└──────────────┬──────────────────┘
               │  Secure WebSocket (Port 4000)
       ┌───────┴────────┐
       ▼                ▼
┌──────────────┐ ┌──────────────┐
│  Node 1: VPS │ │Node 2: Win PC│
│ (Node Agent) │ │ (Node Agent) │
└──────────────┘ └──────────────┘
```

### Registering an Ubuntu Node

1. In the ChickenPanel Web UI:
   - Navigate to **Nodes** in the left sidebar.
   - Click **Add Node**.
   - Enter a node name (e.g. `vps-germany-1`) and click **Create**.
   - Copy the generated Registration URL and Token.

2. On your target Ubuntu machine:
   - Install dependencies and clone the repo using [Step 1-4 of the Ubuntu Guide](#-complete-installation-guide-ubuntu--debian).
   - Register the agent:
     ```bash
     chickenpanel node register http://<PANEL_IP>:4000 <NODE_TOKEN>
     ```
   - Start the agent:
     ```bash
     chickenpanel start agent
     ```
   - The node status in the web panel will instantly change to **ONLINE** 🟢.

### Registering a Windows Node

1. On your Windows computer, follow [Step 1-2 of the Windows Guide](#-complete-installation-guide-windows).
2. Register the node agent:
   ```powershell
   chickenpanel node register http://<PANEL_IP>:4000 <NODE_TOKEN>
   ```
3. Start the node agent:
   ```powershell
   chickenpanel start agent
   ```
4. Verify connection:
   ```powershell
   chickenpanel logs agent
   ```

---

## 🚀 Deploying Applications & Servers

### Minecraft Servers
1. Go to **Applications** -> **Create Application**.
2. Select your linked node.
3. Choose **Minecraft** from the catalog.
4. Select your preferred flavor:
   - **Paper / Purpur:** Optimized performance with plugin support.
   - **Vanilla:** Official Mojang server.
   - **Fabric:** Lightweight mod loader.
5. Set your server version (e.g., `1.21.1`) and allocate RAM (e.g., `4096MB`).
6. Click **Create**:
   - The Node Agent automatically provisions directories.
   - It fetches official binaries, automatically downloads JRE 21 if needed, and writes `server.properties` and `eula.txt=true`.
7. Click **Start** to boot the server.
8. Go to the **Console** tab to send commands like `op <username>` or `stop`.

### Discord Bots & Python Apps
1. Go to **Applications** -> **Create Application**.
2. Select **Python** or **Node.js**.
3. Point to your Git repository URL or upload your files using the built-in **Files** tab.
4. Configure environment variables (e.g., `DISCORD_TOKEN`, `BOT_PREFIX`).
5. Click **Start**. All output is streamed live to the web console.

### Custom Web Services
- Set the start command (e.g. `npm start` or `python main.py`).
- Assign a network port under the **Network** tab.
- ChickenPanel monitors the process PID, auto-restarts failed processes, and captures stdout/stderr.

### Using the AI Operator
ChickenPanel includes an embedded AI Operator accessible from the bottom bar or application management views:
- **Configure AI Key:** Open **Settings** -> **AI Configuration** and enter an OpenAI, Anthropic, or custom API key. Keys are encrypted at rest using AES-256-GCM.
- **Troubleshoot Server Errors:** When a server crashes, click **Analyze Crash** in the console. The AI reads recent stack traces and suggests fixes.
- **Safety Guarantee:** The AI runs within strict authorization boundaries and cannot execute destructive actions without explicit interactive approval.

---

## 🔒 Security & Isolation Features

ChickenPanel has been hardened against multi-tenant vulnerabilities:

1. **Strict IDOR Defense:** Server-side ownership verification is enforced on every API route, WebSocket topic, backup, and task. Users can never view or modify resources belonging to another tenant.
2. **Canonical Sandbox Resolution:** Filesystem operations in `agent/src/sandbox.ts` resolve canonical paths using realpath inspection to eliminate directory traversal (`../`) and symlink-based jailbreaks.
3. **Zip Slip & Tar Slip Hardening:** Archive extraction verifies every target entry path prior to extraction, rejecting entries referencing parent directories or symlink targets pointing outside the app folder.
4. **SSRF Defense:** Outbound HTTP file fetches and git sync operations strictly filter private IP blocks, localhost (`127.0.0.1`), link-local IPs, and cloud metadata endpoints (`169.254.169.254`).
5. **Process Limits & Clean Environments:** Application processes are bounded with Linux `prlimit` limits (maximum file descriptors, maximum threads, and address space memory caps) and run with stripped environment variables to prevent host secret leakage.
6. **Constant-Time Node Authentication:** Node authentication tokens are compared using `crypto.timingSafeEqual` against SHA-256 hashes to prevent timing attacks.

---

## ❓ Troubleshooting & FAQ

### 1. "Embedded PostgreSQL cannot be run as 'root'"
- **Cause:** You ran `chickenpanel install` or `chickenpanel start` as the `root` user on Linux.
- **Solution:** Create a non-root user (e.g., `adduser chickenpanel`), move the directory to `/home/chickenpanel`, assign ownership (`chown -R chickenpanel:chickenpanel /home/chickenpanel/chickenpanel`), and run as `chickenpanel`. Alternatively, point `DATABASE_URL` to an external PostgreSQL server.

### 2. Port Already in Use (3000, 4000, or 5490)
- **Check who is using the port (Linux):**
  ```bash
  sudo lsof -i :3000
  sudo lsof -i :4000
  ```
- **Change default ports:**
  You can customize ports by setting environment variables before starting:
  ```bash
  export NEXPANEL_WEB_PORT=3001
  export NEXPANEL_API_PORT=4001
  chickenpanel start
  ```

### 3. Node Shows "Offline" in Web UI
- Verify the agent process is running on the node:
  ```bash
  chickenpanel status
  ```
- Check agent log file for connection errors:
  ```bash
  chickenpanel logs agent
  ```
- Ensure port `4000` on the central panel server is open in your VPS firewall (`sudo ufw allow 4000/tcp`).
- Ensure the registration URL uses the panel's public IP address, not `localhost` or `127.0.0.1`.

### 4. Updating ChickenPanel
To pull new updates, recompile, and migrate:
```bash
cd ~/chickenpanel
git pull origin main
chickenpanel update
chickenpanel restart
```

### 5. Where Are Data and Logs Stored?
- **Linux:**
  - Panel data & database: `~/.local/share/nexpanel/`
  - Logs: `~/.local/share/nexpanel/logs/`
  - Node Agent apps & files: `~/.local/share/nexpanel-agent/`
- **Windows:**
  - Panel data & database: `%LOCALAPPDATA%\nexpanel\`
  - Logs: `%LOCALAPPDATA%\nexpanel\logs\`
  - Node Agent apps & files: `%LOCALAPPDATA%\nexpanel-agent\`

---

## 🧪 Development & Testing

To run the monorepo in developer mode with hot reload:

```bash
# Install dependencies
pnpm install

# Build packages
pnpm -r --workspace-concurrency=1 build

# Run individual services with hot reload
pnpm --filter @nexpanel/database dev   # Terminal 1: Embedded PostgreSQL
pnpm dev:api                           # Terminal 2: Fastify API (port 4000)
pnpm dev:web                           # Terminal 3: Next.js dev server (port 3000)
pnpm dev:agent                         # Terminal 4: Node Agent
```

### Running Test Suites
```bash
# Monorepo typecheck
pnpm -r typecheck

# Shared package tests
pnpm --filter @nexpanel/shared build && node --test packages/shared/dist/*.test.js

# API security & route tests
cd apps/api && pnpm exec tsc -p tsconfig.test.json && node --test dist-test/test/*.test.js

# Agent sandbox & path traversal tests
node --test agent/dist/*.test.js
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
