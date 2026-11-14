# Maju ERP

A browser-based ERP for accounts and inventory, hosted on GitHub Pages and sold to companies on a **monthly subscription**.

- **Customer app:** https://mmuazch.github.io/maju-erp/
- **Owner panel (only you):** https://mmuazch.github.io/maju-erp/owner.html

## Modules
- **Dashboards** – Home and Analytics
- **Items** – items, inventory adjustments, inventory consumption, locations/warehouses (weighted-average costing)
- **Cash & Banks** – account balances, money in/out, fund transfers
- **Sales** – customers, estimates, sales orders, delivery notes & returns, invoices, payments received, recurring invoices, sales returns, salesman
- **Purchases** – suppliers, expenses, recurring expenses, purchase requests, purchase orders, GRN, bills, recurring bills, payments made, purchase returns
- **Project Management** – projects (income/cost/profit tracking) and BOM with production
- **Accounts** – journals, recurring journals, chart of accounts, money in/out vouchers, transaction locking, budget
- **Stock** – demand, issue to location, receipt in location (stock in transit)
- **Taxation** – sales tax return, tax payments
- **Reports** – 50+ reports: sales, purchases, business overview (TB, P&L, balance sheet, cash flow, daily funds, budget vs actual), ledgers, inventory, tax, receivables, payables, expenses, projects
- **Tools** – print documents, export any report to Excel (CSV), backup & restore
- **Users & Subscription** – company logins, staff codes, plan, days left, payment history

## How the subscription works
| Who | What they do |
|---|---|
| **A new company** | Opens the app → **Free trial** → enters company name, name, email, password. Gets 14 days free (you can change this). |
| **You (owner)** | Can also open a company yourself in the owner panel and send them an **administrator code**. |
| **Company administrator** | Settings → **Users & Subscription** → sends the **staff code** to staff. Can switch staff logins off and on. |
| **Staff** | Opens the app → **Join company** → enters the code and creates their own login. |
| **Payment** | Company pays you by bank / JazzCash / Easypaisa. You click **Record payment** in the owner panel → access is extended by the months paid. |
| **Not paid** | When the trial or paid period ends, the company sees a "subscription ended" screen with your payment instructions. Their data stays safe and returns once you record the payment. You can also **Block** a company at any time. |

Plans (you can change prices and add plans in the owner panel):

| Plan | Price / month | Users |
|---|---|---|
| Basic | Rs 5,000 | 3 |
| Standard | Rs 10,000 | 10 |
| Premium | Rs 20,000 | 50 |

Each company's data is stored online, separately. One company can never see another company's data — this is enforced by the database itself, not just the app.

## One-time setup (about 15 minutes)

### 1. Create the free database
1. Go to **supabase.com** → sign up → **New project**. Name it `maju-erp`, choose a strong database password, region **Singapore** (closest to Pakistan) or **Mumbai**.
2. Wait about 2 minutes for it to start.

### 2. Create the tables
1. Open `supabase/setup.sql` from this repo. The owner email is already set on the line marked `<<< OWNER`.
2. In Supabase, open **SQL Editor** → **New query** → paste the whole file → **Run**. It should say *Success. No rows returned.*

### 3. Set the website address for emails
In Supabase → **Authentication** → **URL Configuration**:
- **Site URL:** `https://mmuazch.github.io/maju-erp/`
- **Redirect URLs:** add `https://mmuazch.github.io/maju-erp/*`

(Supabase's free email sender allows only a few emails per hour. While you are testing you can turn off **Authentication → Sign In / Providers → Email → Confirm email**. For real customers, turn it back on and later connect your own email sender under **Authentication → Emails → SMTP Settings**.)

### 4. Connect the app
1. In Supabase → **Project Settings** → **API** (or **Data API / API Keys**), copy the **Project URL** and the **anon public** key.
2. Edit `config.js` in this repo and paste them in place of `https://YOUR-PROJECT.supabase.co` and `YOUR-ANON-PUBLIC-KEY`. Commit.

The anon key is meant to be public. Never put the **service_role** key in this repo.

### 5. Create your owner login
Open **owner.html** → **Create your owner login** → use the same email you put in `setup.sql`. In the owner panel, go to **Settings** and enter your bank / JazzCash / Easypaisa details and WhatsApp number — customers see these when they need to pay.

You're live. Share `https://mmuazch.github.io/maju-erp/` with companies.

## Working offline
If `config.js` still has the placeholder values, Maju ERP works exactly like before: no login, data saved only in the browser. When a company administrator signs in online for the first time on a computer that already has offline data, the app offers to move that data online.

## Good to know
- Several staff can work at the same time. If two people save at the same moment, the app combines both sets of changes. Changes made by others appear when you move to another screen (or click the "New changes" label at the top).
- If the internet drops, the top bar shows **Offline — retrying** and saves as soon as the connection is back. Don't close the tab while it says that.
- Supabase's free plan pauses a project after about a week with no use at all. Once customers use it daily this won't happen; if it does, open the project in Supabase and click **Restore**. When you have several paying companies, the Pro plan (about $25/month) removes this limit and adds daily backups.
- Back up from the owner side: Supabase → **Database → Backups** (daily backups on paid plans), or each company can still use **Settings → Backup & Restore** to download a copy.
- Files: `index.html` (the ERP), `cloud.js` (logins, subscription, online saving), `config.js` (your Supabase keys), `owner.html` (owner panel), `supabase/setup.sql` (database).
