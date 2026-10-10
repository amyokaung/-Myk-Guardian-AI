import { nativeBridge } from './nativeBridge';
import type { AgentContext, AgentEvent, NativeAction, NativeActionResult } from '../types';

const ACTIONS = new Set<NativeAction>([
  'open_app', 'back', 'home', 'media_next', 'media_previous',
  'media_play_pause', 'volume_up', 'volume_down', 'open_settings',
]);

export interface AgentActionPlan {
  action: NativeAction;
  app?: string;
  explanation?: string;
}

/** Executes only allowlisted native actions and emits truthful progress events. */
export async function executeAgentPlan(
  plan: AgentActionPlan,
  onEvent: (event: AgentEvent) => void,
  context: AgentContext = {},
): Promise<NativeActionResult> {
  if (context.signal?.aborted) {
    return { success: false, message: 'အသုံးပြုသူက လုပ်ဆောင်ချက်ကို ရပ်လိုက်သည်။' };
  }
  if (!ACTIONS.has(plan.action)) {
    const result = { success: false, message: 'ခွင့်မပြုထားသော Android action ဖြစ်သည်။' };
    onEvent({ type: 'error', message: result.message });
    return result;
  }
  if (plan.action === 'open_app' && !plan.app?.trim()) {
    const result = { success: false, action: plan.action, message: 'ဖွင့်လိုသော app အမည် မပါဝင်ပါ။' };
    onEvent({ type: 'error', message: result.message });
    return result;
  }

  onEvent({ type: 'tool-start', name: plan.action, arguments: { ...(plan.app ? { app: plan.app } : {}) } });
  const result = await nativeBridge.performAction(plan.action, plan.app);
  onEvent({ type: 'tool-result', name: plan.action, result });
  return result;
}

/** Small safe baseline parser. AI provider tool-calling can supply plans too. */
export function parseDirectAction(text: string): AgentActionPlan | null {
  const value = text.trim().toLocaleLowerCase();
  if (/^(back|go back|နောက်ပြန်|နောက်သို့ပြန်|ပြန်သွား)$/.test(value)) return { action: 'back' };
  if (/^(home|go home|ပင်မစာမျက်နှာ|home ကိုသွား)$/.test(value)) return { action: 'home' };
  if (/(နောက်သီချင်း|သီချင်းကျော်|next song|skip song|media next)/.test(value)) return { action: 'media_next' };
  if (/(အရင်သီချင်း|ယခင်သီချင်း|previous song|media previous)/.test(value)) return { action: 'media_previous' };
  if (/(ခဏရပ်|ပြန်ဖွင့်|play pause|pause music|resume music)/.test(value)) return { action: 'media_play_pause' };
  if (/(အသံတိုး|volume up|အသံမြှင့်)/.test(value)) return { action: 'volume_up' };
  if (/(အသံလျှော့|volume down|အသံချ)/.test(value)) return { action: 'volume_down' };
  if (/(settings ဖွင့်|ဆက်တင်ဖွင့်|open settings)/.test(value)) return { action: 'open_settings' };
  return null;
}
