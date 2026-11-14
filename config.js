/* Maju ERP — online settings
   Paste the two values from Supabase → Project Settings → API.
   (The "anon public" key is meant to be public; your data is protected
   by the security rules in supabase/setup.sql.)
   Leave the placeholders as they are to use Maju ERP offline,
   with data saved only in this browser. */
window.MAJU_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-PUBLIC-KEY',
  appUrl: 'https://mmuazch.github.io/maju-erp/'
};
