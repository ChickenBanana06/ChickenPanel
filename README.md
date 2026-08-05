# ChickenPanel 🐤

AI-powered, cross-platform server management platform. Install it on your own machine or VPS and manage Minecraft servers, Discord bots, websites, databases, files, backups, and multiple nodes from a clean web panel with a built-in AI operator.

Works on **Windows** and **Linux**. macOS works via the POSIX platform layer (unsupported but functional).

> The CLI is `chickenpanel` (the older `nexpanel` alias still works). Internal package names (`@nexpanel/*`), environment variables (`NEXPANEL_*`), and data directories keep their original identifiers for compatibility.

***

## 🚀 One-Line Auto Install

Simply run the command below on your machine. The script will automatically clone the repository, install dependencies (like `pnpm`), build the platform, and set up global command shims.

### Linux / macOS
```bash
curl -fsSL https://raw.githubusercontent.com/ChickenBanana06/ChickenPanel/main/scripts/bootstrap.sh | sh
```

### Windows (Run in PowerShell as Administrator)
```powershell
irm https://raw.githubusercontent.com/ChickenBanana06/ChickenPanel/main/scripts/bootstrap.ps1 | iex
```

***

## 🛠️ Step-by-Step Guides

### 1. Installation Guide

If you prefer a manual setup, or if the one-line bootstrap fails, follow these steps:

#### Requirements & Node.js Installation

##### 1. Node.js 20+
If Node.js is not yet installed on your system, install it using the appropriate command:

* **Ubuntu / Debian**:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
* **CentOS / RHEL / Rocky Linux**:
  ```bash
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
  sudo yum install -y nodejs
  ```
* **macOS (Homebrew)**:
  ```bash
  brew install node@20 && brew link node@20
  ```
* **Windows**: Download the installer directly from the [Node.js Official Website](https://nodejs.org/).

##### 2. Other Requirements
- **Git** (Required for version control and updates)
- **pnpm 10+** (Install globally via `npm install -g pnpm@10`)
- **Java 21+** (Optional; required for Minecraft servers. The panel will auto-download a JRE if missing.)

#### Manual Setup Steps
1. **Clone the Repository**
   ```bash
   git clone https://github.com/ChickenBanana06/ChickenPanel.git
   cd ChickenPanel
   ```
2. **Install Dependencies**
   ```bash
   pnpm install
   ```
3. **Build the Project**
   ```bash
   pnpm -r --workspace-concurrency=1 build
   ```
4. **Initialize the Database (First-time setup)**
   ```bash
   node apps/cli/dist/index.js install
   ```
5. **Start the Control Panel Services (Embedded Database + API + Web UI)**
   ```bash
   node apps/cli/dist/index.js start
   ```
6. **Access the Web Panel**
   - Open **`http://<your-server-ip>:3000`** in your browser (or `http://localhost:3000` if installing on your local computer).
   - Register your administrator account (the first registered account automatically becomes the administrator).

---

### 2. How to Link Nodes

A **Node** represents any physical machine or VPS where you want to run servers, databases, or applications. You can link multiple nodes to a single central control panel.

#### Step 1: Add Node in the Panel
1. Open the ChickenPanel Web UI.
2. Navigate to **Nodes** in the sidebar.
3. Click **Add Node**.
4. Give your Node a **Name** (e.g., `vps-chicago-1`) and description, then click **Create**.
5. The panel will display a **Registration Command** containing a URL and a secure node token. Copy this command.

#### Step 2: Register the Node Agent
1. Log in to the terminal of the target machine/node.
2. Install ChickenPanel on the node using the installation steps above.
3. Run the registration command (replace `<url>` and `<token>` with your panel's values):
   ```bash
   # If global command is installed:
   chickenpanel node register <url> <token>
   
   # Or using the direct path:
   node apps/cli/dist/index.js node register <url> <token>
   ```
4. This creates a secure configuration at `<agent-data-dir>/agent.json`.

#### Step 3: Start the Node Agent
1. Start the agent process so it can communicate with the control plane:
   ```bash
   # If global command is installed:
   chickenpanel start agent
   
   # Or using the direct path:
   node apps/cli/dist/index.js start agent
   ```
2. Return to the Central Panel UI. The Node status will change to **ONLINE** 🟢, and you can now deploy servers to it.

---

### 3. How to Setup Servers & Apps

Once a node is linked and online, you can deploy applications (Minecraft servers, Discord bots, Python apps, static sites, databases, etc.) in a few clicks.

#### Step 1: Create the Application
1. Go to the **Applications** page in the sidebar and click **Create Application**.
2. **Select Node**: Choose the online node where you want this server to run.
3. **Application Type**: Select from the catalog (e.g., `minecraft`, `node`, `python`, `postgres`, `redis`, `discord-bot`, `custom`).
4. **Configuration**:
   - For **Minecraft**: Select the software (Vanilla, Paper, Purpur, etc.) and version.
   - Configure **Memory limits** (RAM) and **Ports**.
   - Input **Environment variables** if needed.
5. Click **Create**.

#### Step 2: Provisioning & Auto-Downloads
- Creating a server triggers a **Background Provisioning Task** on the node.
- The node agent will automatically create directories, download the required server binaries/JARs (e.g., fetching Mojang/Paper APIs), download a Java Runtime (JRE 21) if the node lacks it, and verify hashes.
- You can monitor progress live in the **Task System** or the sidebar tasks window.

#### Step 3: Run and Control
1. Once the status changes to `stopped`, navigate to the application's page.
2. Click **Start** to boot the server.
3. Use the **Console** tab to read live log output and send stdin command lines (e.g., Minecraft console commands).
4. Use the built-in **AI Operator** to ask questions, edit configuration files, execute tasks, or automate backups.

***

## 💻 Development & Contributions

If you want to contribute or run in hot-reload mode:

```bash
pnpm install
pnpm -r --workspace-concurrency=1 build   # build everything
pnpm --filter @nexpanel/database dev      # terminal 1: embedded PostgreSQL (port 5490)
pnpm dev:api                              # terminal 2: API with hot reload (port 4000)
pnpm dev:web                              # terminal 3: Next.js dev server (port 3000)
pnpm dev:agent                            # terminal 4: node agent (requires env config)
```

### Run Tests
```bash
pnpm -r typecheck
pnpm --filter @nexpanel/shared build && node --test packages/shared/dist/*.test.js
cd apps/api && pnpm exec tsc -p tsconfig.test.json && node --test dist-test/test/*.test.js
node --test agent/dist/*.test.js
node scripts/e2e-smoke.mjs --with-agent   # end-to-end smoke test
```

***

## 🔒 Security Summary

- Node tokens & session tokens are stored as SHA-256 hashes.
- Path traversal is strictly blocked at both API and agent layers.
- AI provider keys are AES-256-GCM encrypted at rest using a panel master secret.
- Dangerous operations (deletes, restores, shell commands) initiated by the AI require explicit per-call user approval.
