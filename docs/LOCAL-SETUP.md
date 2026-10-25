# Run Elox BioTech on your laptop

This guide gets the app running on your own computer, so you can edit the code and see each change in your browser straight away, then send your changes to GitHub. It works on Windows and Mac. Where the steps differ, both are shown.

You only do Part 1 once. After that, each working session is Part 3 and Part 4.

---

## Part 1: Install the tools (once)

| Tool | What it's for | Windows | Mac |
| --- | --- | --- | --- |
| **Node.js 22** | Runs the app | Download the **22.x LTS** installer from [nodejs.org](https://nodejs.org/en/download) and run it | Same download, the macOS installer |
| **Git** | Gets the code and sends changes to GitHub | [git-scm.com/download/win](https://git-scm.com/download/win), accept the defaults | Open **Terminal** and run `xcode-select --install` |
| **Docker Desktop** | Runs the PostgreSQL database for you | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) | Same page, pick Apple chip or Intel chip |
| **VS Code** (optional) | Code editor | [code.visualstudio.com](https://code.visualstudio.com/) | Same |

Use Node **22**, not a newer major version: the project is set to Node 22.

Check they're installed. Open a terminal (Windows: **PowerShell**; Mac: **Terminal**) and run:

```sh
node -v      # should print v22.something
git --version
docker --version
```

Then open **Docker Desktop** once and leave it running (the whale icon in the taskbar or menu bar).

Tell Git who you are (use the email on your GitHub account):

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

## Part 2: Set up the project (once)

### 1. Get the code

Pick a folder for your projects, then:

```sh
cd Documents
git clone https://github.com/burnaboy/eloxbiotech.git
cd eloxbiotech
```

The first time Git talks to GitHub it opens a browser window to sign in. Sign in as `burnaboy`.

### 2. Start the database

```sh
docker run -d --name elox-db -p 5432:5432 -e POSTGRES_USER=mlm -e POSTGRES_PASSWORD=mlm -e POSTGRES_DB=mlm --restart unless-stopped postgres:16
```

This downloads PostgreSQL 16 the first time (a minute or two) and keeps it running in the background. `--restart unless-stopped` starts it again whenever Docker Desktop starts.

### 3. Create your settings file

Copy the example settings:

- Windows (PowerShell): `copy .env.example .env`
- Mac: `cp .env.example .env`

Make a secret key for encrypting bank details:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open `.env` in your editor and paste the key between the quotes on the `APP_ENCRYPTION_KEY=""` line, for example:

```
APP_ENCRYPTION_KEY="k3Jx...your key...Q="
```

Leave everything else as it is. `.env` stays on your laptop: Git ignores it, so it never goes to GitHub.

### 4. Install the app's packages

```sh
npm ci
```

### 5. Create the database tables and the demo data

```sh
npx prisma migrate deploy
```

Then create your admin account and demo members (choose your own admin password):

- Windows (PowerShell):
  ```powershell
  $env:SEED_ADMIN_PASSWORD="ChooseAPassword1"; $env:SEED_DEMO="1"; npm run seed
  ```
- Mac:
  ```sh
  SEED_ADMIN_PASSWORD='ChooseAPassword1' SEED_DEMO=1 npm run seed
  ```

You get:

| Account | Email | Password |
| --- | --- | --- |
| Admin | `admin@eloxbiotech.local` | the one you chose |
| Affiliate (demo) | `ada@demo.local` | `Password123` |
| Customer (demo) | `dami@demo.local` | `Password123` |

---

## Part 3: Run it and see your changes live

```sh
npm run dev
```

Open **http://localhost:3000** in your browser.

Leave that terminal window open while you work. Every time you save a file in the project, the page in your browser updates on its own within a second or two. Try it: open `src/lib/settings.ts`, change the text `Genuine products, rewarded fairly.`, save, and look at the home page.

Good to know:

- **Payments** use a built-in test page with "Pay successfully" and "Decline" buttons. No real money, no Paystack account needed.
- **Emails** (verification, password reset) aren't sent. They're saved in the database. The demo accounts are already verified.
- **Admin area** (`/admin`) asks you to set up two-step sign-in on first visit: scan the QR code with an authenticator app such as Google Authenticator or Microsoft Authenticator.
- **Light and dark mode**: the button at the top right of every page.
- **Stop the app**: press `Ctrl + C` in the terminal. Start it again with `npm run dev`.

---

## Part 4: Send your changes to GitHub

When you've made a change you want to keep, open a **second** terminal in the project folder (leave the app running in the first) and run:

```sh
git status                       # see which files you changed
git add -A                       # include all your changes
git commit -m "Describe what you changed"
git push
```

Your change is now on GitHub, and the automatic checks run on it there: see the **Actions** tab at [github.com/burnaboy/eloxbiotech/actions](https://github.com/burnaboy/eloxbiotech/actions). A green tick means everything passed.

**Before you start work each day**, get the latest version (including anything Claude has pushed):

```sh
git pull
npm ci                           # only needed if package.json changed
npx prisma migrate deploy        # only needed if there are new database changes; safe to run anyway
```

If you'd rather click than type, [GitHub Desktop](https://desktop.github.com/) does the same add, commit, push and pull with buttons.

---

## If something goes wrong

| Problem | Fix |
| --- | --- |
| `Can't reach database server at localhost:5432` | Docker Desktop isn't running, or the database is stopped. Open Docker Desktop, then run `docker start elox-db` |
| `port is already allocated` when starting the database | Another PostgreSQL is already using port 5432. Stop it, or change both `-p 5432:5432` to `-p 5433:5432` and `localhost:5432` to `localhost:5433` in `.env` |
| `Port 3000 is in use` | Another app is using it. Run `npm run dev -- -p 3001` and open http://localhost:3001 |
| `APP_ENCRYPTION_KEY` error | The key in `.env` is missing or not 32 bytes. Make a new one (Part 2, step 3) |
| Errors after `git pull` | Run `npm ci` and `npx prisma migrate deploy`, then `npm run dev` again |
| `git push` is refused | Run `git pull` first (someone else pushed), then `git push` again |
| Want a clean start with fresh demo data | `docker rm -f elox-db`, then repeat Part 2 steps 2 and 5 |

## Running the tests (optional)

```sh
docker exec elox-db createdb -U mlm mlm_test
npm test
```

The full set of checks, including browser tests, is described in `docs/COMMANDS.md`; GitHub runs all of them automatically on every push.
