/* =========================================================
   Maju ERP — online accounts, monthly subscription and sync
   Uses Supabase (see supabase/setup.sql and config.js).
   If config.js has no keys, Maju ERP runs offline as before.
   ========================================================= */
(function () {
'use strict';
const CFG = window.MAJU_CONFIG || {};
const ON = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/YOUR/.test(CFG.supabaseUrl + CFG.supabaseAnonKey));
const RECOVERY_LINK = /type=recovery/.test(location.hash);
const HERE = location.origin + location.pathname;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const never = () => new Promise(() => {});
const q = (sel, root = document) => root.querySelector(sel);
const fdate = d => {
  if (!d) return '—';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}-${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+m - 1]}-${y}`;
};
const money = n => (+n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const nice = msg => {
  msg = String(msg || 'Something went wrong');
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first — open the link we sent you, then sign in.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Cannot reach the server. Check your internet connection.';
  if (/Password should be at least/i.test(msg)) return 'Password must be at least 6 characters.';
  if (/User already registered/i.test(msg)) return 'This email already has an account. Please sign in instead.';
  return msg;
};

/* ---------- merging two people's changes ---------- */
// base = data both started from, local = this browser, remote = what is saved online now
function merge(base, local, remote) {
  base = base || {}; remote = remote || {};
  const out = clone(remote);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of Object.keys(local)) {
    const L = local[k], B = base[k], R = remote[k];
    if (same(L, B)) continue;                                   // not changed here → keep remote
    if (Array.isArray(L) && L.every(x => x && typeof x === 'object' && x.id != null)) {
      const bMap = new Map((Array.isArray(B) ? B : []).filter(x => x && x.id != null).map(x => [x.id, JSON.stringify(x)]));
      const lIds = new Set(L.map(x => x.id));
      let arr = Array.isArray(R) ? out[k] : [];
      for (const x of L) {                                       // added or edited here
        if (bMap.get(x.id) === JSON.stringify(x)) continue;
        const i = arr.findIndex(y => y && y.id === x.id);
        if (i >= 0) arr[i] = clone(x); else arr.push(clone(x));
      }
      for (const id of bMap.keys()) if (!lIds.has(id)) arr = arr.filter(y => !(y && y.id === id)); // deleted here
      out[k] = arr;
    } else if (k === 'counters' && L && typeof L === 'object') {
      out[k] = Object.assign({}, R || {});
      for (const p of Object.keys(L)) out[k][p] = Math.max(+L[p] || 0, +(R && R[p]) || 0);
    } else if (L && typeof L === 'object' && !Array.isArray(L)) {
      out[k] = Object.assign({}, R && typeof R === 'object' ? R : {});
      for (const p of Object.keys(L)) if (!B || !same(L[p], B[p])) out[k][p] = clone(L[p]);
      if (B) for (const p of Object.keys(B)) if (!(p in L)) delete out[k][p];
    } else out[k] = clone(L);
  }
  return out;
}
// replace the contents of the live data object without breaking references held by open screens
function applyInPlace(target, src) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const k of Object.keys(src)) {
    const t = target[k], s = src[k];
    if (Array.isArray(t) && Array.isArray(s)) { t.length = 0; for (const x of s) t.push(x); }
    else if (t && s && typeof t === 'object' && typeof s === 'object' && !Array.isArray(t) && !Array.isArray(s)) {
      for (const p of Object.keys(t)) if (!(p in s)) delete t[p];
      Object.assign(t, s);
    } else target[k] = s;
  }
}

/* ---------- styles for the sign-in and lock screens ---------- */
const CSS = `
.cl-wrap{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(160deg,#0d1b24 0%,#14262f 55%,#0f766e 140%)}
.cl-card{width:100%;max-width:430px;background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:28px}
.cl-card.wide{max-width:560px}
.cl-brand{display:flex;gap:10px;align-items:center;margin-bottom:18px}
.cl-logo{width:40px;height:40px;border-radius:10px;background:var(--acc,#0f766e);color:#fff;display:grid;place-items:center;font-weight:700}
.cl-brand b{display:block;font-size:16px}.cl-brand small{color:var(--muted,#667385);font-size:12px}
.cl-tabs{display:flex;gap:4px;background:var(--line2,#eef2f5);padding:4px;border-radius:9px;margin-bottom:18px}
.cl-tabs button{flex:1;border:0;background:none;padding:8px 6px;border-radius:7px;cursor:pointer;font-weight:600;color:var(--muted,#667385);font-size:13px}
.cl-tabs button.on{background:#fff;color:var(--ink,#18212b);box-shadow:0 1px 3px rgba(0,0,0,.1)}
.cl-f{display:grid;gap:12px}
.cl-f label{display:grid;gap:5px;font-size:13px;font-weight:600}
.cl-f input{height:40px;border:1px solid var(--line,#e3e8ee);border-radius:8px;padding:0 12px;font-weight:400}
.cl-f input:focus{outline:2px solid var(--acc-soft,#e6f3f1);border-color:var(--acc,#0f766e)}
.cl-btn{height:42px;border:0;border-radius:8px;background:var(--acc,#0f766e);color:#fff;font-weight:650;cursor:pointer;padding:0 16px}
.cl-btn:hover{background:var(--acc2,#0b5f59)}.cl-btn:disabled{opacity:.6;cursor:wait}
.cl-btn.ghost{background:#fff;color:var(--ink,#18212b);border:1px solid var(--line,#e3e8ee)}
.cl-link{background:none;border:0;color:var(--acc,#0f766e);cursor:pointer;font-weight:600;padding:0}
.cl-err{background:#fdeee6;color:#9a3412;border-radius:8px;padding:10px 12px;font-size:13px}
.cl-ok{background:#e7f6ec;color:#166534;border-radius:8px;padding:10px 12px;font-size:13px}
.cl-note{color:var(--muted,#667385);font-size:12.5px;margin:0}
.cl-msg{padding:30px 0;text-align:center;color:var(--muted,#667385)}
.cl-box{border:1px solid var(--line,#e3e8ee);border-radius:10px;padding:14px;white-space:pre-wrap;font-size:13.5px;background:#fafbfc}
.cl-row{display:flex;gap:10px;flex-wrap:wrap}.cl-row>*{flex:1}
.cl-big{font-size:20px;font-weight:700;margin:0 0 6px}
#cloudBar{display:flex;align-items:center;gap:8px}
.cl-st{font-size:12px;padding:3px 9px;border-radius:20px;background:var(--line2,#eef2f5);color:var(--muted,#667385);white-space:nowrap;cursor:default}
.cl-st.saving,.cl-st.pending{color:var(--blue,#1d4ed8);background:#eef2ff}
.cl-st.offline{color:var(--red,#c2410c);background:var(--red-soft,#fdeee6)}
.cl-st.incoming{color:var(--amber,#b45309);background:#fef5e4;cursor:pointer}
.cl-sub{font-size:12px;padding:3px 9px;border-radius:20px;background:var(--acc-soft,#e6f3f1);color:var(--acc,#0f766e);white-space:nowrap}
.cl-sub.warn{background:#fef5e4;color:var(--amber,#b45309)}
.cl-user{position:relative}
.cl-user>button{display:flex;align-items:center;gap:6px;border:1px solid var(--line,#e3e8ee);background:#fff;border-radius:20px;height:30px;padding:0 10px 0 4px;cursor:pointer;font-size:12.5px}
.cl-av{width:22px;height:22px;border-radius:50%;background:var(--acc,#0f766e);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700}
.cl-menu{display:none;position:absolute;right:0;top:36px;background:#fff;border:1px solid var(--line,#e3e8ee);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.12);min-width:220px;z-index:50;padding:6px}
.cl-user.open .cl-menu{display:block}
.cl-menu .hd{padding:8px 10px;border-bottom:1px solid var(--line2,#eef2f5);margin-bottom:4px;font-size:12.5px}
.cl-menu .hd small{display:block;color:var(--muted,#667385)}
.cl-menu a,.cl-menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:13.5px}
.cl-menu a:hover,.cl-menu button:hover{background:var(--line2,#eef2f5)}
.cl-code{font:700 20px/1 ui-monospace,Consolas,monospace;letter-spacing:3px;background:var(--acc-soft,#e6f3f1);color:var(--acc,#0f766e);padding:10px 14px;border-radius:8px;display:inline-block}
.cl-kv{display:grid;grid-template-columns:160px 1fr;gap:8px 14px;font-size:13.5px}.cl-kv span{color:var(--muted,#667385)}
.b-trial{background:#eef2ff;color:var(--blue,#1d4ed8)}.b-due-soon{background:#fef5e4;color:var(--amber,#b45309)}.b-blocked,.b-switched-off{background:var(--red-soft,#fdeee6);color:var(--red,#c2410c)}
@media (max-width:980px){.cl-st,.cl-sub{display:none}}
@media print{#cloudBar{display:none}}`;

const Cloud = {
  enabled: ON, sb: null, acct: null, data: null, version: 0, base: null,
  pending: false, saving: false, again: false, timer: null, retryTimer: null,
  incoming: null, state: 'saved', started: false, needsFirstSave: false, recovery: false,

  /* ---------------- start-up ---------------- */
  async start() {
    if (!ON) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    if (!window.supabase || !window.supabase.createClient) {
      this.screen(`<div class="cl-err">Could not load the online service. Check your internet connection, then refresh this page.</div>`);
      return never();
    }
    this.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey,
      { auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    this.sb.auth.onAuthStateChange(ev => {
      if (ev === 'PASSWORD_RECOVERY') this.recovery = true;
      if (ev === 'SIGNED_OUT' && this.started) location.replace(HERE);
    });
    this.screen(`<div class="cl-msg">Loading…</div>`);
    let session = null;
    try { session = (await this.sb.auth.getSession()).data.session; } catch (e) {}
    if (session && (RECOVERY_LINK || this.recovery)) await this.newPasswordForm();
    if (!session) session = await this.authForm();
    if (/access_token|type=|error_description/.test(location.hash)) history.replaceState(null, '', HERE + '#/dashboard');
    await this.loadAccount();
    await this.loadData();
    this.started = true;
    this.bindSync();
  },

  // called by the boot code after DB.load()
  afterLoad() {
    if (!ON) return;
    this.addAccountPage();
    if (this.needsFirstSave) this.queueSave();
  },

  async rpc(fn, args) {
    const { data, error } = await this.sb.rpc(fn, args || {});
    if (error) throw new Error(error.message);
    return data;
  },

  screen(html, wide) {
    document.body.innerHTML = `<div class="cl-wrap"><div class="cl-card ${wide ? 'wide' : ''}">
      <div class="cl-brand"><div class="cl-logo">MJ</div><div><b>Maju ERP</b><small>Accounts & Inventory · Online</small></div></div>${html}</div></div>`;
    return q('.cl-card');
  },

  /* ---------------- sign in / free trial / join ---------------- */
  async authForm() {
    let cfg = { allow_self_signup: true, trial_days: 14 };
    try { const r = await this.sb.from('platform_settings').select('allow_self_signup,trial_days').single(); if (r.data) cfg = r.data; } catch (e) {}
    return new Promise(resolve => {
      const show = (tab, msg) => {
        const tabs = [['in', 'Sign in'], cfg.allow_self_signup && ['trial', 'Free trial'], ['join', 'Join company']].filter(Boolean);
        const fields = {
          in: `<label>Email<input name="email" type="email" autocomplete="email" required></label>
               <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
               <button class="cl-btn">Sign in</button>
               <p class="cl-note"><button type="button" class="cl-link" data-tab="forgot">Forgot password?</button></p>`,
          trial: `<p class="cl-note">Open an account for your company and use Maju ERP free for ${cfg.trial_days} days. You become the company administrator and can add your staff.</p>
               <label>Company name<input name="company" required></label>
               <label>Your name<input name="name" required></label>
               <label>Email<input name="email" type="email" autocomplete="email" required></label>
               <label>Password<input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
               <button class="cl-btn">Start free trial</button>`,
          join: `<p class="cl-note">Your company administrator gives you a company code.</p>
               <label>Company code<input name="code" required style="text-transform:uppercase;letter-spacing:2px"></label>
               <label>Your name<input name="name" required></label>
               <label>Email<input name="email" type="email" autocomplete="email" required></label>
               <label>Password<input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
               <button class="cl-btn">Create my login</button>`,
          forgot: `<p class="cl-note">Enter your email and we will send you a link to set a new password.</p>
               <label>Email<input name="email" type="email" autocomplete="email" required></label>
               <button class="cl-btn">Send reset link</button>
               <p class="cl-note"><button type="button" class="cl-link" data-tab="in">Back to sign in</button></p>`
        };
        const card = this.screen(`
          ${tab !== 'forgot' ? `<div class="cl-tabs">${tabs.map(t => `<button type="button" data-tab="${t[0]}" class="${t[0] === tab ? 'on' : ''}">${t[1]}</button>`).join('')}</div>` : '<p class="cl-big">Reset password</p>'}
          <form class="cl-f" novalidate>${msg || ''}${fields[tab]}</form>`);
        card.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));
        const form = q('form', card);
        setTimeout(() => { if (!form.contains(document.activeElement)) q('input', form)?.focus(); }, 20);
        form.onsubmit = async e => {
          e.preventDefault();
          if (!form.reportValidity()) return;
          const v = Object.fromEntries(new FormData(form)); const btn = q('.cl-btn', form);
          const err = m => { q('.cl-err,.cl-ok', form)?.remove(); form.insertAdjacentHTML('afterbegin', `<div class="cl-err">${esc(nice(m))}</div>`); btn.disabled = false; };
          btn.disabled = true;
          try {
            if (tab === 'in') {
              const { data, error } = await this.sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password });
              if (error) return err(error.message);
              return resolve(data.session);
            }
            if (tab === 'forgot') {
              const { error } = await this.sb.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: HERE });
              if (error) return err(error.message);
              return show('in', `<div class="cl-ok">If that email has an account, a reset link is on its way. Open it on this device.</div>`);
            }
            const meta = tab === 'trial' ? { company_name: v.company.trim(), full_name: v.name.trim() } : { join_code: v.code.trim().toUpperCase(), full_name: v.name.trim() };
            const { data, error } = await this.sb.auth.signUp({ email: v.email.trim(), password: v.password, options: { data: meta, emailRedirectTo: HERE } });
            if (error) return err(error.message);
            if (data.session) return resolve(data.session);
            show('in', `<div class="cl-ok">Almost done! We sent a confirmation link to <b>${esc(v.email)}</b>. Open it, then sign in here.</div>`);
          } catch (ex) { err(ex.message); }
        };
      };
      show('in');
    });
  },

  async newPasswordForm() {
    return new Promise(resolve => {
      const card = this.screen(`<p class="cl-big">Set a new password</p>
        <form class="cl-f"><label>New password<input name="p1" type="password" minlength="6" autocomplete="new-password" required></label>
        <label>Repeat new password<input name="p2" type="password" minlength="6" autocomplete="new-password" required></label>
        <button class="cl-btn">Save password</button></form>`);
      const form = q('form', card);
      form.onsubmit = async e => {
        e.preventDefault(); q('.cl-err', form)?.remove();
        const v = Object.fromEntries(new FormData(form));
        const err = m => form.insertAdjacentHTML('afterbegin', `<div class="cl-err">${esc(nice(m))}</div>`);
        if (v.p1 !== v.p2) return err('The two passwords do not match.');
        const { error } = await this.sb.auth.updateUser({ password: v.p1 });
        if (error) return err(error.message);
        this.recovery = false; resolve();
      };
    });
  },

  /* ---------------- company link + subscription check ---------------- */
  async loadAccount() {
    for (;;) {
      let a;
      try {
        a = await this.rpc('my_account');
        if (!a.member) { try { a = await this.rpc('complete_signup'); } catch (e) { this.linkError = e.message; } }
      } catch (e) {
        await this.retryScreen(e.message); continue;
      }
      this.acct = a;
      if (!a.member) { await this.linkForm(a); continue; }
      if (!a.member.active) { await this.lockScreen('deactivated'); continue; }
      if (!a.active) { await this.lockScreen(a.company.status === 'blocked' ? 'blocked' : 'expired'); continue; }
      return a;
    }
  },

  retryScreen(msg) {
    return new Promise(resolve => {
      const card = this.screen(`<div class="cl-err">${esc(nice(msg))}</div><p></p><div class="cl-row"><button class="cl-btn" id="clRetry">Try again</button><button class="cl-btn ghost" id="clOut">Sign out</button></div>`);
      q('#clRetry', card).onclick = () => resolve();
      q('#clOut', card).onclick = () => this.signOut();
    });
  },

  linkForm(a) {
    return new Promise(resolve => {
      const err = this.linkError ? `<div class="cl-err">${esc(nice(this.linkError))}</div>` : ''; this.linkError = '';
      const card = this.screen(`<p class="cl-big">Link your login to a company</p>
        ${a.is_owner ? `<div class="cl-ok">You are the software owner. <a class="cl-link" href="owner.html">Open the owner panel →</a></div><p></p>` : ''}
        <form class="cl-f" id="clJoin">${err}<label>Company code (from your administrator)<input name="code" required style="text-transform:uppercase;letter-spacing:2px"></label>
          <button class="cl-btn">Join company</button></form>
        <p class="cl-note" style="margin:16px 0 8px">or open a new company with a free trial:</p>
        <form class="cl-f" id="clNew"><label>Company name<input name="company" required></label><button class="cl-btn ghost">Start free trial</button></form>
        <p class="cl-note" style="margin-top:16px"><button class="cl-link" id="clOut">Sign out</button></p>`);
      const run = async (args, form) => {
        q('.cl-err', card)?.remove();
        try { await this.rpc('complete_signup', args); resolve(); }
        catch (e) { form.insertAdjacentHTML('afterbegin', `<div class="cl-err">${esc(nice(e.message))}</div>`); }
      };
      q('#clJoin', card).onsubmit = e => { e.preventDefault(); run({ p_code: e.target.code.value.trim().toUpperCase() }, e.target); };
      q('#clNew', card).onsubmit = e => { e.preventDefault(); run({ p_company_name: e.target.company.value.trim() }, e.target); };
      q('#clOut', card).onclick = () => this.signOut();
    });
  },

  lockScreen(kind) {
    const a = this.acct, c = a.company || {}, s = a.settings || {};
    const head = {
      expired: !c.access_until ? 'Your subscription is not active yet' : (!c.paid_until ? 'Your free trial has ended' : 'Your subscription has ended'),
      blocked: 'This company account is on hold',
      deactivated: 'Your login has been switched off'
    }[kind];
    const text = {
      expired: !c.access_until ? `The account for <b>${esc(c.name)}</b> is ready. It opens as soon as the first monthly payment is received.` : `Access for <b>${esc(c.name)}</b> ended on <b>${fdate(c.access_until)}</b>. Your data is safe — it will be available again as soon as the monthly payment is received.`,
      blocked: `Access for <b>${esc(c.name)}</b> has been paused. Please contact us to restore it. Your data is safe.`,
      deactivated: `Your company administrator has turned off your login for <b>${esc(c.name)}</b>. Ask them to switch it back on.`
    }[kind];
    return new Promise(resolve => {
      const card = this.screen(`<p class="cl-big">${head}</p><p>${text}</p>
        ${kind !== 'deactivated' ? `
          ${c.plan_name ? `<div class="cl-kv" style="margin:14px 0"><span>Plan</span><b>${esc(c.plan_name)} — Rs ${money(c.monthly_price)} / month</b><span>Users</span><b>up to ${c.max_users}</b></div>` : ''}
          ${s.payment_instructions ? `<p class="cl-note" style="margin:10px 0 6px"><b>How to pay</b></p><div class="cl-box">${esc(s.payment_instructions)}</div>` : ''}
          ${s.support_contact ? `<p class="cl-note" style="margin-top:10px">Contact: <b>${esc(s.support_contact)}</b></p>` : ''}` : ''}
        ${a.is_owner ? `<p><a class="cl-link" href="owner.html">Open the owner panel →</a></p>` : ''}
        <p></p><div class="cl-row"><button class="cl-btn" id="clChk">${kind === 'deactivated' ? 'Check again' : "I've paid — check again"}</button><button class="cl-btn ghost" id="clOut">Sign out</button></div>`, true);
      q('#clChk', card).onclick = () => resolve();
      q('#clOut', card).onclick = () => this.signOut();
    });
  },

  /* ---------------- data ---------------- */
  async loadData() {
    for (;;) {
      try {
        const r = await this.rpc('load_company_data');
        let d = r.data && Object.keys(r.data).length ? r.data : null;
        this.version = Number(r.version);
        this.base = d ? clone(d) : {};
        this.needsFirstSave = !d;
        if (!d) {
          const local = localStorage.getItem('majuErp.data.v1');
          if (local && this.acct.member.role === 'admin' && await this.importPrompt()) {
            try { d = JSON.parse(local); } catch (e) { d = null; }
          }
        }
        this.data = d;
        return;
      } catch (e) {
        if (/SUBSCRIPTION_INACTIVE/.test(e.message)) { await this.loadAccount(); continue; }
        await this.retryScreen(e.message);
      }
    }
  },

  importPrompt() {
    return new Promise(resolve => {
      const card = this.screen(`<p class="cl-big">Bring your existing data?</p>
        <p>This browser already has Maju ERP data saved offline. Do you want to move it into <b>${esc(this.acct.company.name)}</b> online, so your whole team can use it?</p>
        <div class="cl-row"><button class="cl-btn" id="clYes">Yes, move it online</button><button class="cl-btn ghost" id="clNo">No, start empty</button></div>`, true);
      q('#clYes', card).onclick = () => resolve(true);
      q('#clNo', card).onclick = () => resolve(false);
    });
  },

  queueSave() {
    if (!ON || !this.started) return;
    this.pending = true; this.setState('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 700);
  },

  async flush() {
    if (this.saving) { this.again = true; return; }
    if (!this.pending) return;
    clearTimeout(this.timer); clearTimeout(this.retryTimer);
    this.saving = true; this.pending = false; this.again = false; this.setState('saving');
    const snap = JSON.parse(JSON.stringify(DB.data));
    try {
      const v = Number(await this.rpc('save_company_data', { p_data: snap, p_version: this.version }));
      if (v === -1) {
        // someone else saved first: combine both sets of changes and save again
        const r = await this.rpc('load_company_data');
        const merged = merge(this.base, DB.data, r.data || {});
        applyInPlace(DB.data, merged);
        this.version = Number(r.version); this.base = clone(r.data || {});
        this.incoming = null; this.pending = true;
        if (typeof Ledger !== "undefined") Ledger.invalidate();
        window.toast && toast('Combined your changes with changes made by another user');
      } else {
        this.version = v; this.base = snap;
      }
      this.saving = false;
      if (this.pending || this.again) { this.pending = true; return this.flush(); }
      this.setState('saved');
    } catch (e) {
      this.saving = false; this.pending = true;
      if (/SUBSCRIPTION_INACTIVE/.test(e.message)) { this.setState('offline', 'Subscription ended — not saved'); this.subscriptionEnded(); return; }
      if (/not linked/i.test(e.message)) { this.setState('offline', 'Login switched off — not saved'); return; }
      this.setState('offline');
      this.retryTimer = setTimeout(() => this.flush(), 5000);
    }
  },

  subscriptionEnded() {
    if (this.endedShown) return; this.endedShown = true;
    if (window.modal) {
      modal('Subscription ended', `<p>Your company's access has ended, so recent changes could not be saved online. Please renew the subscription; then sign in again.</p>`,
        `<button class="btn primary" onclick="location.reload()">OK</button>`);
    }
  },

  async checkRemote() {
    if (this.saving || this.pending || document.hidden) return;
    try {
      const v = Number(await this.rpc('company_data_version'));
      if (v > this.version && !this.pending && !this.saving) {
        const r = await this.rpc('load_company_data');
        if (!this.pending && !this.saving && Number(r.version) > this.version) { this.incoming = r; this.setState('incoming'); }
      }
    } catch (e) {}
  },

  applyIncoming() {
    const r = this.incoming; if (!r || this.pending || this.saving) return false;
    applyInPlace(DB.data, clone(r.data));
    this.version = Number(r.version); this.base = clone(r.data); this.incoming = null;
    if (typeof Ledger !== "undefined") Ledger.invalidate();
    this.setState('saved');
    return true;
  },

  async refreshAccount() {
    try {
      const a = await this.rpc('my_account');
      if (a && a.member) { this.acct = a; this.renderBar(); if (!a.active || !a.member.active) this.subscriptionEnded(); }
    } catch (e) {}
  },

  bindSync() {
    // pick up other users' changes when moving to another screen (safe point — no form open)
    window.addEventListener('hashchange', () => { if (this.incoming) this.applyIncoming(); });
    setInterval(() => this.checkRemote(), 30000);
    setInterval(() => this.refreshAccount(), 5 * 60000);
    window.addEventListener('focus', () => this.checkRemote());
    window.addEventListener('online', () => { if (this.pending) this.flush(); });
    window.addEventListener('beforeunload', e => { if (this.pending || this.saving) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('click', e => { if (!e.target.closest('.cl-user')) q('.cl-user.open')?.classList.remove('open'); });
  },

  /* ---------------- top bar: save status, subscription, user menu ---------------- */
  setState(s, label) {
    this.state = s;
    const el = document.getElementById('clStatus'); if (!el) return;
    const t = { saved: '✓ Saved online', pending: 'Saving…', saving: 'Saving…', offline: '⚠ Offline — retrying', incoming: '↻ New changes — click to load' };
    el.className = 'cl-st ' + s; el.textContent = label || t[s];
    el.title = s === 'offline' ? 'Your changes are kept on this screen and will be saved when the connection is back. Do not close this tab.' : '';
  },

  barHtml() { return ON ? `<span id="cloudBar"></span>` : ''; },

  renderBar() {
    const bar = document.getElementById('cloudBar'); if (!bar || !this.acct) return;
    const a = this.acct, c = a.company, m = a.member;
    const days = a.days_left;
    const sub = c.on_trial ? `Trial · ${days} day${days === 1 ? '' : 's'} left` : (days <= 7 ? `Renews in ${days} day${days === 1 ? '' : 's'}` : '');
    const who = m.full_name || m.email || '';
    bar.innerHTML = `
      <span id="clStatus" class="cl-st"></span>
      ${sub ? `<a href="#/account" class="cl-sub ${days <= 5 ? 'warn' : ''}">${esc(sub)}</a>` : ''}
      <div class="cl-user"><button type="button"><span class="cl-av">${esc((who[0] || '?').toUpperCase())}</span>${esc(who.split(' ')[0].split('@')[0])}</button>
        <div class="cl-menu"><div class="hd"><b>${esc(who)}</b><small>${esc(m.email)} · ${m.role === 'admin' ? 'Administrator' : 'User'}</small><small>${esc(c.name)}</small></div>
          <a href="#/account">Users & Subscription</a>
          ${a.is_owner ? `<a href="owner.html">Owner panel</a>` : ''}
          <button type="button" data-cl="pw">Change password</button>
          <button type="button" data-cl="out">Sign out</button></div></div>`;
    q('.cl-user > button', bar).onclick = () => q('.cl-user', bar).classList.toggle('open');
    q('[data-cl="out"]', bar).onclick = () => this.signOut();
    q('[data-cl="pw"]', bar).onclick = () => this.changePassword();
    const st = q('#clStatus', bar);
    st.onclick = () => { if (this.state === 'incoming' && this.applyIncoming()) { navigate(); toast('Loaded the latest changes'); } };
    this.setState(this.state);
  },

  async signOut() {
    if (this.pending || this.saving) {
      if (this.pending && !this.saving) await this.flush();
      if (this.pending || this.saving) { if (!confirm('Some changes are not saved online yet. Sign out anyway?')) return; }
    }
    this.started = false;
    try { await this.sb.auth.signOut(); } catch (e) {}
    location.replace(HERE);
  },

  changePassword() {
    const m = modal('Change password', `<form id="clPw" class="grid2"><div class="fld" style="grid-column:1/-1"><label>New password</label><input name="p1" type="password" minlength="6" autocomplete="new-password" required></div>
      <div class="fld" style="grid-column:1/-1"><label>Repeat new password</label><input name="p2" type="password" minlength="6" autocomplete="new-password" required></div></form>`,
      `<button class="btn" data-close>Cancel</button><button class="btn primary" id="clPwSave">Save password</button>`);
    q('#clPwSave', m).onclick = async () => {
      const f = q('#clPw', m); const v = Object.fromEntries(new FormData(f));
      if (!v.p1 || v.p1.length < 6) return toast('Password must be at least 6 characters', 'err');
      if (v.p1 !== v.p2) return toast('The two passwords do not match', 'err');
      const { error } = await this.sb.auth.updateUser({ password: v.p1 });
      if (error) return toast(nice(error.message), 'err');
      closeModal(); toast('Password changed');
    };
  },

  /* ---------------- Users & Subscription page ---------------- */
  addAccountPage() {
    const set = (typeof NAV !== "undefined" ? NAV : []).find(n => n.label === 'Settings' && n.children);
    if (set && !set.children.some(c => c[1] === '#/account')) set.children.unshift(['Users & Subscription', '#/account']);
    route('/account', () => this.accountPage());
  },

  async accountPage() {
    page('Users & Subscription', `<div class="card pad"><p class="cl-note">Loading…</p></div>`, '', [['Settings', '#/settings/company']]);
    await this.refreshAccount();
    const a = this.acct, c = a.company, m = a.member, s = a.settings || {}, admin = m.role === 'admin';
    const [mem, pay] = await Promise.all([
      this.sb.from('company_members').select('user_id,email,full_name,role,active,created_at').order('created_at'),
      this.sb.from('payments').select('paid_on,amount,months,period_from,period_to,method,reference').order('paid_on', { ascending: false })
    ]);
    if (location.hash.split('?')[0] !== '#/account') return;
    const members = mem.data || [], payments = pay.data || [];
    const status = c.status === 'blocked' ? 'Blocked' : c.on_trial ? 'Trial' : a.days_left <= 7 ? 'Due soon' : 'Active';
    const joinUrl = (CFG.appUrl || HERE);
    page('Users & Subscription', `
      <div class="grid-2">
        <div class="card pad">
          <h3>Subscription</h3><p></p>
          <div class="cl-kv">
            <span>Company</span><b>${esc(c.name)}</b>
            <span>Status</span><b>${badge(status)}</b>
            <span>Plan</span><b>${esc(c.plan_name || c.plan_id)} — Rs ${money(c.monthly_price)} / month</b>
            ${c.on_trial ? `<span>Free trial ends</span><b>${fdate(c.trial_ends)}</b>` : `<span>Paid until</span><b>${fdate(c.paid_until)}</b>`}
            <span>Days left</span><b>${a.days_left}</b>
            <span>Users</span><b>${c.users} of ${c.max_users}</b>
          </div>
          ${s.payment_instructions ? `<p class="cl-note" style="margin:16px 0 6px"><b>How to pay the monthly subscription</b></p><div class="cl-box">${esc(s.payment_instructions)}</div>` : ''}
          ${s.support_contact ? `<p class="cl-note" style="margin-top:10px">Contact: <b>${esc(s.support_contact)}</b></p>` : ''}
        </div>
        <div class="card pad">
          <h3>Add staff</h3><p></p>
          ${admin ? `<p class="cl-note">Give your staff this company code. They open <b>${esc(joinUrl)}</b>, choose <b>Join company</b>, and create their own login.</p>
            <p><span class="cl-code" id="clCode">${esc(c.join_code)}</span></p>
            <div class="cl-row" style="max-width:360px"><button class="btn" id="clCopy">Copy invite message</button><button class="btn ghost" id="clNewCode">New code</button></div>
            <p class="cl-note" style="margin-top:10px">Making a new code stops the old one from working. Your plan allows ${c.max_users} users.</p>`
          : `<p class="cl-note">Only your company administrator can add or remove users.</p>`}
        </div>
      </div>
      <div class="card"><div class="pad"><h3>Users</h3></div>
        ${table([
          { label: 'Name', get: r => r.full_name || '—' },
          { label: 'Email', get: r => r.email },
          { label: 'Role', html: r => admin && r.user_id !== m.user_id ? `<select data-role="${r.user_id}"><option value="user" ${r.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${r.role === 'admin' ? 'selected' : ''}>Administrator</option></select>` : (r.role === 'admin' ? 'Administrator' : 'User') },
          { label: 'Status', html: r => badge(r.active ? 'Active' : 'Switched off') },
          { label: 'Since', get: r => fdate(r.created_at) },
          { label: '', cls: 'num', html: r => admin && r.user_id !== m.user_id ? `<button class="btn sm ${r.active ? 'danger ghost' : ''}" data-act="${r.user_id}">${r.active ? 'Switch off' : 'Switch on'}</button>` : (r.user_id === m.user_id ? '<small>you</small>' : '') }
        ], members)}</div>
      <div class="card"><div class="pad"><h3>Payment history</h3></div>
        ${table([
          { label: 'Paid on', get: r => fdate(r.paid_on) },
          { label: 'Amount (Rs)', cls: 'num', get: r => money(r.amount) },
          { label: 'Months', cls: 'num', get: r => r.months },
          { label: 'Period', get: r => `${fdate(r.period_from)} → ${fdate(r.period_to)}` },
          { label: 'Method', get: r => r.method || '' },
          { label: 'Reference', get: r => r.reference || '' }
        ], payments, { empty: 'No payments recorded yet.' })}</div>`, '', [['Settings', '#/settings/company']]);

    if (admin) {
      q('#clCopy').onclick = () => {
        const msg = `You are invited to use Maju ERP for ${c.name}.\n1. Open ${joinUrl}\n2. Choose "Join company"\n3. Enter company code: ${c.join_code}\n4. Create your login with your own email and password.`;
        (navigator.clipboard ? navigator.clipboard.writeText(msg) : Promise.reject()).then(() => toast('Invite message copied'), () => modal('Invite message', `<textarea rows="6" style="width:100%">${esc(msg)}</textarea>`));
      };
      q('#clNewCode').onclick = () => confirmBox('Make a new company code? The current code will stop working for new staff.', async () => {
        try { await this.rpc('admin_new_join_code'); toast('New code created'); this.accountPage(); } catch (e) { toast(nice(e.message), 'err'); }
      }, 'Make new code');
      const member = id => members.find(x => x.user_id === id);
      document.querySelectorAll('[data-role]').forEach(sel => sel.onchange = async () => {
        const r = member(sel.dataset.role);
        try { await this.rpc('admin_set_member', { p_user: r.user_id, p_role: sel.value, p_active: r.active }); toast('Role updated'); }
        catch (e) { toast(nice(e.message), 'err'); }
        this.accountPage();
      });
      document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
        const r = member(b.dataset.act);
        const doIt = async () => {
          try { await this.rpc('admin_set_member', { p_user: r.user_id, p_role: r.role, p_active: !r.active }); toast(r.active ? 'Login switched off' : 'Login switched on'); }
          catch (e) { toast(nice(e.message), 'err'); }
          this.accountPage();
        };
        r.active ? confirmBox(`Switch off the login for ${r.full_name || r.email}? They will not be able to use Maju ERP until you switch it back on.`, doIt, 'Switch off') : doIt();
      });
    }
  }
};

Cloud._merge = merge;          // exposed for testing
Cloud._applyInPlace = applyInPlace;
window.Cloud = Cloud;
})();
