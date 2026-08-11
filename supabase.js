const SUPABASE_URL = "https://cbjphdhoabktsplcxvxu.supabase.co"

const SUPABASE_KEY = "sb_publishable_4oYHTkdDYeZt-z6rEvEdQQ_6noHjNZk"

// WARNING: This file uses a publishable API key. Always ensure Row Level Security (RLS) 
// is properly configured and enabled on all database tables to prevent unauthorized data access.

const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);