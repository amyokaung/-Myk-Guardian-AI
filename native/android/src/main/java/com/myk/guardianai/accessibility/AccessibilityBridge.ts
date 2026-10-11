import { registerPlugin } from '@capacitor/core';

export interface AccessibilityActionResult {
  success: boolean;
}

export interface AccessibilityEnabledResult {
  enabled: boolean;
}

export interface AccessibilityBridgePlugin {
  isEnabled(): Promise<AccessibilityEnabledResult>;
  openAccessibilitySettings(): Promise<void>;
  back(): Promise<AccessibilityActionResult>;
  home(): Promise<AccessibilityActionResult>;
  clickText(options: { text: string; exact?: boolean }): Promise<AccessibilityActionResult>;
}

const AccessibilityBridge = registerPlugin<AccessibilityBridgePlugin>('AccessibilityBridge');
export default AccessibilityBridge;
