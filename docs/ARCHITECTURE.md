# Myk Guardian AI — Architecture

## Runtime boundaries

- **Web UI**: TypeScript/Vite interface, chat rendering, settings and user confirmations.
- **Agent orchestration**: interprets provider tool calls, validates action names and reports actual native results.
- **Native bridge**: the only web-to-Android boundary. It validates the allowlist and normalizes native errors.
- **Android services**: Accessibility Service and native action execution. Android permissions remain OS-controlled.
- **AI providers**: user-configured Gemini/OpenRouter keys. Never place real keys in source control.

## Action execution contract

1. Parse the user's request or receive a provider tool call.
2. Validate the requested action against the allowlist.
3. Check required Android capability/permission.
4. Ask the user to confirm actions that can leave the current screen or change device state when appropriate.
5. Call the native bridge and await the native result.
6. Report success only when the native layer returns success; distinguish "request sent" from "action completed".

## Reliability requirements

- Native actions must return a structured success/failure result with a useful message.
- Permission UI must read Android's actual state, not a local toggle.
- Accessibility-dependent actions must fail clearly when the service is disabled.
- Media actions may depend on the foreground media session and Android version.
- Keep API keys out of logs, commits, error messages and analytics.
- Tests should cover action allowlisting, missing arguments, permission-denied states and native bridge failures.

## Next implementation phases

1. Integrate the typed bridge and action executor into the existing app without replacing its current UI.
2. Add unit tests for direct command parsing and allowlist validation.
3. Harden Android accessibility/back-action result reporting.
4. Add memory storage with user-visible delete/export controls.
5. Add voice lifecycle management and background/floating UI with explicit permissions.
6. Run the Android build and verify on-device actions separately from UI success states.
