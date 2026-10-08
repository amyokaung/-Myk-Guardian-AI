# Myk Guardian AI

A futuristic Burmese-first Android personal AI agent built with Vite, TypeScript and Capacitor, using a user-supplied OpenRouter API key.

## Safety design
- Android permissions are requested only when the user enables a feature.
- AI proposes actions; native actions are allowlisted and require explicit confirmation for sensitive operations.
- API keys are never committed to the repository. This starter stores the key locally in the app; use a native encrypted-storage plugin before public release.
- Android does not allow apps to control every phone capability. Capabilities depend on Android version, permission grants, and platform restrictions.

## Build
1. Install Node.js 20+ and Java 17.
2. `npm install`
3. `npm run build`
4. `npx cap add android` (first setup only)
5. `npx cap sync android`
6. Open `android/` in Android Studio or build with Gradle.

GitHub Actions workflow is provided to build a debug APK. Never commit real API keys or signing secrets.