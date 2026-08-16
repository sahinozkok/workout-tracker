# Set Gunlugu — Workout Tracker

A cross-platform workout planning and progress-tracking application built with React Native, Expo, TypeScript, and Supabase. It combines structured workout programming, live session tracking, discipline analytics, persistent profiles, and a Gemini-powered conversational AI coach.

> This project is under active development and is being built as a production-minded portfolio project.

## Highlights

- Email and password authentication with persistent Supabase sessions
- Email confirmation and password-recovery flows with environment-aware redirects
- Multi-day workout programs with one active program driving the schedule
- Exercise library, custom exercises, and bulk exercise selection
- Long-press drag-and-drop exercise ordering
- Editable sets, rep ranges, rest periods, icons, emojis, and images
- Start, pause, resume, and finish workout sessions
- Persistent workout timer and rest timer with overtime tracking
- Local rest notifications after completed sets
- Weekly, monthly, and yearly discipline calendar
- Completed, partial, skipped, and scheduled rest-day states
- Workout history, set details, duration, volume, and exercise progress
- Turkish and English interface localization
- Light, dark, and system theme preferences
- Persistent profile avatars and banners, including animated GIF support
- Friend discovery, requests, private friend profiles, and shared discipline calendars
- Conversational AI coach grounded in verified Supabase workout data
- AI weekly summaries and exercise progress analysis
- Rosa, a persistent interactive mascot with contextual messages, reactions, sleep, and edge-peek animations

## Tech Stack

| Area | Technology |
| --- | --- |
| Mobile and web | React Native, Expo, React Native Web |
| Language | TypeScript |
| Navigation | Expo Router |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Media | Supabase Storage, Expo Image, Expo Image Picker |
| Server logic | Supabase Edge Functions |
| AI | Google Gemini API |
| Local persistence | AsyncStorage |
| Notifications | Expo Notifications |
| Animation and gestures | React Native Reanimated, React Native Gesture Handler |

## Architecture

```text
Expo application
    |
    +-- Supabase Auth
    +-- PostgreSQL + Row Level Security
    +-- Supabase Storage (avatars and profile banners)
    +-- Security-definer RPCs (friend requests and limited discipline sharing)
    +-- Supabase Edge Function: workout-coach
            |
            +-- Validates the authenticated user
            +-- Reads verified workout data
            +-- Applies usage limits
            +-- Calls the Gemini API
            +-- Validates and persists the response
```

The Gemini API key is never included in the Expo application. AI requests are sent through an authenticated Supabase Edge Function.

Friend profiles expose only the profile fields and discipline statuses required by the feature. Private programs, workout sets, notes, and AI conversations are not shared with friends.

## Getting Started

### Prerequisites

- Node.js LTS
- npm
- Expo Go on a physical device, or an iOS/Android simulator
- A Supabase project

### Installation

```bash
git clone https://github.com/sahinozkok/workout-tracker.git
cd workout-tracker
npm install
cp .env.example .env
```

Add your public Supabase project values to `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
EXPO_PUBLIC_AI_PROVIDER=mock
```

Start Expo with a clean development cache:

```bash
npx expo start -c
```

Use the QR code with Expo Go, or press `w`, `i`, or `a` to open the web, iOS, or Android target.

## Supabase Setup

Database migrations are stored in [`supabase/migrations`](./supabase/migrations) and must be applied in filename order. They create the workout schema, Row Level Security policies, AI usage records, persistent coach chat, profile localization fields, and the profile media bucket.

See [`supabase/README.md`](./supabase/README.md) for the complete database, Storage, and Edge Function setup.

## AI Coach

The application supports a mock provider for local UI development and Gemini for real responses.

For Gemini:

1. Create a Gemini API key in Google AI Studio.
2. Store it as `GEMINI_API_KEY` in Supabase Edge Function secrets.
3. Optionally configure `GEMINI_CHAT_MODELS`, `AI_DAILY_LIMIT`, and `SUMMARY_DAILY_LIMIT`.
4. Deploy `supabase/functions/workout-coach/index.ts` as `workout-coach`.
5. Set `EXPO_PUBLIC_AI_PROVIDER=gemini` in the local `.env` file.

The coach calculates metrics on the server. Weekly and exercise summaries use deterministic templates without calling Gemini; conversational questions and program reviews use the configured model fallback list. The mobile client cannot provide trusted workout totals directly.

## Social and Discipline Sharing

Users can search for other profiles, send or respond to friend requests, remove friends, and open accepted friends' profiles. A dedicated synchronized table shares only bounded discipline-calendar statuses with accepted friends. Friendship mutations run through authenticated PostgreSQL functions instead of direct client table writes.

Direct messaging is intentionally outside the current release scope.

## Rosa Mascot

Rosa is a navigation-level interactive mascot that can move between screen edges without blocking the application interface. Her state system responds to completed sets and workouts, AI activity, inactivity, sleep, taps, and the current screen. Mascot preferences and position are user-scoped.

## Security

- Row Level Security is enabled for user-owned tables.
- Users can only read and modify their own private workout data.
- Friendship changes are validated by authenticated database functions.
- Accepted friends can read only bounded shared discipline statuses and public profile fields.
- Storage policies restrict uploads and deletion to each user's own folder.
- The public Expo application only receives the Supabase publishable key.
- Gemini and Supabase privileged keys stay in server-side secrets.
- AI messages use idempotency keys to prevent duplicate replies.
- AI output is validated before it is returned or stored.

## Quality Checks

```bash
npx tsc --noEmit
npm run lint
git diff --check
```

## Project Structure

```text
app/                    Expo Router screens
components/             Reusable interface components
constants/              Theme, icon, and schedule constants
context/                Auth, workout, profile, language, and theme state
data/                   Exercise catalog
hooks/                  Shared React hooks
locales/                Turkish and English translations
services/               Supabase, AI, and profile media services
supabase/functions/     Authenticated server-side functions
supabase/migrations/    Database and Storage migrations
types/                  Shared TypeScript models
utils/                  Analytics, scheduling, timers, and formatting
```

## Current Status

The primary workout flow, Supabase persistence, profile media, localization, discipline tracking, workout history, rest timers, friend connections, password recovery, Rosa, and the AI coach are functional. The project is not yet an App Store release. Upcoming work includes broader automated testing, offline workout synchronization, accessibility review, social messaging, and release preparation.

## Disclaimer

The AI coach provides general workout-data explanations and is not a medical professional. It does not diagnose injuries or replace qualified medical or training advice.
