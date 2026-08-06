-- Rename reception_* tables to myaios_* to match code rename
-- This migration renames all reception tables and their RLS policies

-- 1. reception_config → myaios_config
ALTER TABLE IF EXISTS public.reception_config RENAME TO myaios_config;

-- 2. reception_services → myaios_services
ALTER TABLE IF EXISTS public.reception_services RENAME TO myaios_services;

-- 3. reception_bookings → myaios_bookings
ALTER TABLE IF EXISTS public.reception_bookings RENAME TO myaios_bookings;

-- 4. reception_leads → myaios_leads
ALTER TABLE IF EXISTS public.reception_leads RENAME TO myaios_leads;

-- 5. reception_escalations → myaios_escalations
ALTER TABLE IF EXISTS public.reception_escalations RENAME TO myaios_escalations;

-- 6. reception_events → myaios_events
ALTER TABLE IF EXISTS public.reception_events RENAME TO myaios_events;

-- 7. reception_staff_hours → myaios_staff_hours
ALTER TABLE IF EXISTS public.reception_staff_hours RENAME TO myaios_staff_hours;

-- Rename columns in myaios_config (reception_24_7 → myaios_24_7, reception_hours → myaios_hours)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'myaios_config' AND column_name = 'reception_24_7'
  ) THEN
    ALTER TABLE public.myaios_config RENAME COLUMN reception_24_7 TO myaios_24_7;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'myaios_config' AND column_name = 'reception_hours'
  ) THEN
    ALTER TABLE public.myaios_config RENAME COLUMN reception_hours TO myaios_hours;
  END IF;
END $$;

-- Rename RLS policies (drop old, create new with same logic)
-- myaios_config policies
DO $$
BEGIN
  -- Drop old policies if they exist
  DROP POLICY IF EXISTS "reception_config_owner_select" ON public.myaios_config;
  DROP POLICY IF EXISTS "reception_config_owner_update" ON public.myaios_config;
  DROP POLICY IF EXISTS "reception_config_owner_insert" ON public.myaios_config;
  DROP POLICY IF EXISTS "reception_config_service_role_all" ON public.myaios_config;

  -- Create new policies
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_config' AND schemaname = 'public') THEN
    CREATE POLICY "myaios_config_owner_select" ON public.myaios_config
      FOR SELECT USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_config_owner_update" ON public.myaios_config
      FOR UPDATE USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_config_owner_insert" ON public.myaios_config
      FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
  END IF;
END $$;

-- myaios_services policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "reception_services_owner_select" ON public.myaios_services;
  DROP POLICY IF EXISTS "reception_services_owner_update" ON public.myaios_services;
  DROP POLICY IF EXISTS "reception_services_owner_insert" ON public.myaios_services;
  DROP POLICY IF EXISTS "reception_services_owner_delete" ON public.myaios_services;
  DROP POLICY IF EXISTS "reception_services_service_role_all" ON public.myaios_services;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_services' AND schemaname = 'public') THEN
    CREATE POLICY "myaios_services_owner_select" ON public.myaios_services
      FOR SELECT USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_services_owner_insert" ON public.myaios_services
      FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_services_owner_update" ON public.myaios_services
      FOR UPDATE USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_services_owner_delete" ON public.myaios_services
      FOR DELETE USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
  END IF;
END $$;

-- myaios_bookings policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "reception_bookings_owner_select" ON public.myaios_bookings;
  DROP POLICY IF EXISTS "reception_bookings_owner_insert" ON public.myaios_bookings;
  DROP POLICY IF EXISTS "reception_bookings_owner_update" ON public.myaios_bookings;
  DROP POLICY IF EXISTS "reception_bookings_service_role_all" ON public.myaios_bookings;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_bookings' AND schemaname = 'public') THEN
    CREATE POLICY "myaios_bookings_owner_select" ON public.myaios_bookings
      FOR SELECT USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_bookings_owner_insert" ON public.myaios_bookings
      FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_bookings_owner_update" ON public.myaios_bookings
      FOR UPDATE USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
  END IF;
END $$;

-- myaios_leads policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "reception_leads_owner_select" ON public.myaios_leads;
  DROP POLICY IF EXISTS "reception_leads_owner_insert" ON public.myaios_leads;
  DROP POLICY IF EXISTS "reception_leads_owner_update" ON public.myaios_leads;
  DROP POLICY IF EXISTS "reception_leads_service_role_all" ON public.myaios_leads;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_leads' AND schemaname = 'public') THEN
    CREATE POLICY "myaios_leads_owner_select" ON public.myaios_leads
      FOR SELECT USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_leads_owner_insert" ON public.myaios_leads
      FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_leads_owner_update" ON public.myaios_leads
      FOR UPDATE USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
  END IF;
