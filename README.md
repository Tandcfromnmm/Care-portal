# Safe Route — Phase 1.5 Communication

## Files
- `index.html`
- `css/style.css`
- `js/config.js`
- `js/app.js`
- `supabase_setup.sql`

## Features
- Leaflet/OpenStreetMap map
- GPS
- Route advisory
- Nearby metro, bus, fuel, ATM
- India emergency buttons
- Supabase email/password authentication
- Real-time text chat
- Voice-message recording/upload/playback
- Location sharing through chat
- WebRTC voice-call signalling and audio

## Supabase setup
1. Create a Supabase project.
2. Open SQL Editor and run `supabase_setup.sql`.
3. Create a Storage bucket called `voice-messages`.
4. Copy `js/config.js` and replace the URL and public anon/publishable key.
5. Never put the `service_role`/secret key in this website.
6. In Supabase Auth settings, configure email confirmation according to your needs.
7. Upload the project to GitHub Pages.

## Important
The communication features require Supabase. The browser directly connects to Supabase using the public key and RLS policies. Review and harden the storage policies before public production use.

Voice calls use WebRTC with a public STUN server for discovery. Production deployments should consider TURN infrastructure for networks where peer-to-peer connectivity fails.

Public OpenStreetMap/Nominatim/OSRM/Overpass services have usage policies and limits. For a high-traffic public service, use an appropriate hosted routing/geocoding/places backend and caching.

Emergency numbers are configured for India: Police 112, Ambulance 108, Fire 101, Unified 112. Verify local requirements before deploying elsewhere.
