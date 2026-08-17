CREATE OR REPLACE FUNCTION public.register_user(
    p_username text,
    p_password text,
    p_device_id text,
    p_fingerprint text,
    p_email text
)
RETURNS TABLE(id uuid, username text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    new_user_id uuid;
    v_ip text;
BEGIN
    IF p_device_id IS NULL OR length(trim(p_device_id)) = 0
       OR p_fingerprint IS NULL OR length(trim(p_fingerprint)) = 0 THEN
        RAISE EXCEPTION 'تعذر التحقق من الجهاز، حدّث الصفحة وحاول مجددًا';
    END IF;

    IF p_email IS NULL OR position('@' in p_email) = 0 THEN
        RAISE EXCEPTION 'يجب إدخال بريد إلكتروني صالح';
    END IF;

    -- استخراج IP الحقيقي للمستخدم من رؤوس الطلب (يمرره Supabase تلقائيًا)
    v_ip := NULLIF(split_part(
        coalesce((current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ''),
        ',', 1), '');

    -- منع إنشاء أكثر من حساب على نفس الجهاز / الشبكة
    IF EXISTS (
        SELECT 1 FROM device_links
        WHERE device_id = p_device_id
           OR fingerprint = p_fingerprint
           OR (v_ip IS NOT NULL AND ip_address = v_ip)
    ) THEN
        RAISE EXCEPTION 'لديك حساب مسبق على هذا الجهاز أو الشبكة';
    END IF;

    IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN
        RAISE EXCEPTION 'هذا البريد الإلكتروني مستخدم من قبل';
    END IF;

    INSERT INTO users(username, password_hash, email)
    VALUES (p_username, crypt(p_password, gen_salt('bf')), p_email)
    RETURNING users.id INTO new_user_id;

    INSERT INTO players(user_id, gold, has_character)
    VALUES (new_user_id, 1000, false);

    INSERT INTO device_links(device_id, fingerprint, ip_address, user_id)
    VALUES (p_device_id, p_fingerprint, v_ip, new_user_id);

    RETURN QUERY SELECT new_user_id, p_username;
END;
$function$;
