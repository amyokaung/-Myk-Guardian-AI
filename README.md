# AMARA AI (အမရာ)

A personal, Burmese-first Android AI companion and Guardian for its owner. Built with Vite, TypeScript and Capacitor, using a user-supplied OpenRouter or Gemini API key.

## Character
AMARA (အမရာ) is designed as a warm, thoughtful Burmese-speaking companion, practical technical partner, and careful phone assistant. The persona prompt lives in `src/amara-persona.ts`. It encourages honest capability reporting, action-result verification, and privacy-first handling of personal context.

## Safety and privacy
- Android permissions are requested only when the user enables a feature.
- AI proposes actions; native actions are allowlisted and require explicit confirmation for sensitive operations.
- API keys are never committed to the repository. This starter stores the key locally in the app; use native encrypted storage before public release.
- Personal memory is not embedded in this persona prompt. Keep private memory files out of the public repository and send only the minimum relevant context to external models.
- Android does not allow apps to control every phone capability. Capabilities depend on Android version, permission grants, and platform restrictions.

## Build
1. Install Node.js 20+ and Java 17.
2. `npm install`
3. `npm run build`
4. `npx cap sync android`
5. Open `android/` in Android Studio or build with Gradle.

GitHub Actions workflow is provided to build a debug APK. Never commit real API keys or signing secrets.

## Android app ID compatibility
The existing application ID `com.myk.guardianai` is intentionally unchanged in this branding update so a future update can retain the existing Android app identity and local app data. The visible app name is now AMARA AI.
