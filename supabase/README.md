# Supabase Setup

This directory contains the PostgreSQL migrations and Edge Function source used by the workout tracker.

## Database Migrations

Migration files in `migrations/` are the versioned history of the database schema and security policies. Apply them in filename order and do not edit a migration after it has been applied remotely.

### Apply migrations through the Dashboard

1. Open the project in the Supabase Dashboard.
2. Select **SQL Editor** from the left sidebar.
3. Create a **New query**.
4. Copy the complete contents of the next migration file into the editor.
5. Select **Run**.
6. Confirm that the query succeeds before continuing to the next migration.

The migrations currently cover:

- Core profile, program, workout, set, and discipline tables
- Active-program schedule tracking
- Profile avatar and banner Storage
- AI request usage records
- Persistent AI coach messages
- Turkish and English profile language preferences
- Animated GIF media support and a 20 MB profile-media limit

## Storage

Profile avatars and banners are stored in the public `avatars` bucket. Public reads allow profile media to render across devices, while authenticated write policies restrict each user to these paths:

```text
<user-id>/avatar/<unique-file-name>
<user-id>/banner/<unique-file-name>
```

The application supports JPEG, PNG, WebP, GIF, HEIC, and HEIF files up to 20 MB. The project-wide Supabase Storage limit must also be at least 20 MB.

## Row Level Security

Row Level Security is enabled on user-owned application tables. The anonymous role does not receive direct table access, and authenticated users can only access their own private records.

Never place a `service_role` key or database password in the Expo `.env` file. Only the publishable Supabase key belongs in the client application.

## Gemini AI Coach

The Gemini API key is stored only in Supabase Edge Function secrets:

```text
GEMINI_API_KEY=your-google-ai-studio-key
GEMINI_MODEL=your-supported-gemini-model
AI_DAILY_LIMIT=10
```

`GEMINI_MODEL` and `AI_DAILY_LIMIT` are optional. The function uses its configured defaults when they are omitted.

### Deploy through the Dashboard

1. Open **Edge Functions** in the Supabase Dashboard.
2. Select the `workout-coach` function.
3. Open its **Code** editor.
4. Replace the deployed source with `functions/workout-coach/index.ts`.
5. Select **Deploy updates**.

### Deploy with the CLI

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy workout-coach
```

After deployment, enable the real provider in the Expo `.env` file:

```text
EXPO_PUBLIC_AI_PROVIDER=gemini
```

Restart Expo with `npx expo start -c` after changing environment variables.

## AI Security Model

- The Edge Function requires an authenticated user.
- Workout metrics are recalculated from the user's Supabase records.
- Client-provided totals are not trusted.
- Structured model responses are validated before use.
- Successful requests are recorded for daily usage limits.
- Conversation messages are linked with idempotency identifiers to prevent duplicate replies.
- The AI is instructed not to diagnose injuries or provide medical treatment.
