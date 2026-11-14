-- =====================================================================
--  Maju ERP — cloud database setup (Supabase)
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  It is safe to run again later (it only adds what is missing and
--  refreshes the functions).
--
--  BEFORE RUNNING: change the owner email on the line marked  <<< OWNER
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------

-- Subscription plans you sell (price per month, users allowed)
create table if not exists public.plans (
  id            text primary key,
  name          text not null,
  monthly_price numeric not null default 0,
  max_users     int not null default 3,
  active        boolean not null default true,
  sort          int not null default 0
);

insert into public.plans (id, name, monthly_price, max_users, sort) values
  ('basic',    'Basic',     5000,  3, 1),
  ('standard', 'Standard', 10000, 10, 2),
  ('premium',  'Premium',  20000, 50, 3)
on conflict (id) do nothing;

-- Customer companies (your subscribers)
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text,
  phone       text,
  email       text,
  plan_id     text references public.plans(id) default 'basic',
  max_users   int  not null default 3,
  status      text not null default 'active' check (status in ('active', 'blocked')),
  trial_ends  date,
  paid_until  date,
  join_code   text unique not null default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  admin_code  text unique not null default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  notes       text,
  created_at  timestamptz not null default now()
);

-- Users (logins) belonging to a company
create table if not exists public.company_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'user' check (role in ('admin', 'user')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists company_members_company_idx on public.company_members(company_id);

-- Each company's ERP data (the same data the app used to keep in the browser)
create table if not exists public.company_data (
  company_id uuid primary key references public.companies(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  version    bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Monthly payments you receive (bank transfer, JazzCash, Easypaisa, cash …)
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  amount      numeric not null,
  months      int not null default 1 check (months between 1 and 36),
  method      text,
  reference   text,
  paid_on     date not null default current_date,
  period_from date,
  period_to   date,
  created_at  timestamptz not null default now()
);
create index if not exists payments_company_idx on public.payments(company_id);

-- Software owner(s) — the people who can open owner.html
create table if not exists public.platform_admins (
  email text primary key
);

insert into public.platform_admins (email)
values (lower('mmuaz08303@gmail.com'))              -- <<< OWNER email
on conflict do nothing;

-- One-row settings shown to customers
create table if not exists public.platform_settings (
  id                   int primary key default 1 check (id = 1),
  trial_days           int  not null default 14,
  allow_self_signup    boolean not null default true,
  payment_instructions text,
  support_contact      text
);
insert into public.platform_settings (id, payment_instructions, support_contact) values
  (1, 'Pay your monthly subscription by bank transfer, JazzCash or Easypaisa, then send the receipt on WhatsApp. Your access is extended as soon as the payment is confirmed.', '')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
--  Helper functions
-- ---------------------------------------------------------------------

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins
                 where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from company_members where user_id = auth.uid() and active;
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from company_members where user_id = auth.uid() and active;
$$;

-- Last day the company may use the software (trial or paid, whichever is later)
create or replace function public.access_until(c public.companies) returns date
language sql immutable as $$
  select nullif(greatest(coalesce(c.paid_until, date '1900-01-01'),
                         coalesce(c.trial_ends, date '1900-01-01')), date '1900-01-01');
$$;

create or replace function public.company_is_active(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies c
                 where c.id = cid and c.status = 'active'
                   and public.access_until(c) >= current_date);
$$;

-- ---------------------------------------------------------------------
--  Row level security (who may see what)
-- ---------------------------------------------------------------------

alter table public.plans             enable row level security;
alter table public.companies         enable row level security;
alter table public.company_members   enable row level security;
alter table public.company_data      enable row level security;
alter table public.payments          enable row level security;
alter table public.platform_admins   enable row level security;
alter table public.platform_settings enable row level security;

drop policy if exists plans_read  on public.plans;
drop policy if exists plans_owner on public.plans;
create policy plans_read  on public.plans for select to anon, authenticated using (true);
create policy plans_owner on public.plans for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists companies_read  on public.companies;
drop policy if exists companies_owner on public.companies;
create policy companies_read  on public.companies for select to authenticated using (id = public.my_company() or public.is_owner());
create policy companies_owner on public.companies for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists members_read  on public.company_members;
drop policy if exists members_owner on public.company_members;
create policy members_read  on public.company_members for select to authenticated using (company_id = public.my_company() or public.is_owner());
create policy members_owner on public.company_members for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists data_read on public.company_data;
create policy data_read on public.company_data for select to authenticated
  using ((company_id = public.my_company() and public.company_is_active(company_id)) or public.is_owner());
-- Writes to company_data only go through save_company_data() below.

drop policy if exists payments_read  on public.payments;
drop policy if exists payments_owner on public.payments;
create policy payments_read  on public.payments for select to authenticated using (company_id = public.my_company() or public.is_owner());
create policy payments_owner on public.payments for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists admins_owner on public.platform_admins;
create policy admins_owner on public.platform_admins for select to authenticated using (public.is_owner());

drop policy if exists settings_read  on public.platform_settings;
drop policy if exists settings_owner on public.platform_settings;
create policy settings_read  on public.platform_settings for select to anon, authenticated using (true);
create policy settings_owner on public.platform_settings for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Table permissions (explicit, so it works even where Supabase does not grant them by default)
grant usage on schema public to anon, authenticated;
grant select on public.plans, public.platform_settings to anon, authenticated;
grant insert, update on public.plans to authenticated;
grant update on public.platform_settings to authenticated;
grant update on public.companies to authenticated;
grant select on public.company_members, public.company_data, public.payments, public.platform_admins to authenticated;
revoke insert, update, delete on public.company_data, public.company_members, public.payments from anon, authenticated;
revoke all on public.companies, public.company_members, public.company_data, public.payments, public.platform_admins from anon;

-- The join/admin codes must never be readable by ordinary users through the table
revoke select on public.companies from authenticated, anon;
grant  select (id, name, contact, phone, email, plan_id, max_users, status, trial_ends, paid_until, notes, created_at)
  on public.companies to authenticated;

-- ---------------------------------------------------------------------
--  Functions the app calls
-- ---------------------------------------------------------------------

-- Everything the app needs to know about the signed-in user
create or replace function public.my_account() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m company_members; c companies; p plans; s platform_settings; n int; until date;
begin
  select * into s from platform_settings where id = 1;
  select * into m from company_members where user_id = auth.uid();
  if not found then
    return jsonb_build_object('member', null, 'is_owner', public.is_owner(),
      'settings', jsonb_build_object('payment_instructions', s.payment_instructions, 'support_contact', s.support_contact));
  end if;
  select * into c from companies where id = m.company_id;
  select * into p from plans where id = c.plan_id;
  select count(*) into n from company_members where company_id = c.id and active;
  until := public.access_until(c);
  return jsonb_build_object(
    'member',  jsonb_build_object('user_id', m.user_id, 'email', m.email, 'full_name', m.full_name, 'role', m.role, 'active', m.active),
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'plan_id', c.plan_id,
                 'plan_name', p.name, 'monthly_price', p.monthly_price, 'max_users', c.max_users,
                 'trial_ends', c.trial_ends, 'paid_until', c.paid_until, 'access_until', until,
                 'on_trial', (c.paid_until is null or c.paid_until < current_date) and c.trial_ends >= current_date,
                 'join_code',  case when m.role = 'admin' then c.join_code end,
                 'users', n),
    'active',    m.active and c.status = 'active' and until >= current_date,
    'days_left', case when until is null then -1 else until - current_date end,
    'is_owner',  public.is_owner(),
    'settings',  jsonb_build_object('payment_instructions', s.payment_instructions, 'support_contact', s.support_contact)
  );
end $$;

-- Finish sign-up: start a new company on trial, or join one with a code.
-- Values not passed are taken from what was typed on the sign-up form.
create or replace function public.complete_signup(p_company_name text default null, p_code text default null, p_full_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare meta jsonb; uemail text; cname text; code text; fname text; c companies; s platform_settings; n int; r text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from company_members where user_id = auth.uid()) then return public.my_account(); end if;

  select raw_user_meta_data, email into meta, uemail from auth.users where id = auth.uid();
  cname := nullif(trim(coalesce(p_company_name, meta ->> 'company_name')), '');
  code  := nullif(upper(trim(coalesce(p_code, meta ->> 'join_code'))), '');
  fname := nullif(trim(coalesce(p_full_name, meta ->> 'full_name')), '');
  select * into s from platform_settings where id = 1;

  if code is not null then
    select * into c from companies where join_code = code;
    if found then r := 'user';
    else
      select * into c from companies where admin_code = code;
      if not found then raise exception 'That company code is not valid'; end if;
      r := 'admin';
    end if;
    select count(*) into n from company_members where company_id = c.id and active;
    if n >= c.max_users then raise exception 'This company has reached its user limit (%). Ask your administrator to upgrade the plan.', c.max_users; end if;
    insert into company_members (user_id, company_id, email, full_name, role) values (auth.uid(), c.id, uemail, fname, r);
    insert into company_data (company_id) values (c.id) on conflict do nothing;
    return public.my_account();
  end if;

  if cname is not null then
    if not s.allow_self_signup then raise exception 'New sign-ups are closed. Please contact us to open an account.'; end if;
    insert into companies (name, contact, email, plan_id, max_users, trial_ends)
      values (cname, fname, uemail, 'basic', (select max_users from plans where id = 'basic'), current_date + s.trial_days)
      returning * into c;
    insert into company_members (user_id, company_id, email, full_name, role) values (auth.uid(), c.id, uemail, fname, 'admin');
    insert into company_data (company_id) values (c.id);
    return public.my_account();
  end if;

  return public.my_account();
end $$;

-- Load the company's ERP data
create or replace function public.load_company_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public.my_company(); d company_data;
begin
  if cid is null then raise exception 'Your login is not linked to a company'; end if;
  if not public.company_is_active(cid) then raise exception 'SUBSCRIPTION_INACTIVE'; end if;
  select * into d from company_data where company_id = cid;
  return jsonb_build_object('data', coalesce(d.data, '{}'::jsonb), 'version', coalesce(d.version, 0));
end $$;

create or replace function public.company_data_version() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select version from company_data where company_id = public.my_company()), 0);
$$;

