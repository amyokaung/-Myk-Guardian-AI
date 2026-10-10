export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  toolCallId?: string;
}

export type NativeAction =
  | 'open_app'
  | 'back'
  | 'home'
  | 'media_next'
  | 'media_previous'
  | 'media_play_pause'
  | 'volume_up'
  | 'volume_down'
  | 'open_settings';

export interface NativeActionRequest {
  action: NativeAction;
  app?: string;
}

export interface NativeActionResult {
  success: boolean;
  message: string;
  action?: NativeAction;
  requiresPermission?: string;
}

export interface NativePermissionStatus {
  accessibilityEnabled: boolean;
  notificationEnabled: boolean;
}

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  id?: string;
}

export interface AgentContext {
  signal?: AbortSignal;
  maxToolCalls?: number;
}

export type AgentEvent =
  | { type: 'thinking' }
  | { type: 'tool-start'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool-result'; name: string; result: NativeActionResult }
  | { type: 'answer'; text: string }
  | { type: 'error'; message: string };

export interface AgentTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>, context?: AgentContext): Promise<NativeActionResult>;
}
