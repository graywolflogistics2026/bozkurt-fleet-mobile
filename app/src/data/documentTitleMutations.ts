import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase';
import { cleanTitle, shouldApplyAutoTitle, type TitleSource } from '@/src/data/documentTitle';

// DOCUMENT TITLES (owner decision 2026-09-23, docs/PENDING_SQL.md §76).
// The one write path for documents.title. An automatic title ('ai' or
// 'record') first re-reads the row and never replaces a user's own rename
// ('user'). Returns false when it deliberately skipped the write.
export async function setDocumentTitle(documentId: string, title: string, source: TitleSource): Promise<boolean> {
  const clean = cleanTitle(title);
  if (!clean) throw new Error('A document title cannot be empty.');
  if (source !== 'user') {
    const { data, error } = await supabase.from('documents').select('title_source').eq('id', documentId).maybeSingle();
    if (error) throw error;
    if (data && !shouldApplyAutoTitle(data as { title_source: TitleSource | null })) return false;
  }
  const { error } = await supabase.from('documents').update({ title: clean, title_source: source }).eq('id', documentId);
  if (error) throw error;
  return true;
}

export function useSetDocumentTitle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, title, source }: { documentId: string; title: string; source: TitleSource }) =>
      setDocumentTitle(documentId, title, source),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}
