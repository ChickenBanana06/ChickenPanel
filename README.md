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
- [Commercial Hosting & Production Deployment Guide](#-commercial-hosting--production-deployment-guide)
  - [1. Production Infrastructure Topology](#1-production-infrastructure-topology)
  - [2. Reverse Proxy, Domains & SSL (Nginx / Caddy)](#2-reverse-proxy-domains--ssl-nginx--caddy)
  - [3. Production External Database (PostgreSQL 16)](#3-production-external-database-postgresql-16)
  - [4. Untrusted Customer Workloads & Node Hardening](#4-untrusted-customer-workloads--node-hardening)
  - [5. Network Security, Port Allocation & DDoS Mitigation](#5-network-security-port-allocation--ddos-mitigation)
  - [6. Remote Offsite Backups (S3 / R2 / Wasabi)](#6-remote-offsite-backups-s3--r2--wasabi)
  - [7. Billing & API Automation (WHMCS / Blesta / Tebex)](#7-billing--api-automation-whmcs--blesta--tebex)
  - [8. Production Monitoring & High Availability](#8-production-monitoring--high-availability)
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

## 🏢 Commercial Hosting & Production Deployment Guide

If you plan to run ChickenPanel as a **commercial hosting provider** (e.g. selling game servers, Discord bot hosting, or app hosting to public customers), follow this production architecture and hardening guide.

---

### 1. Production Infrastructure Topology

In a commercial environment, **never run the Web Panel and customer game servers on the same single server**. Separate the control plane from the compute nodes:

```text
               ┌────────────────────────────────────────────────────────┐
               │         Domain / DNS & Anycast DDoS Layer              │
               │           (Cloudflare / Cosmic Guard / Path)           │
               └───────────┬────────────────────────────────┬───────────┘
                           │ HTTPS (443)                    │ HTTPS / WSS (443)
                           ▼                                ▼
               ┌───────────────────────┐        ┌───────────────────────┐
               │ panel.yourhosting.com │        │  api.yourhosting.com  │
               └───────────┬───────────┘        └───────────┬───────────┘
                           │                                │
                           ▼                                ▼
              ┌──────────────────────────────────────────────────────────┐
              │             Dedicated Control Plane Server               │
              │  • Nginx Reverse Proxy (SSL Termination)                 │
              │  • Next.js Web UI (Port 3000)                            │
              │  • Fastify API & WebSocket Gateway (Port 4000)           │
              │  • Dedicated PostgreSQL 16 Cluster + Automated Backups   │
              └────────────────────────────┬─────────────────────────────┘
                                           │ Encrypted WebSocket (WSS)
                 ┌─────────────────────────┼─────────────────────────┐
                 ▼                         ▼                         ▼
      ┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
      │   Node 1 (US-East)  │   │   Node 2 (EU-West)  │   │   Node 3 (APAC)     │
      │  Bare-Metal Compute │   │  Bare-Metal Compute │   │  Bare-Metal Compute │
      │  • Ryzen 9 / EPYC   │   │  • Ryzen 9 / EPYC   │   │  • Ryzen 9 / EPYC   │
      │  • NVMe RAID 1      │   │  • NVMe RAID 1      │   │  • NVMe RAID 1      │
      │  • ChickenPanel Agt │   │  • ChickenPanel Agt │   │  • ChickenPanel Agt │
      │  • Customer Servers │   │  • Customer Servers │   │  • Customer Servers │
      └─────────────────────┘   └─────────────────────┘   └─────────────────────┘
```

#### Hardware Recommendations for Compute Nodes:
- **Game Server Hosting (Minecraft, Rust, Palworld):** High single-core boost clock CPUs (e.g., AMD Ryzen 9 7950X / 9950X or Intel Core i9-14900K), DDR5 ECC RAM, enterprise NVMe storage in RAID-1.
- **Bot & Python Hosting:** High core-count CPUs (AMD EPYC or Intel Xeon), high RAM density.
- **Network:** 1 Gbps to 10 Gbps unmetered uplink with upstream Anti-DDoS mitigation.

---

### 2. Reverse Proxy, Domains & SSL (Nginx / Caddy)

In production, do not expose raw Node ports (`3000` or `4000`) directly to users. Put them behind Nginx or Caddy with automated Let's Encrypt SSL.

#### Option A: Production Nginx Configuration

1. **Install Nginx and Certbot on your Control Plane server:**
   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```

2. **Create the Nginx site configuration:**
   ```bash
   sudo nano /etc/nginx/sites-available/chickenpanel.conf
   ```

3. **Paste the following configuration** (replace `panel.yourhosting.com` and `api.yourhosting.com` with your real domains):
   ```nginx
   # 1. ChickenPanel Web Frontend (Next.js)
   server {
       server_name panel.yourhosting.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }

   # 2. ChickenPanel API & WebSocket Gateway
   server {
       server_name api.yourhosting.com;

       location / {
           proxy_pass http://127.0.0.1:4000;
           proxy_http_version 1.1;

           # WebSocket support (Crucial for live consoles, tasks, & node agent connections)
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";

           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           # Timeout settings for persistent node agent connections
           proxy_read_timeout 86400s;
           proxy_send_timeout 86400s;
           client_max_body_size 500M;
       }
   }
   ```

4. **Enable site and obtain SSL certificates:**
   ```bash
   sudo ln -sf /etc/nginx/sites-available/chickenpanel.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   sudo certbot --nginx -d panel.yourhosting.com -d api.yourhosting.com
   ```

#### Option B: Caddy (Automatic HTTPS Alternative)
If you prefer Caddy for automatic certificate issuance:
```caddy
panel.yourhosting.com {
    reverse_proxy 127.0.0.1:3000
}

api.yourhosting.com {
    reverse_proxy 127.0.0.1:4000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
    }
}
```

---

### 3. Production External Database (PostgreSQL 16)

For commercial hosting, do not use the dev embedded database. Set up a standalone, optimized PostgreSQL 16 cluster.

1. **Install PostgreSQL 16 on Ubuntu:**
   ```bash
   sudo apt install -y postgresql postgresql-contrib
   sudo systemctl enable --now postgresql
   ```

2. **Create a production user and database with a strong random password:**
   ```bash
   sudo -u postgres psql
   ```
   Execute the SQL commands:
   ```sql
   CREATE USER chickenpanel_prod WITH PASSWORD 'ReplaceWithStrongProductionPassword32Chars!';
   CREATE DATABASE chickenpanel_prod OWNER chickenpanel_prod;
   GRANT ALL PRIVILEGES ON DATABASE chickenpanel_prod TO chickenpanel_prod;
   \q
   ```

3. **Configure ChickenPanel to use the production database:**
   In `/home/chickenpanel/chickenpanel/.env`:
   ```bash
   DATABASE_URL="postgresql://chickenpanel_prod:ReplaceWithStrongProductionPassword32Chars!@127.0.0.1:5432/chickenpanel_prod?sslmode=prefer"
   ```

4. **Deploy database migrations:**
   ```bash
   cd /home/chickenpanel/chickenpanel
   pnpm --filter @nexpanel/database migrate:deploy
   ```

5. **Automated Daily Database Backups:**
   Create `/etc/cron.daily/backup-chickenpanel-db`:
   ```bash
   sudo tee /etc/cron.daily/backup-chickenpanel-db << 'EOF'
   #!/usr/bin/env bash
   BACKUP_DIR="/var/backups/chickenpanel"
   mkdir -p "$BACKUP_DIR"
   pg_dump -U chickenpanel_prod -h 127.0.0.1 chickenpanel_prod | gzip > "$BACKUP_DIR/db-$(date +%F).sql.gz"
   find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +14 -delete
   EOF
   sudo chmod +x /etc/cron.daily/backup-chickenpanel-db
   ```

---

### 4. Untrusted Customer Workloads & Node Hardening

When hosting untrusted users, customer code may attempt privilege escalation, port scanning, or disk abuse. Apply the following node hardening measures:

#### A. Linux Kernel Hardening (`/etc/sysctl.d/99-security.conf`)
Prevent symlink exploits, ptrace snooping, and network buffer exhaustion:

```bash
sudo tee /etc/sysctl.d/99-security.conf << 'EOF'
# Prevent symlink and hardlink exploits in shared world-writable directories
fs.protected_symlinks = 1
fs.protected_hardlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2

# Increase file descriptor and process limits for hosting hundreds of servers
fs.file-max = 2097152

# Network connection handling & SYN flood protection
net.core.somaxconn = 65535
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF
sudo sysctl --system
```

#### B. Block Outbound Abuse & Spam (Egress Firewall)
Prevent compromised customer game servers or Discord bots from launching outbound DDoS attacks, sending spam, or scanning networks:

```bash
# Block outgoing SMTP (prevent spam blacklisting of your hosting IPs)
sudo iptables -A OUTPUT -p tcp --dport 25 -j DROP
sudo iptables -A OUTPUT -p tcp --dport 465 -j DROP
sudo iptables -A OUTPUT -p tcp --dport 587 -j DROP

# Block NetBIOS and SMB
sudo iptables -A OUTPUT -p tcp --dport 135:139 -j DROP
sudo iptables -A OUTPUT -p tcp --dport 445 -j DROP
sudo iptables -A OUTPUT -p udp --dport 137:138 -j DROP

# Block SSDP amplification reflection
sudo iptables -A OUTPUT -p udp --dport 1900 -j DROP

# Save iptables rules permanently
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

#### C. Enforce Disk Quotas per Customer Application
Prevent any individual customer from filling the node's disk with excessive logs, world files, or archives:
- Format the application storage drive with **ext4** (with `prjquota` enabled) or **XFS**.
- Mount storage with project quotas enabled:
  ```bash
  # In /etc/fstab:
  /dev/nvme0n1p1  /home/chickenpanel/.local/share/nexpanel-agent  ext4  defaults,prjquota  0  2
  ```

---

### 5. Network Security, Port Allocation & DDoS Mitigation

#### Port Allocation Strategy
- **Shared IP Address:** Assign each customer a specific game port (e.g., Customer A: `25565`, Customer B: `25566`, Customer C: `25567`). ChickenPanel automatically binds ports assigned during application creation.
- **Dedicated IP Addresses:** For premium hosting tiers, attach multiple secondary IP addresses to the node interface:
  ```bash
  sudo ip addr add 198.51.100.15/24 dev eth0
  ```
  Customers on dedicated IPs can use default standard ports (`25565` for Minecraft, `7777` for Terraria).

#### DDoS Mitigation Providers
Game servers are prime targets for Layer 4 UDP/TCP DDoS attacks (amplification, SYN floods, botnets). For commercial operations, route node traffic through a specialized gaming DDoS mitigation provider:
- **Cosmic Guard / Path.net / NeoProtect:** Specialized low-latency Layer 4 reverse-proxy filters designed specifically for Minecraft, Rust, and Steam games.
- **Cloudflare Spectrum:** TCP/UDP DDoS protection for game protocols.
- **OVHcloud / Hetzner:** Hardware Anti-DDoS protection included on dedicated servers.

---

### 6. Remote Offsite Backups (S3 / R2 / Wasabi)

Never store backups solely on the local server where customer applications reside. Automate replication to S3-compatible cloud storage:

1. **Install AWS CLI / Rclone:**
   ```bash
   sudo apt install -y rclone
   rclone config   # Configure S3, Cloudflare R2, Wasabi, or Backblaze B2
   ```

2. **Automate Nightly Backup Sync:**
   Create `/etc/cron.daily/sync-backups-s3`:
   ```bash
   sudo tee /etc/cron.daily/sync-backups-s3 << 'EOF'
   #!/usr/bin/env bash
   # Sync all customer application backups to offsite S3 bucket
   rclone sync /home/chickenpanel/.local/share/nexpanel-agent/backups remote-s3:myhosting-panel-backups/ --fast-list
   EOF
   sudo chmod +x /etc/cron.daily/sync-backups-s3
   ```

---

### 7. Billing & API Automation (WHMCS / Blesta / Tebex)

ChickenPanel provides a comprehensive REST API that allows your billing platform (WHMCS, Blesta, Tebex, or custom web store) to automatically provision, manage, suspend, and delete customer servers upon checkout or cancellation.

#### API Authentication
Create an API key in ChickenPanel (**Settings -> API Keys**) and include it in request headers:
```http
Authorization: Bearer <YOUR_PANEL_API_KEY>
Content-Type: application/json
```

#### Automated Workflows:

#### A. Provision Server on Payment (`POST /api/apps`)
```bash
curl -X POST https://api.yourhosting.com/api/apps \
  -H "Authorization: Bearer <YOUR_PANEL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer #1042 - Paper 1.21",
    "type": "minecraft",
    "nodeId": "node_cm123abc",
    "ownerId": "usr_cust1042",
    "flavor": "paper",
    "version": "1.21.1",
    "memoryMb": 4096,
    "port": 25565
  }'
```

#### B. Start Server (`POST /api/apps/:id/start`)
```bash
curl -X POST https://api.yourhosting.com/api/apps/app_987xyz/start \
  -H "Authorization: Bearer <YOUR_PANEL_API_KEY>"
```

#### C. Suspend Server on Overdue Invoice (`POST /api/apps/:id/stop`)
```bash
curl -X POST https://api.yourhosting.com/api/apps/app_987xyz/stop \
  -H "Authorization: Bearer <YOUR_PANEL_API_KEY>"
```

#### D. Terminate Server on Cancellation / Chargeback (`DELETE /api/apps/:id`)
```bash
curl -X DELETE https://api.yourhosting.com/api/apps/app_987xyz \
  -H "Authorization: Bearer <YOUR_PANEL_API_KEY>"
```

---

### 8. Production Monitoring & High Availability

#### A. Node Exporter & Prometheus Monitoring
Monitor CPU, RAM, disk I/O, and network bandwidth on each compute node:
```bash
sudo apt install -y prometheus-node-exporter
sudo systemctl enable --now prometheus-node-exporter
```
Scrape port `9100` into your centralized Grafana dashboard to alert when node RAM exceeds 90% or disk usage reaches 85%.

#### B. Production Node Agent Systemd Service
On each compute node, run the agent as a resilient systemd daemon:

```bash
sudo tee /etc/systemd/system/chickenpanel-agent.service << 'EOF'
[Unit]
Description=ChickenPanel Node Compute Agent
After=network.target

[Service]
Type=forking
User=chickenpanel
WorkingDirectory=/home/chickenpanel/chickenpanel
ExecStart=/usr/local/bin/chickenpanel start agent
ExecStop=/usr/local/bin/chickenpanel stop agent
Restart=always
RestartSec=5
LimitNOFILE=65535
LimitNPROC=32768

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now chickenpanel-agent
```

#### C. Log Rotation
Prevent log files in `~/.local/share/nexpanel/logs/` from growing indefinitely:

```bash
sudo tee /etc/logrotate.d/chickenpanel << 'EOF'
/home/chickenpanel/.local/share/nexpanel/logs/*.log
/home/chickenpanel/.local/share/nexpanel-agent/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
EOF
```

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