END $$;

-- myaios_escalations policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "reception_escalations_owner_select" ON public.myaios_escalations;
  DROP POLICY IF EXISTS "reception_escalations_owner_insert" ON public.myaios_escalations;
  DROP POLICY IF EXISTS "reception_escalations_owner_update" ON public.myaios_escalations;
  DROP POLICY IF EXISTS "reception_escalations_service_role_all" ON public.myaios_escalations;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_escalations' AND schemaname = 'public') THEN
    CREATE POLICY "myaios_escalations_owner_select" ON public.myaios_escalations
      FOR SELECT USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_escalations_owner_insert" ON public.myaios_escalations
      FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_escalations_owner_update" ON public.myaios_escalations
      FOR UPDATE USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
  END IF;
END $$;

-- myaios_events policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "reception_events_owner_select" ON public.myaios_events;
  DROP POLICY IF EXISTS "reception_events_owner_insert" ON public.myaios_events;
  DROP POLICY IF EXISTS "reception_events_service_role_all" ON public.myaios_events;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_events' AND schemaname = 'public') THEN
    CREATE POLICY "myaios_events_owner_select" ON public.myaios_events
      FOR SELECT USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_events_owner_insert" ON public.myaios_events
      FOR INSERT WITH CHECK (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
  END IF;
END $$;

-- myaios_staff_hours policies
DO $$
BEGIN
  DROP POLICY IF EXISTS "reception_staff_hours_owner_select" ON public.myaios_staff_hours;
  DROP POLICY IF EXISTS "reception_staff_hours_owner_update" ON public.myaios_staff_hours;
  DROP POLICY IF EXISTS "reception_staff_hours_service_role_all" ON public.myaios_staff_hours;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_staff_hours' AND schemaname = 'public') THEN
    CREATE POLICY "myaios_staff_hours_owner_select" ON public.myaios_staff_hours
      FOR SELECT USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
    CREATE POLICY "myaios_staff_hours_owner_update" ON public.myaios_staff_hours
      FOR UPDATE USING (auth.jwt() ->> 'sub' = owner_id OR auth.role() = 'service_role');
  END IF;
END $$;

-- Rename indexes (drop old, create new)
DO $$
BEGIN
  -- Drop old indexes if they exist
  EXECUTE 'DROP INDEX IF EXISTS public.reception_config_owner_id_idx';
  EXECUTE 'DROP INDEX IF EXISTS public.reception_services_owner_id_idx';
  EXECUTE 'DROP INDEX IF EXISTS public.reception_bookings_owner_id_idx';
  EXECUTE 'DROP INDEX IF EXISTS public.reception_bookings_customer_email_idx';
  EXECUTE 'DROP INDEX IF EXISTS public.reception_leads_owner_id_idx';
  EXECUTE 'DROP INDEX IF EXISTS public.reception_escalations_owner_id_idx';
  EXECUTE 'DROP INDEX IF EXISTS public.reception_events_owner_id_idx';
  EXECUTE 'DROP INDEX IF EXISTS public.reception_staff_hours_owner_id_idx';

  -- Create new indexes
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_config') THEN
    CREATE INDEX IF NOT EXISTS myaios_config_owner_id_idx ON public.myaios_config (owner_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_services') THEN
    CREATE INDEX IF NOT EXISTS myaios_services_owner_id_idx ON public.myaios_services (owner_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_bookings') THEN
    CREATE INDEX IF NOT EXISTS myaios_bookings_owner_id_idx ON public.myaios_bookings (owner_id);
    CREATE INDEX IF NOT EXISTS myaios_bookings_customer_email_idx ON public.myaios_bookings (customer_email);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_leads') THEN
    CREATE INDEX IF NOT EXISTS myaios_leads_owner_id_idx ON public.myaios_leads (owner_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_escalations') THEN
    CREATE INDEX IF NOT EXISTS myaios_escalations_owner_id_idx ON public.myaios_escalations (owner_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_events') THEN
    CREATE INDEX IF NOT EXISTS myaios_events_owner_id_idx ON public.myaios_events (owner_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'myaios_staff_hours') THEN
    CREATE INDEX IF NOT EXISTS myaios_staff_hours_owner_id_idx ON public.myaios_staff_hours (owner_id);
  END IF;
END $$;
