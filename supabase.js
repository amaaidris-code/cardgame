const SUPABASE_URL = "https://cbjphdhoabktsplcxvxu.supabase.co"

const SUPABASE_KEY = "sb_publishable_4oYHTkdDYeZt-z6rEvEdQQ_6noHjNZk"

// WARNING: This file uses a publishable API key. Always ensure Row Level Security (RLS) 
// is properly configured and enabled on all database tables to prevent unauthorized data access.

// persistSession/autoRefreshToken = false: جلسة Supabase Auth تُستخدم فقط للحظات
// إرسال/التحقق من رمز OTP. لا نحفظها بين إعادة التحميل ولا نجددها تلقائيًا، فتظل
// كل دعوات RPC تسرق رمز anon (صلاحيته ~10 سنوات) بدل رمز جلسة انتهى بعد ~ساعتين
// فيُعيد المتصفح 401 وتفرغ لوحة الإدارة. كل مصادقة التطبيق تعتمد على
// admin_token / player_token المخصصة، وليس على جلسة Supabase Auth.
const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);