-- Save the company's ERP data. Returns the new version, or -1 if someone
-- else saved first (the app then merges both sets of changes and retries).
create or replace function public.save_company_data(p_data jsonb, p_version bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_company(); v bigint;
begin
  if cid is null then raise exception 'Your login is not linked to a company'; end if;
  if not public.company_is_active(cid) then raise exception 'SUBSCRIPTION_INACTIVE'; end if;
  insert into company_data (company_id) values (cid) on conflict do nothing;
  update company_data set data = p_data, version = version + 1, updated_at = now(), updated_by = auth.uid()
   where company_id = cid and version = p_version
   returning version into v;
  return coalesce(v, -1);
end $$;

-- Company administrator: manage their own users
create or replace function public.admin_set_member(p_user uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cid uuid := public.my_company(); n int; mx int;
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Only the company administrator can change users'; end if;
  if not exists (select 1 from company_members where user_id = p_user and company_id = cid) then raise exception 'User not found'; end if;
  if p_role not in ('admin', 'user') then raise exception 'Invalid role'; end if;
  if p_user = auth.uid() and (p_role <> 'admin' or not p_active) then raise exception 'You cannot remove your own administrator access'; end if;
  if p_active and not (select active from company_members where user_id = p_user) then
    select count(*) into n from company_members where company_id = cid and active;
    select max_users into mx from companies where id = cid;
    if n >= mx then raise exception 'Your plan allows % users. Upgrade to add more.', mx; end if;
  end if;
  update company_members set role = p_role, active = p_active where user_id = p_user;
end $$;

create or replace function public.admin_new_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare code text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Only the company administrator can do this'; end if;
  update companies set join_code = code where id = public.my_company();
  return code;
end $$;

-- Owner: list every company with its codes, users and access dates
create or replace function public.owner_companies() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Owner only'; end if;
  return query
    select to_jsonb(c) || jsonb_build_object(
      'access_until', public.access_until(c),
      'active', c.status = 'active' and public.access_until(c) >= current_date,
      'days_left', public.access_until(c) - current_date,
      'users', (select count(*) from company_members m where m.company_id = c.id and m.active),
      'last_payment', (select max(paid_on) from payments p where p.company_id = c.id),
      'total_paid', (select coalesce(sum(amount), 0) from payments p where p.company_id = c.id),
      'data_updated', (select updated_at from company_data d where d.company_id = c.id))
    from companies c order by c.created_at desc;
end $$;

-- Owner: open a company account yourself (you then send them the admin code)
create or replace function public.owner_create_company(p_name text, p_contact text, p_phone text, p_email text,
                                                       p_plan text, p_trial_days int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c companies;
begin
  if not public.is_owner() then raise exception 'Owner only'; end if;
  insert into companies (name, contact, phone, email, plan_id, max_users, trial_ends)
    values (p_name, p_contact, p_phone, p_email, p_plan, (select max_users from plans where id = p_plan),
            case when coalesce(p_trial_days, 0) > 0 then current_date + p_trial_days end)
    returning * into c;
  insert into company_data (company_id) values (c.id);
  return to_jsonb(c);
end $$;

-- Owner: record a monthly payment and extend access
create or replace function public.owner_record_payment(p_company uuid, p_amount numeric, p_months int,
                                                       p_method text, p_reference text, p_paid_on date default current_date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c companies; f date; t date;
begin
  if not public.is_owner() then raise exception 'Owner only'; end if;
  select * into c from companies where id = p_company for update;
  if not found then raise exception 'Company not found'; end if;
  f := greatest(coalesce(c.paid_until + 1, current_date), current_date);
  t := (f + make_interval(months => p_months))::date - 1;
  insert into payments (company_id, amount, months, method, reference, paid_on, period_from, period_to)
    values (p_company, p_amount, p_months, p_method, p_reference, coalesce(p_paid_on, current_date), f, t);
  update companies set paid_until = t, status = 'active' where id = p_company;
  return jsonb_build_object('period_from', f, 'period_to', t);
end $$;

create or replace function public.owner_new_codes(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Owner only'; end if;
  update companies set join_code  = upper(substr(md5(gen_random_uuid()::text), 1, 8)),
                       admin_code = upper(substr(md5(gen_random_uuid()::text), 1, 8))
   where id = p_company;
end $$;

-- Who may call what
revoke all on function public.owner_companies()                                             from public, anon;
revoke all on function public.owner_create_company(text, text, text, text, text, int)       from public, anon;
revoke all on function public.owner_record_payment(uuid, numeric, int, text, text, date)    from public, anon;
revoke all on function public.owner_new_codes(uuid)                                         from public, anon;
revoke all on function public.save_company_data(jsonb, bigint)                              from public, anon;
revoke all on function public.load_company_data()                                           from public, anon;
revoke all on function public.complete_signup(text, text, text)                             from public, anon;
revoke all on function public.admin_set_member(uuid, text, boolean)                         from public, anon;
revoke all on function public.admin_new_join_code()                                         from public, anon;
grant execute on function public.owner_companies()                                          to authenticated;
grant execute on function public.owner_create_company(text, text, text, text, text, int)    to authenticated;
grant execute on function public.owner_record_payment(uuid, numeric, int, text, text, date) to authenticated;
grant execute on function public.owner_new_codes(uuid)                                      to authenticated;
grant execute on function public.save_company_data(jsonb, bigint)                           to authenticated;
grant execute on function public.load_company_data()                                        to authenticated;
grant execute on function public.complete_signup(text, text, text)                          to authenticated;
grant execute on function public.admin_set_member(uuid, text, boolean)                      to authenticated;
grant execute on function public.admin_new_join_code()                                      to authenticated;
grant execute on function public.my_account()                                               to authenticated;
grant execute on function public.company_data_version()                                     to authenticated;
grant execute on function public.is_owner()                                                to authenticated;
