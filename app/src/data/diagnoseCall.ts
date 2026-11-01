import { supabase } from '@/src/lib/supabase';
import type { DiagnoseReport } from '@/src/lib/systemReport';

// Settings > Diagnostics "Run check" (statement reading plan step A): calls
// ai-import mode "diagnose" (supabase/functions/ai-import/diagnose.ts).
// The server answers with booleans, names and counts only. Uses no import
// credit and reads no document.
export type DiagnoseCallResult = { report: DiagnoseReport } | { error: string };

export async function callDiagnose(): Promise<DiagnoseCallResult> {
  const { data, error } = await supabase.functions.invoke('ai-import', { body: { mode: 'diagnose' } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const body = await ctx.json();
        const type = body?.error?.type;
        // An ai-import deployed before step A treats the request as an
        // import without a file and answers bad_request.
        if (type === 'bad_request') return { error: 'server_not_updated' };
        if (typeof type === 'string') return { error: type };
      } catch {
        // fall through
      }
      return { error: `http_${ctx.status}` };
    }
    return { error: 'network' };
  }
  if (!data || typeof data !== 'object' || typeof (data as { serverBuildId?: unknown }).serverBuildId !== 'string') {
    // An older ai-import that does not know "diagnose" yet.
    return { error: 'server_not_updated' };
  }
  return { report: data as DiagnoseReport };
}
