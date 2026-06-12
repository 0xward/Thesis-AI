export interface ThesisConfig {
  targetLanguage: string;
  major: string;
  thesisLevel: string; // Undergraduate, Masters, PhD
  writingStyle: string;
  contentLength: 'Short' | 'Standard' | 'Comprehensive';
  fontFamily: 'Serif' | 'Sans';
  antiPlagiarism: boolean;
  citationStyle: string;
}

export interface ResearchSource {
  type: 'url' | 'pdf' | 'text';
  content: string;
  title?: string;
}

export interface ThesisStructure {
  title: string;
  chapters: ChapterDefinition[];
}

export interface ChapterDefinition {
  chapter_title: string;
  summary: string;
  subchapters: string[];
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.json().catch(async () => ({ error: await response.text() }));
    throw new Error((detail as any).error || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function chatWithAgent(
  message: string,
  currentThesis: any,
  sources: ResearchSource[],
  config: ThesisConfig
): Promise<string> {
  const response = await postJson<{ text: string }>('/api/ai/chat', {
    message,
    currentThesis,
    sources,
    config,
  });
  return response.text || 'No response generated.';
}

export async function generateReferences(
  sources: ResearchSource[],
  config: ThesisConfig
): Promise<{ chapterTitle: string; content: string }> {
  return postJson<{ chapterTitle: string; content: string }>('/api/ai/references', {
    sources,
    config,
  });
}

export async function generateTitleOptions(
  sources: ResearchSource[],
  config: ThesisConfig
): Promise<string[]> {
  const response = await postJson<{ titles: string[] }>('/api/ai/titles', { sources, config });
  return response.titles;
}

export async function generateThesisStructure(
  sources: ResearchSource[],
  config: ThesisConfig,
  customTitle?: string
): Promise<ThesisStructure> {
  return postJson<ThesisStructure>('/api/ai/structure', { sources, config, customTitle });
}

// ─── Modular stream helper ────────────────────────────────────────────────────
async function* readStream(response: Response): AsyncGenerator<{ text: string }> {
  if (!response.body) throw new Error('No response body from server.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield { text };
  }
}

async function startStream(path: string, payload: unknown): Promise<Response> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Try to parse a JSON error (e.g. rate limit)
    const errData = await response.json().catch(async () => ({
      error: await response.text(),
    }));
    throw new Error((errData as any).error || `Stream failed: ${response.status}`);
  }

  return response;
}

// ─── Modular section stream (one subchapter at a time, ~350-450 words) ────────
export async function generateSectionStream(
  chapterTitle: string,
  subchapterTitle: string,
  chapterGoals: string,
  fullStructure: ThesisStructure,
  sources: ResearchSource[],
  config: ThesisConfig,
  previousContext: string = ''
): Promise<AsyncGenerator<{ text: string }>> {
  const response = await startStream('/api/ai/section-stream', {
    chapterTitle,
    subchapterTitle,
    chapterGoals,
    fullStructure,
    sources,
    config,
    previousContext,
  });
  return readStream(response);
}

// ─── Refine/rewrite a section for better academic flow ───────────────────────
export async function refineSectionStream(
  sectionText: string,
  context: string,
  config: ThesisConfig
): Promise<AsyncGenerator<{ text: string }>> {
  const response = await startStream('/api/ai/refine-stream', {
    sectionText,
    context,
    config,
  });
  return readStream(response);
}

// ─── Legacy: full chapter at once (kept for backward compat) ─────────────────
export async function generateChapterContentStream(
  chapter: ChapterDefinition,
  fullStructure: ThesisStructure,
  sources: ResearchSource[],
  config: ThesisConfig,
  previousContext: string = ''
): Promise<AsyncGenerator<{ text: string }>> {
  const response = await startStream('/api/ai/chapter-stream', {
    chapter,
    fullStructure,
    sources,
    config,
    previousContext,
  });
  return readStream(response);
}
